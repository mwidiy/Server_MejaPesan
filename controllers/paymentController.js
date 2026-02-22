const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- PAKASIR CONFIG ---
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY;
const PAKASIR_PROJECT = process.env.PAKASIR_PROJECT_SLUG;
// Default to Prod if not set in .env
const PAKASIR_BASE_URL = process.env.PAKASIR_API_URL || 'https://app.pakasir.com/api';

// Helper to check status
const fetchTransactionStatus = async (orderId, amount) => {
    const url = `${PAKASIR_BASE_URL}/transactiondetail?project=${PAKASIR_PROJECT}&amount=${amount}&order_id=${orderId}&api_key=${PAKASIR_API_KEY}`;
    const response = await fetch(url);
    return await response.json();
};

const isSuccessStatus = (status) => {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'success' || s === 'settlement' || s === 'completed';
};

// 1. Create Transaction (Get QR Data)
const createTransaction = async (req, res) => {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    if (!PAKASIR_PROJECT) {
        console.error("❌ PAKASIR_PROJECT_SLUG is not set in .env");
        return res.status(500).json({ success: false, message: 'Server Config Error' });
    }

    try {
        console.log(`[Pakasir] Start Transaction: Order ${orderId}, Amount: ${amount}`);

        // 1. Cek DB dulu
        const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });
        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        const payload = {
            project: PAKASIR_PROJECT,
            order_id: orderId.toString(),
            amount: amount,
            api_key: PAKASIR_API_KEY
        };

        const response = await fetch(`${PAKASIR_BASE_URL}/transactioncreate/qris`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        if (process.env.NODE_ENV !== 'production') console.log("[Pakasir] Raw API Response:", text);

        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error("[Pakasir] JSON Parse Error:", e);
            throw new Error("Invalid JSON from Pakasir");
        }

        // --- HANDLING SUKSES CREATION ---
        if (result.payment && result.payment.payment_number) {
            return res.json({
                success: true,
                data: {
                    qrString: result.payment.payment_number,
                    amount: result.payment.total_payment || amount,
                    orderId: result.payment.order_id,
                    expiry: result.payment.expired_at
                }
            });
        }

        // --- HANDLING "ALREADY COMPLETED" ---
        if (result.message && result.message.toLowerCase().includes("completed")) {
            console.log("[Pakasir] Transaction exists/completed. Checking status...");
            const check = await fetchTransactionStatus(orderId, amount);
            console.log("[Pakasir] Re-check Status:", JSON.stringify(check));

            if (check.transaction && isSuccessStatus(check.transaction.status)) {
                if (order && order.paymentStatus !== 'Paid') {
                    // Fix: Update Status to Pending if it was WaitingPayment
                    const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                    const updatedOrder = await prisma.order.update({
                        where: { transactionCode: orderId.toString() },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus
                        },
                        include: {
                            table: { include: { location: true } },
                            items: { include: { product: true } }
                        }
                    });

                    // EMIT SOCKET UPDATE
                    if (req.io) {
                        // 1. Update existing listeners
                        req.io.emit('order_update', {
                            transactionCode: orderId.toString(),
                            status: 'Paid',
                            source: 'create-check'
                        });
                        req.io.to(orderId.toString()).emit('order_update', {
                            transactionCode: orderId.toString(),
                            status: 'Paid',
                            source: 'create-check-direct'
                        });

                        // 2. EMIT NEW ORDER (Crucial for Kasir Dashboard if it was hidden)
                        if (order.status === 'WaitingPayment') {
                            req.io.emit('new_order', updatedOrder);
                            if (updatedOrder.storeId) {
                                req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                            }
                            console.log(`📡 'new_order' Emitted for ${orderId} (Recovery)`);
                        }
                    }
                }

                return res.json({ success: true, status: 'Paid', message: 'Transaction verified as Paid' });
            } else {
                return res.json({ success: true, status: 'Pending', message: 'Transaction exists but pending' });
            }
        }

        console.error("[Pakasir] Failed:", result);
        res.status(400).json({
            success: false,
            message: result.message || 'Gagal membuat QRIS',
            details: result
        });

    } catch (error) {
        console.error("[Pakasir] Create Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// 2. Webhook Handler (Instant Notification)
const handleCallback = async (req, res) => {
    try {
        // DEBUG: Sanitized Log
        const { order_id, status } = req.body;
        console.log(`[Pakasir] Webhook Hit for Order: ${order_id}, Status: ${status}`);

        // Payload: { project, order_id, amount, status, ... }


        if (isSuccessStatus(status)) {
            const order = await prisma.order.findUnique({ where: { transactionCode: order_id.toString() } });

            if (order) {
                if (order.paymentStatus !== 'Paid') {
                    // Update Payment AND Status if needed
                    const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                    const updatedOrder = await prisma.order.update({
                        where: { transactionCode: order_id.toString() },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus
                        },
                        include: {
                            table: { include: { location: true } },
                            items: { include: { product: true } }
                        }
                    });
                    console.log(`[Pakasir] Order ${order_id} UPDATED to Paid (via Webhook)`);

                    // EMIT NEW ORDER if it was waiting
                    if (req.io) {
                        // Emit update first
                        // 1. GLOBAL (Backup)
                        req.io.emit('order_update', {
                            transactionCode: order_id,
                            status: 'Paid',
                            source: 'webhook'
                        });

                        // 2. SPECIFIC ROOM (Primary for Instant Redirect)
                        req.io.to(order_id).emit('order_update', {
                            transactionCode: order_id,
                            status: 'Paid',
                            source: 'webhook_direct'
                        });

                        // If it was 'WaitingPayment', now treat it as 'new_order' for Kasir
                        if (order.status === 'WaitingPayment') {
                            req.io.emit('new_order', updatedOrder);
                            if (updatedOrder.storeId) {
                                req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                            }
                            console.log(`📡 Delayed 'new_order' Emitted for ${order_id}`);
                        }
                    }
                }
                return res.status(200).json({ status: 'ok', message: 'Updated to Paid' });
            } else {
                console.log(`[Pakasir] Order ${order_id} not found in DB`);
                return res.status(200).json({ status: 'ok', message: 'Order not found' });
            }
        }

        console.log(`[Pakasir] Webhook ignored (Status: ${status})`);
        res.status(200).json({ status: 'ok', message: 'Ignored' });

    } catch (error) {
        console.error("[Pakasir] Webhook Error:", error);
        res.status(200).json({ status: 'error', message: "Internal Error handled" });
    }
};

// 3. Status Polling Backup
const checkStatus = async (req, res) => {
    const { orderId } = req.params;
    const { amount } = req.query;

    if (!orderId || !amount) return res.status(400).json({ message: 'Missing params' });

    try {
        // OPTIMIZATION: Check Local DB First!
        // Prevents race condition where Webhook updates DB but External API is lagging
        const localOrder = await prisma.order.findUnique({ where: { transactionCode: orderId } });

        if (localOrder && localOrder.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Verified from Local DB' });
        }

        // Fallback: Check External API (Pakasir)
        const result = await fetchTransactionStatus(orderId, amount);

        if (result.transaction && isSuccessStatus(result.transaction.status)) {
            const order = localOrder || await prisma.order.findUnique({ where: { transactionCode: orderId } });

            if (order && order.paymentStatus !== 'Paid') {
                const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                const updatedOrder = await prisma.order.update({
                    where: { transactionCode: orderId },
                    data: {
                        paymentStatus: 'Paid',
                        status: newStatus
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
                console.log(`[Pakasir] Polling found PAID status for ${orderId}`);
            }
            return res.json({ success: true, status: 'Paid' });
        }

        res.json({ success: true, status: 'Pending', raw_status: result.transaction?.status });

    } catch (error) {
        console.error("[Pakasir] Check Status Error:", error);
        res.status(500).json({ success: false });
    }
};

// 4. Manual Expire for Timer
const expireOrder = async (req, res) => {
    try {
        const { orderId } = req.body;

        const order = await prisma.order.findUnique({ where: { transactionCode: orderId } });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Safety Check: Don't cancel paid orders
        if (order.paymentStatus === 'Paid') {
            return res.json({ success: false, message: 'Order already Paid' });
        }

        // Only cancel if it's waiting for payment
        if (order.status !== 'WaitingPayment') {
            return res.json({ success: false, message: 'Order status is not valid for expiry' });
        }

        await prisma.order.update({
            where: { transactionCode: orderId },
            data: {
                status: 'Cancelled',
                paymentStatus: 'Expired'
            }
        });

        console.log(`Order ${orderId} marked as EXPIRED (Timer Timeout)`);
        res.json({ success: true, message: 'Order expired successfully' });

    } catch (error) {
        console.error("Expire Error:", error);
        res.status(500).json({ success: false });
    }
};

module.exports = {
    createTransaction,
    handleCallback,
    checkStatus,
    expireOrder
};
