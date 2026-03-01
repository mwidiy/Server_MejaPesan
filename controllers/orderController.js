const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const PDFDocument = require('pdfkit');
const NodeCache = require('node-cache');
// Ensure you have ran: npm install pdfkit

// L1 Pricing Cache (TTL: 60 seconds). Bypass DB for extreme checkout latency.
const pricingCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });

// Helper untuk generate Transaction Code
// Format: TRX-[YYYYMMDD]-[RANDOM4DIGIT] (Contoh: TRX-20240101-A1B2)
const generateTransactionCode = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();

    return `TRX-${dateStr}-${randomStr}`;
};

const createOrder = async (req, res) => {
    try {
        console.log('Incoming Order Payload:', JSON.stringify(req.body, null, 2));

        const {
            customerName,
            tableId,
            storeId, // <--- New Field
            orderType,
            items,
            note,
            deliveryAddress,
            paymentMethod,
            paymentStatus
        } = req.body;

        // 1. Validasi Input Dasar
        if (!customerName || !items || items.length === 0) {
            return res.status(400).json({ error: 'Customer name dan items harus diisi.' });
        }

        // Security: Limit Customer Name Length
        if (customerName.length > 20) {
            return res.status(400).json({ error: 'Nama customer terlalu panjang (max 20 karakter).' });
        }

        // Multi-Tenancy Check: Store ID is mandatory now (except maybe for legacy calls, handled carefully)
        if (!storeId) {
            // Note: If you have legacy clients, you might fallback or warn.
            // But for PWA connected to Multi-Tenant Backend, this is key.
            console.warn("⚠️ Warning: Order created without storeId!");
        }

        // --- SMART QUEUE LOGIC START (Moved Up for Pricing) ---
        // 1. Fetch products to get prepTime AND PRICE (Security: Server-side pricing)
        // TAHAP 55: L1 Pricing Cache Implementation
        const productIds = items.map(item => item.productId);
        const products = [];
        const missingProductIds = [];

        // Check L1 Cache First
        productIds.forEach(id => {
            const cachedProduct = pricingCache.get(`product_${id}`);
            if (cachedProduct) {
                products.push(cachedProduct);
            } else {
                missingProductIds.push(id);
            }
        });

        // Fetch missing products from DB
        if (missingProductIds.length > 0) {
            const dbProducts = await prisma.product.findMany({
                where: { id: { in: missingProductIds } },
                select: { id: true, prepTime: true, name: true, price: true }
            });

            dbProducts.forEach(p => {
                pricingCache.set(`product_${p.id}`, p);
                products.push(p);
            });
        }

        const productMap = {};
        products.forEach(p => productMap[p.id] = p);

        // 2. Parsed Data & Logic
        let parsedTableId = null;
        let finalOrderType = orderType;

        // FIXED LOGIC: 
        // HANYA set ke default 'Counter Pickup' JIKA req.body.tableId itu KOSONG (null/undefined).
        // 2. Parsed Data & Logic
        // AMBIL ID DARI REQUEST
        let finalTableId = req.body.tableId;
        // HANYA JIKA Table ID kosong/null, BARU kita cari meja default
        if (!finalTableId && storeId) {
            if (orderType === 'takeaway' || orderType === 'delivery') {
                // Cari meja default takeaway SCIPED TO STORE
                const pickupTable = await prisma.table.findFirst({
                    where: {
                        qrCode: 'COUNTER-PICKUP',
                        location: { storeId: parseInt(storeId) } // Scoped Lookup
                    }
                });

                if (pickupTable) {
                    finalTableId = pickupTable.id.toString();
                } else {
                    // Jika belum ada meja default di toko ini, mungkin butuh fallback atau biarkan null
                    // Idealnya setiap toko baru dibuatkan meja 'COUNTER-PICKUP'
                    console.log(`[Info] No COUNTER-PICKUP table found for Store ${storeId}`);
                }
            }
        }

        // If finalTableId is still not set, it means no specific table was provided and no default was found/applicable.
        // In this case, parsedTableId remains null, which is fine for orders not tied to a physical table.
        if (finalTableId) {
            parsedTableId = parseInt(finalTableId);
        }

        // 3. Logic Note Handling (Deleted - separated into note & deliveryAddress)

        // 4. Hitung Total Amount dari items & Siapkan Data Items (SECURE VERSION)
        let calculatedTotal = 0;
        const orderItemsData = [];

        let maxPrepTime = 0;
        let isFastLane = true;

        for (const item of items) {
            const product = productMap[item.productId];
            if (!product) {
                return res.status(400).json({ error: `Produk dengan ID ${item.productId} tidak ditemukan.` });
            }

            if (item.quantity <= 0) {
                return res.status(400).json({ error: `Quantity harus lebih dari 0.` });
            }

            // SECURITY: Use server price, ignore client price
            const realPrice = Number(product.price);
            const itemTotal = realPrice * item.quantity;
            calculatedTotal += itemTotal;

            orderItemsData.push({
                productId: item.productId,
                quantity: item.quantity,
                priceSnapshot: realPrice, // Used Server Price
                // note: item.note
            });

            // Lane Logic
            const pt = product.prepTime || 5;
            if (pt > 5) isFastLane = false;
            if (pt > maxPrepTime) maxPrepTime = pt;
        }

        // 5. Generate Transaction Code Unik
        const transactionCode = generateTransactionCode();

        // 3. Set Estimated Time String
        let finalEstimatedTime = "15-20 Menit";
        if (isFastLane) {
            finalEstimatedTime = "5-10 Menit";
        } else {
            if (maxPrepTime >= 20) {
                finalEstimatedTime = "25-30 Menit";
            } else {
                finalEstimatedTime = "15-20 Menit";
            }
        }
        // --- SMART QUEUE LOGIC END ---


        // 7. Daily Queue Number Logic (New - Smart Queue 2.0 Atomic Fetch)
        // Scope Queue Number to Store? Usually yes.
        // TAHAP 47 Hotfix: Accurate WIB Timezone Reset
        // TAHAP 48 Hotfix 2: Absolute WIB Timezone Reset (Bulletproof)
        // Kita paksa NodeJS ngebaca kalender 'Asia/Jakarta' saat ini juga
        const wibDateString = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
        const wibDateObj = new Date(wibDateString);

        // Cari jam 00:00:00 pada hari WIB tersebut
        wibDateObj.setHours(0, 0, 0, 0);

        // Kembalikan ke format UTC agar Prisma bisa ngebaca dengan benar di database (yang nyimpen UTC)
        // Karena WIB itu UTC+7, maka 00:00 WIB = 17:00 UTC (hari sebelumnya)
        const todayStart = new Date(wibDateObj.getTime() - (7 * 60 * 60 * 1000));

        // TAHAP 49: NEW QUEUE PHILOSOPHY (Active Pending Count)
        // User explicitly stated queue number should be the number of people currently waiting.
        const whereQueue = {
            status: { in: ['Pending', 'Processing'] }
        };
        // Scope by store
        if (storeId) whereQueue.storeId = parseInt(storeId);

        // Limit the search window to today just in case there are orphaned pending orders from weeks ago
        whereQueue.createdAt = { gte: todayStart };

        const activeQueueCount = await prisma.order.count({
            where: whereQueue
        });

        // The queue number is simply the count of people currently waiting PLUS ONE (myself)
        // e.g. If 0 people are pending, my queue number is 1. If 5 people are pending, my queue number is 6.
        const nextQueueNumber = activeQueueCount + 1;

        // LOGIC FIX: QRIS Order starts as 'WaitingPayment', NOT 'Pending'
        // This prevents Kasir from seeing unpaid orders immediately
        const isQrisUnpaid = paymentMethod === 'qris' && (!paymentStatus || paymentStatus === 'Unpaid');
        const initialStatus = isQrisUnpaid ? 'WaitingPayment' : 'Pending';

        // TAHAP 47: ONE TRUE QUEUE FIX
        // DO NOT assign actual queueNumber to 'WaitingPayment' orders. Assign 0 (Schema default).
        const finalQueueNumber = isQrisUnpaid ? 0 : nextQueueNumber;

        // 6. Prisma Transaction (Atomic Create)
        const newOrder = await prisma.$transaction(async (tx) => {
            const orderData = {
                transactionCode,
                queueNumber: finalQueueNumber, // Save Daily Number if Cash, otherwise null
                customerName,
                // Don't use scalar tableId, use relation below
                orderType: finalOrderType,
                totalAmount: calculatedTotal,
                note: note || "",
                deliveryAddress: deliveryAddress || "",
                status: initialStatus,
                paymentMethod: paymentMethod || null,
                paymentStatus: paymentStatus || 'Unpaid',
                estimatedTime: finalEstimatedTime, // Added Smart Estimation
                items: {
                    create: orderItemsData
                }
            };

            // Connect Table if Valid
            if (finalTableId) {
                orderData.table = { connect: { id: parseInt(finalTableId) } };
            }

            // Connect Store if Valid
            if (storeId) {
                orderData.store = { connect: { id: parseInt(storeId) } };
            }

            const order = await tx.order.create({
                data: orderData,
                include: {
                    table: {
                        include: {
                            location: true
                        }
                    }
                }
            });

            return order;
        });

        // 7. Real-time Trigger
        // Only emit if NOT waiting for payment. If waiting, emit later after payment success.
        if (req.io && !isQrisUnpaid) {
            // OPTIMIZATION 44: Asynchronous Socket Offloading
            // Eksekusi Emit di background agar API Checkout merespon instan seketika
            setTimeout(() => {
                // Emit to Global (Legacy Support)
                req.io.emit('new_order', newOrder);

                // Emit to Store Room (Multi-Tenancy Support)
                if (storeId) {
                    req.io.to(`store_${storeId}`).emit('new_order', newOrder);
                }
                console.log(`📡 Emitted 'new_order': ${newOrder.transactionCode} (Store: ${storeId})`);
            }, 0);
        } else if (isQrisUnpaid) {
            console.log(`Creating QRIS Order ${newOrder.transactionCode} - Waiting for Payment (No Socket Emit yet)`);
        }

        res.status(201).json({
            message: 'Order created successfully',
            data: newOrder
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Gagal membuat pesanan.' });
    }
};

const getAllOrders = async (req, res) => {
    try {
        const { status, type, search } = req.query;
        let whereClause = {};

        // Multi-tenancy Filter
        if (req.storeId) {
            whereClause.storeId = req.storeId;
        }

        if (status) {
            // Support comma-separated statuses e.g. "Completed,Cancelled"
            const statuses = status.split(',');
            if (statuses.length > 1) {
                whereClause.status = { in: statuses };
            } else {
                whereClause.status = status;
            }
        }

        const orders = await prisma.order.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                items: {
                    include: {
                        product: true // Agar admin tahu nama produk yang dipesan
                    }
                },
                table: {
                    include: {
                        location: true
                    }
                }
            }
        });

        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan',
            error: error.message
        });
    }
};

const updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, paymentStatus } = req.body; // Accept paymentStatus

    try {
        // 1. Fetch Order first to get current data & items (for smart logic)
        const currentOrder = await prisma.order.findUnique({
            where: { id: parseInt(id) },
            include: { items: { include: { product: true } } }
        });

        if (!currentOrder) return res.status(404).json({ message: 'Order not found' });

        // Logic update field status dan paymentStatus
        let dataToUpdate = {};
        if (status) {
            dataToUpdate.status = status;

            // SMART QUEUE LOGIC: Set Target Time when Order starts Processing
            if (status === 'Processing' && !currentOrder.targetTime) {
                // Determine duration based on prepTime of items
                let durationMinutes = 5; // Default

                // Cek Max Prep Time dari items
                if (currentOrder.items && currentOrder.items.length > 0) {
                    const maxPrep = Math.max(...currentOrder.items.map(i => i.product.prepTime || 5));
                    // Jika minuman (2-3) -> 5 menit total
                    // Jika makanan (15) -> 20 menit total (buffer)
                    durationMinutes = maxPrep <= 5 ? 5 : (maxPrep + 5);
                }

                const targetTime = new Date();
                targetTime.setMinutes(targetTime.getMinutes() + durationMinutes);
                dataToUpdate.targetTime = targetTime;
                console.log(`⏱️ Order ${currentOrder.transactionCode} started processing. Target: ${targetTime.toLocaleTimeString()}`);
            }
        }
        if (paymentStatus) dataToUpdate.paymentStatus = paymentStatus;

        // Auto-update paymentStatus logic (optional fallback)
        if (status === 'Paid' && !paymentStatus) {
            dataToUpdate.paymentStatus = 'Paid';
        } else if (status === 'Cancelled' && !paymentStatus) {
            dataToUpdate.paymentStatus = 'Cancelled';
        }

        const updatedOrder = await prisma.order.update({
            where: { id: parseInt(id) },
            data: dataToUpdate,
            include: {
                items: {
                    include: { product: true }
                },
                table: {
                    include: {
                        location: true
                    }
                }
            }
        });

        // Emit socket event (Asynchronous Offloading)
        if (req.io) {
            setTimeout(() => {
                req.io.emit('order_status_updated', updatedOrder);
                if (updatedOrder.storeId) {
                    req.io.to(`store_${updatedOrder.storeId}`).emit('order_status_updated', updatedOrder);
                }
                console.log(`📡 Emitted 'order_status_updated': ${updatedOrder.transactionCode} -> ${status} (Store: ${updatedOrder.storeId})`);
            }, 0);
        }

        res.status(200).json({
            success: true,
            message: 'Status pesanan berhasil diperbarui',
            data: updatedOrder
        });

    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memperbarui status pesanan',
            error: error.message
        });
    }
};

const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma.order.findUnique({
            where: { id: parseInt(id) },
            include: {
                items: {
                    include: { product: true }
                },
                table: {
                    include: { location: true }
                }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const getOrderByTransactionCode = async (req, res) => {
    try {
        let { code } = req.params;
        // SECURITY: Limit length and eliminate complex characters
        code = String(code || '').substring(0, 50).replace(/[<>{}\'";=\\]/g, '').trim();

        const order = await prisma.order.findUnique({
            where: { transactionCode: code },
            include: {
                items: {
                    include: { product: true }
                },
                table: {
                    include: { location: true }
                },
                store: { select: { whatsappNumber: true } }
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // SMART QUEUE 3.0: Predictive Time & Dynamic Position
        // 1. Get ALL orders ahead (Pending/Processing) to sum their prep times
        const queueWhere = {
            createdAt: {
                lt: order.createdAt,
                gte: new Date(new Date().setHours(0, 0, 0, 0))
            },
            status: 'Pending' // User Request 5.0: Only Pending counts as "Queue"
        };

        // Fix: Scope by StoreID
        if (order.storeId) {
            queueWhere.storeId = order.storeId;
        }

        const ordersQueue = await prisma.order.findMany({
            where: queueWhere,
            include: { items: { include: { product: true } } }
        });

        const queuePosition = ordersQueue.length + 1; // My position (1-based)

        // 2. Calculate Cumulative Prep Time
        // Logic: Sum of max prep time per order in queue + my order
        let totalMinutesAhead = 0;

        // A. Duration of orders ahead
        for (const qOrder of ordersQueue) {
            let orderPrep = 20; // Default buffer
            if (qOrder.items && qOrder.items.length > 0) {
                // Take max prep time of items in that order (parallel prep). Fix 39: Poisoned Queue Guard
                const maxP = Math.max(...qOrder.items.map(i => i.product?.prepTime || 20));
                orderPrep = maxP;
            }
            totalMinutesAhead += orderPrep;
        }

        // B. Duration of MY order
        let myPrep = 20;
        if (order.items && order.items.length > 0) {
            myPrep = Math.max(...order.items.map(i => i.product?.prepTime || 20)); // Fix 39: Guard
        }

        // C. Total Service Time Calculation (TAHAP 38: Smart Queue Time Prediction Fix)
        // If system is idle, starts from Order Creation time (NOT new Date() to avoid moving target on refresh)
        const baseTime = new Date(order.createdAt); // Fix 1: Locked base time
        const predictedTime = new Date(baseTime.getTime() + (totalMinutesAhead + myPrep) * 60000);

        // Fix 2: Force WIB Timezone (UTC+7) manually to avoid Intl.DateTimeFormat crashing on minimal Node servers (e.g. Alpine Linux on Koyeb)
        const utcMillis = predictedTime.getTime();
        const wibMillis = utcMillis + (7 * 60 * 60 * 1000); // Add 7 hours manually
        const wibDate = new Date(wibMillis);

        // Extract using getUTC to get the shifted time
        const hours = String(wibDate.getUTCHours()).padStart(2, '0');
        const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
        const clockTime = `${hours}:${minutes}`;

        res.status(200).json({
            success: true,
            data: {
                ...order,
                queuePosition: queuePosition, // Explicit Position (1, 2, 3)
                ordersAhead: ordersQueue.length, // 0 means I am next/processing
                predictedServiceTime: clockTime // "12:30"
            }
        });
    } catch (error) {
        console.error('Error fetching order by code:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const getOrdersByBatch = async (req, res) => {
    try {
        const { codes } = req.body; // Expect array of transaction codes

        if (!codes || !Array.isArray(codes) || codes.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        const orders = await prisma.order.findMany({
            where: {
                transactionCode: { in: codes }
            },
            include: {
                items: {
                    include: { product: true }
                },
                table: {
                    include: { location: true }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Add simplified Queue Logic for Status Page (just to show accurate status text)
        // We iterate through them to add formatted prediction if needed, 
        // but for the Status LIST page, we might just need Status, Items, Total.
        // Let's keep it simple for now and just return the data. Frontend can format.

        res.status(200).json({
            success: true,
            data: orders
        });

    } catch (error) {
        console.error('Error fetching batch orders:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// --- CANCELLATION & REFUND LOGIC ---
const requestCancel = async (req, res) => {
    try {
        const { transactionCode, reason } = req.body;

        const order = await prisma.order.findUnique({
            where: { transactionCode }
        });

        if (!order) return res.status(404).json({ message: "Order not found" });

        if (order.status === 'Completed' || order.status === 'Cancelled') {
            return res.status(400).json({ message: "Pesanan ini tidak bisa dibatalkan lagi." });
        }

        let updatedData = {};
        let message = "";

        // Scenario 1: Pending -> Auto Cancel
        if (order.status === 'Pending') {
            updatedData = {
                status: 'Cancelled',
                cancellationReason: reason,
                cancellationStatus: 'AutoCancelled',
                // If Paid, set Refund Status to Pending
                refundStatus: order.paymentStatus === 'Paid' ? 'Pending' : null
            };
            message = "Pesanan berhasil dibatalkan otomatis.";
        }
        // Scenario 2: Processing -> Request
        else if (order.status === 'Processing') {
            updatedData = {
                cancellationStatus: 'Requested',
                cancellationReason: reason
            };
            message = "Permintaan pembatalan dikirim ke kasir.";
        } else {
            return res.status(400).json({ message: "Status pesanan tidak valid untuk pembatalan." });
        }

        const updatedOrder = await prisma.order.update({
            where: { transactionCode },
            data: updatedData,
            include: { items: { include: { product: true } } }
        });

        if (req.io) setTimeout(() => req.io.emit('order_status_updated', updatedOrder), 0);

        res.json({ success: true, message, data: updatedOrder });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Gagal memproses pembatalan" });
    }
};

const approveCancel = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma.order.findUnique({ where: { id: parseInt(id) } });

        if (!order) return res.status(404).json({ message: "Order not found" });

        const updatedOrder = await prisma.order.update({
            where: { id: parseInt(id) },
            data: {
                status: 'Cancelled',
                cancellationStatus: 'Approved',
                refundStatus: order.paymentStatus === 'Paid' ? 'Pending' : null
            },
            include: { items: { include: { product: true } } }
        });

        if (req.io) setTimeout(() => req.io.emit('order_status_updated', updatedOrder), 0);
        res.json({ success: true, message: "Pembatalan Disetujui", data: updatedOrder });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Error approving cancellation" });
    }
};

const rejectCancel = async (req, res) => {
    try {
        const { id } = req.params;
        let { reason } = req.body;

        // SECURITY: Sanitize cancellation reason (Max 150 chars, no HTML tags)
        reason = String(reason || '').substring(0, 150).replace(/[<>{}\[\]]/g, '').trim();

        console.log(`[DEBUG] Received Reject/Cancel for Order ${id}`);
        console.log(`[DEBUG] Reason provided: ${reason}`);

        const order = await prisma.order.findUnique({ where: { id: parseInt(id) } });

        let updatedData = {};
        let message = "";

        if (reason) {
            // FORCE CANCEL SCENARIO
            console.log(`[DEBUG] Executing Force Cancel`);
            updatedData = {
                status: 'Cancelled',
                cancellationStatus: 'RejectedByAdmin',
                cancellationReason: `Dibatalkan Kasir: ${reason}`,
                refundStatus: order.paymentStatus === 'Paid' ? 'Pending' : null
            };
            message = "Pesanan Dibatalkan Paksa oleh Kasir";
        } else {
            // STANDARD REJECT SCENARIO
            console.log(`[DEBUG] Executing Standard Reject`);
            updatedData = {
                cancellationStatus: 'Rejected'
            };
            message = "Permintaan Pembatalan Ditolak";
        }

        const updatedOrder = await prisma.order.update({
            where: { id: parseInt(id) },
            data: updatedData,
            include: { items: { include: { product: true } } }
        });

        if (req.io) setTimeout(() => req.io.emit('order_status_updated', updatedOrder), 0);
        res.json({ success: true, message, data: updatedOrder });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Error rejecting cancellation" });
    }
};

const verifyRefund = async (req, res) => {
    try {
        const { transactionCode } = req.body;
        const order = await prisma.order.findUnique({ where: { transactionCode } });

        if (!order) return res.status(404).json({ message: "Order not found" });

        // Check validity for refund
        if (order.status !== 'Cancelled' && order.cancellationStatus !== 'AutoCancelled') {
            return res.status(400).json({ message: "Pesanan ini tidak dalam status Batal" });
        }

        if (order.paymentStatus !== 'Paid') {
            return res.status(400).json({ message: "Pesanan ini belum dibayar, tidak perlu refund." });
        }

        if (order.refundStatus === 'Refunded') {
            return res.status(400).json({ message: "Pesanan ini SUDAH di-refund sebelumnya." });
        }

        // Execute Refund
        const updatedOrder = await prisma.order.update({
            where: { transactionCode },
            data: { refundStatus: 'Refunded' }
        });

        if (req.io) setTimeout(() => req.io.emit('order_status_updated', updatedOrder), 0);

        res.json({
            success: true,
            message: "Refund Valid & Berhasil Diverifikasi",
            amount: order.totalAmount
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Refund Error" });
    }
};

const exportOrdersPdf = async (req, res) => {
    try {
        const { status, type, search, startDate, endDate } = req.query;
        const BATCH_SIZE = 500;

        let whereClause = {};
        if (req.storeId) whereClause.storeId = req.storeId;

        // 1. Status Filter
        if (status && status !== 'All') {
            const statuses = status.split(',');
            if (statuses.length > 1) {
                whereClause.status = { in: statuses };
            } else {
                whereClause.status = status;
            }
        }

        // 2. Type Filter
        if (type && type !== 'All') {
            whereClause.orderType = type;
        }

        // 3. Search Filter
        if (search) {
            whereClause.OR = [
                { transactionCode: { contains: search } },
                { customerName: { contains: search } }
            ];
        }

        // 4. Date Filter
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            whereClause.createdAt = { gte: start, lte: end };
        }

        // --- STEP 1: CALCULATE TOTALS (FAST AGGREGATE) ---
        // We need totals for the header before we start streaming rows
        const revenueWhere = { ...whereClause };
        if (revenueWhere.status) delete revenueWhere.status; // Remove status filter to calculate revenue of Completed orders in this period

        const aggregations = await prisma.order.aggregate({
            _sum: { totalAmount: true },
            _count: { id: true },
            where: {
                ...revenueWhere,
                status: 'Completed' // Only count revenue from completed
            }
        });

        const totalRevenue = aggregations._sum.totalAmount || 0;
        const totalCompletedCount = aggregations._count.id || 0;

        // Also get total count of ALL transactions (matching filter)
        const totalTransactions = await prisma.order.count({ where: whereClause });


        // --- STEP 2: SETUP PDF STREAM ---
        const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: false });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Laporan_Riwayat.pdf');

        doc.pipe(res);

        // --- STEP 3: WRITE HEADER & SUMMARY ---
        doc.fontSize(18).text('Laporan Riwayat Pesanan', { align: 'center' });
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).font('Helvetica-Bold').text(`Total Pendapatan (Selesai): Rp ${Number(totalRevenue).toLocaleString('id-ID')}`);
        doc.text(`Total Transaksi: ${totalTransactions}`);
        doc.text(`Total Sukses: ${totalCompletedCount}`);
        doc.moveDown();

        // Table Header
        const tableTop = doc.y;
        const colX = [30, 60, 180, 290, 380, 470];

        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('No', colX[0], tableTop);
        doc.text('Kode', colX[1], tableTop);
        doc.text('Pelanggan', colX[2], tableTop);
        doc.text('Waktu', colX[3], tableTop);
        doc.text('Status', colX[4], tableTop);
        doc.text('Total', colX[5], tableTop);

        doc.moveTo(30, tableTop + 15).lineTo(565, tableTop + 15).stroke();

        let y = tableTop + 25;
        let rowCount = 0;

        // --- STEP 4: BATCH FETCH & STREAM ---
        let cursor = null;
        let hasMore = true;
        let batchIndex = 0;

        doc.font('Helvetica').fontSize(9);

        while (hasMore) {
            batchIndex++;
            console.log(`[PDF] Fetching batch ${batchIndex}...`);

            // Fetch Batch
            const batchOrders = await prisma.order.findMany({
                where: whereClause,
                take: BATCH_SIZE,
                skip: cursor ? 1 : 0,
                cursor: cursor ? { id: cursor } : undefined,
                orderBy: { id: 'desc' },
                select: {
                    id: true,
                    transactionCode: true,
                    createdAt: true,
                    status: true,
                    orderType: true,
                    totalAmount: true,
                    customerName: true
                }
            });

            if (batchOrders.length === 0) {
                hasMore = false;
                break;
            }

            // Render Batch
            batchOrders.forEach((o) => {
                rowCount++;

                // Page Break Check
                if (y > 750) {
                    doc.addPage();
                    y = 40;
                }

                const dateStr = new Date(o.createdAt).toLocaleString('id-ID', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });

                doc.text(rowCount, colX[0], y);
                doc.text(o.transactionCode || o.id, colX[1], y, { width: 110 });
                doc.text(o.customerName || '-', colX[2], y, { width: 100, ellipsis: true });
                doc.text(dateStr, colX[3], y);
                doc.text(o.status, colX[4], y);
                doc.text(`Rp ${Number(o.totalAmount).toLocaleString('id-ID')}`, colX[5], y);

                y += 20;
            });

            // Update Cursor
            cursor = batchOrders[batchOrders.length - 1].id;

            // Safety break 
            if (batchOrders.length < BATCH_SIZE) {
                hasMore = false;
            }
        }

        doc.end();

    } catch (error) {
        console.error('Error generating PDF:', error);
        if (!res.headersSent) {
            res.status(500).send('Gagal membuat PDF');
        } else {
            res.end(); // Close stream
        }
    }
};

module.exports = {
    createOrder,
    getAllOrders,
    updateOrderStatus,
    getOrderById,
    getOrderByTransactionCode,
    getOrdersByBatch,
    requestCancel,
    approveCancel,
    rejectCancel,
    verifyRefund,
    exportOrdersPdf
};
