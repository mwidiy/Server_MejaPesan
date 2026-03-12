const { PrismaClient } = require('@prisma/client');
const midtransClient = require('midtrans-client');
const prisma = new PrismaClient();

// --- MIDTRANS CONFIG ---
const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const snap = new midtransClient.Snap({
    isProduction: isProduction,
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// 1. Create Transaction (Snap API)
const createTransaction = async (req, res) => {
    const { orderId, amount, customerName = 'Customer', email = 'customer@quacxel.my.id', phone = '08123456789' } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    if (!process.env.MIDTRANS_SERVER_KEY) {
        console.error("❌ Midtrans serverKey is missing in .env");
        return res.status(500).json({ success: false, message: 'Server Config Error' });
    }

    try {
        console.log(`[Midtrans] Start Transaction: Order ${orderId}, Amount: ${amount}`);

        // 1. Cek DB dulu
        const order = await prisma.order.findUnique({
            where: { transactionCode: orderId.toString() },
            include: { items: { include: { product: true } } }
        });

        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        const finalAmount = parseInt(amount);

        // Build Item Details
        let itemDetails = order?.items?.map(item => ({
            id: item.product.id.toString(),
            price: item.price,
            quantity: item.quantity,
            name: item.product.name.substring(0, 50)
        })) || [];

        // Validate Midtrans Math (items sum must EXACTLY equal gross_amount)
        const itemsSum = itemDetails.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (itemsSum !== finalAmount || itemDetails.length === 0) {
            itemDetails = [{
                id: '1',
                price: finalAmount,
                quantity: 1,
                name: `Pesanan QuackXel #${orderId}`
            }];
        }

        const parameter = {
            transaction_details: {
                order_id: orderId.toString(),
                gross_amount: finalAmount
            },
            customer_details: {
                first_name: customerName,
                email: email,
                phone: phone
            },
            item_details: itemDetails
        };

        const transaction = await snap.createTransaction(parameter);
        
        if (process.env.NODE_ENV !== 'production') console.log("[Midtrans] Snap Response:", transaction);

        return res.json({
            success: true,
            data: {
                paymentUrl: transaction.redirect_url, // URL buat diredirect front-end
                token: transaction.token, // Token buat embedded snap js (opsional)
                amount: amount,
                orderId: orderId.toString()
            }
        });

    } catch (error) {
        console.error("[Midtrans] Create Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error", details: error.message });
    }
};

// 2. Webhook Handler (Handle HTTP Notification from Midtrans)
const handleCallback = async (req, res) => {
    try {
        const notification = req.body;
        console.log(`[Midtrans] Webhook Hit for Order: ${notification.order_id}, Status: ${notification.transaction_status}`);

        // Verify SHA512 signature using core API or snap API method
        const statusResponse = await snap.transaction.notification(notification);
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        // Process successful payments
        if (transactionStatus == 'capture' || transactionStatus == 'settlement') {
            if (fraudStatus == 'challenge') {
                console.log(`[Midtrans] Order ${orderId} is challenged by FDS`);
                return res.status(200).json({ status: 'ok', message: 'Challenge pending' });
            } else if (fraudStatus == 'accept' || transactionStatus == 'settlement') {
                const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });

                if (order) {
                    if (order.paymentStatus !== 'Paid') {
                        const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                        // TAHAP 47 & 49: NEW QUEUE PHILOSOPHY
                        let generatedQueueNumber = order.queueNumber;
                        if (order.status === 'WaitingPayment' && (!order.queueNumber || order.queueNumber === 0)) {
                            const parts = new Intl.DateTimeFormat('en-US', {
                                timeZone: 'Asia/Jakarta',
                                year: 'numeric', month: 'numeric', day: 'numeric'
                            }).formatToParts(new Date());

                            const wib = {};
                            parts.forEach(p => wib[p.type] = p.value);
                            const todayStart = new Date(Date.UTC(wib.year, wib.month - 1, wib.day, -7, 0, 0, 0));

                            const whereQueue = { status: { in: ['Pending', 'Processing'] } };
                            if (order.storeId) whereQueue.storeId = order.storeId;
                            whereQueue.createdAt = { gte: todayStart };

                            const activeQueueCount = await prisma.order.count({ where: whereQueue });
                            generatedQueueNumber = activeQueueCount + 1;
                        }

                        const updatedOrder = await prisma.order.update({
                            where: { transactionCode: orderId.toString() },
                            data: {
                                paymentStatus: 'Paid',
                                paymentMethod: statusResponse.payment_type || 'Midtrans',
                                status: newStatus,
                                queueNumber: generatedQueueNumber
                            },
                            include: {
                                table: { include: { location: true } },
                                items: { include: { product: true } }
                            }
                        });
                        console.log(`[Midtrans] Order ${orderId} UPDATED to Paid (Queue: ${generatedQueueNumber})`);

                        if (req.io) {
                            req.io.emit('order_update', { transactionCode: orderId, status: 'Paid', source: 'webhook' });
                            req.io.to(orderId).emit('order_update', { transactionCode: orderId, status: 'Paid', source: 'webhook_direct' });

                            if (order.status === 'WaitingPayment') {
                                req.io.emit('new_order', updatedOrder);
                                if (updatedOrder.storeId) {
                                    req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                                }
                            }
                        }
                    }
                    return res.status(200).json({ status: 'ok', message: 'Updated to Paid' });
                } else {
                    console.log(`[Midtrans] Order ${orderId} not found in DB`);
                    return res.status(200).json({ status: 'ok', message: 'Order not found' });
                }
            }
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
            console.log(`[Midtrans] Order ${orderId} failed or expired`);
            await prisma.order.update({
                where: { transactionCode: orderId.toString() },
                data: { status: 'Cancelled', paymentStatus: 'Failed' }
            });
            return res.status(200).json({ status: 'ok', message: 'Order marked as Cancelled/Failed' });
        } else if (transactionStatus == 'pending') {
            return res.status(200).json({ status: 'ok', message: 'Waiting payment' });
        }

        console.log(`[Midtrans] Webhook ignored (ResultCode: ${transactionStatus})`);
        res.status(200).json({ status: 'ok', message: 'Ignored' });

    } catch (error) {
        console.error("[Midtrans] Webhook Error:", error);
        res.status(200).json({ status: 'error', message: "Internal Error handled" });
    }
};

// 3. Status Polling Backup
const checkStatus = async (req, res) => {
    const { orderId } = req.params;

    if (!orderId) return res.status(400).json({ message: 'Missing params' });

    try {
        const localOrder = await prisma.order.findUnique({ where: { transactionCode: orderId } });

        if (localOrder && localOrder.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Verified from Local DB' });
        }

        // Tembak Midtrans Check Status API
        const statusResponse = await snap.transaction.status(orderId.toString());
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        if ((transactionStatus == 'capture' && fraudStatus == 'accept') || transactionStatus == 'settlement') {
            const order = localOrder || await prisma.order.findUnique({ where: { transactionCode: orderId } });

            if (order && order.paymentStatus !== 'Paid') {
                const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                let generatedQueueNumber = order.queueNumber;
                if (order.status === 'WaitingPayment' && (!order.queueNumber || order.queueNumber === 0)) {
                    const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Asia/Jakarta',
                        year: 'numeric', month: 'numeric', day: 'numeric'
                    }).formatToParts(new Date());

                    const wib = {};
                    parts.forEach(p => wib[p.type] = p.value);
                    const todayStart = new Date(Date.UTC(wib.year, wib.month - 1, wib.day, -7, 0, 0, 0));

                    const whereQueue = { status: { in: ['Pending', 'Processing'] } };
                    if (order.storeId) whereQueue.storeId = order.storeId;
                    whereQueue.createdAt = { gte: todayStart };

                    const activeQueueCount = await prisma.order.count({ where: whereQueue });
                    generatedQueueNumber = activeQueueCount + 1;
                }

                const updatedOrder = await prisma.order.update({
                    where: { transactionCode: orderId },
                    data: {
                        paymentStatus: 'Paid',
                        paymentMethod: statusResponse.payment_type || 'Midtrans',
                        status: newStatus,
                        queueNumber: generatedQueueNumber
                    },
                    include: {
                        table: { include: { location: true } },
                        items: { include: { product: true } }
                    }
                });

                if (req.io) {
                    req.io.emit('order_update', { transactionCode: orderId, status: 'Paid' });
                    req.io.to(orderId).emit('order_update', { transactionCode: orderId, status: 'Paid', source: 'polling-direct' });

                    if (order.status === 'WaitingPayment') {
                        req.io.emit('new_order', updatedOrder);
                        if (updatedOrder.storeId) {
                            req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                        }
                    }
                }
                console.log(`[Midtrans] Polling found PAID status for ${orderId}`);
            }
            return res.json({ success: true, status: 'Paid' });
        }

        res.json({ success: true, status: 'Pending', raw_status: transactionStatus });

    } catch (error) {
        if (error.httpStatusCode === 404) {
             return res.json({ success: true, status: 'Pending', raw_status: 'Not Found in Midtrans (Probably unpaid)' });
        }
        console.error("[Midtrans] Check Status Error:", error);
        res.status(500).json({ success: false });
    }
};

// 4. Manual Expire for Timer
const expireOrder = async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await prisma.order.findUnique({ where: { transactionCode: orderId } });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.paymentStatus === 'Paid') {
            return res.json({ success: false, message: 'Order already Paid' });
        }

        if (order.status !== 'WaitingPayment') {
            return res.json({ success: false, message: 'Order status is not valid for expiry' });
        }

        await prisma.order.update({
            where: { transactionCode: orderId },
            data: { status: 'Cancelled', paymentStatus: 'Expired' }
        });

        console.log(`Order ${orderId} marked as EXPIRED (Timer Timeout)`);
        res.json({ success: true, message: 'Order expired successfully' });
    } catch (error) {
        console.error("Expire Error:", error);
        res.status(500).json({ success: false });
    }
};

// 5. Manual Bypass Simulator (Developer Testing)
const simulatePayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ success: false, message: 'Missing orderId' });

        const order = await prisma.order.findUnique({ where: { transactionCode: orderId } });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        if (order.paymentStatus === 'Paid') {
            return res.json({ success: true, message: 'Already paid' });
        }

        const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

        let generatedQueueNumber = order.queueNumber;
        if (order.status === 'WaitingPayment' && (!order.queueNumber || order.queueNumber === 0)) {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Jakarta',
                year: 'numeric', month: 'numeric', day: 'numeric'
            }).formatToParts(new Date());

            const wib = {};
            parts.forEach(p => wib[p.type] = p.value);
            const todayStart = new Date(Date.UTC(wib.year, wib.month - 1, wib.day, -7, 0, 0, 0));

            const whereQueue = { status: { in: ['Pending', 'Processing'] } };
            if (order.storeId) whereQueue.storeId = order.storeId;
            whereQueue.createdAt = { gte: todayStart };

            const activeQueueCount = await prisma.order.count({ where: whereQueue });
            generatedQueueNumber = activeQueueCount + 1;
        }

        const updatedOrder = await prisma.order.update({
            where: { transactionCode: orderId },
            data: {
                paymentStatus: 'Paid',
                paymentMethod: 'Simulator',
                status: newStatus,
                queueNumber: generatedQueueNumber
            },
            include: {
                table: { include: { location: true } },
                items: { include: { product: true } }
            }
        });

        console.log(`[Simulator] Order ${orderId} forced to PAID`);

        if (req.io) {
            req.io.emit('order_update', { transactionCode: orderId, status: 'Paid', source: 'simulator' });
            req.io.to(orderId).emit('order_update', { transactionCode: orderId, status: 'Paid', source: 'simulator-direct' });

            if (order.status === 'WaitingPayment') {
                req.io.emit('new_order', updatedOrder);
                if (updatedOrder.storeId) {
                    req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                }
            }
        }

        res.json({ success: true, message: 'Simulated Successfully' });
    } catch (error) {
        console.error("Simulator Error:", error);
        res.status(500).json({ success: false, message: 'Internal Error' });
    }
};

module.exports = {
    createTransaction,
    handleCallback,
    checkStatus,
    expireOrder,
    simulatePayment
};
