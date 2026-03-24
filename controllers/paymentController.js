const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const midtransClient = require('midtrans-client');
const crypto = require('crypto');

// --- MIDTRANS CONFIG ---
const coreApi = new midtransClient.CoreApi({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// Helper to check status
const fetchTransactionStatus = async (orderId) => {
    try {
        const statusResponse = await coreApi.transaction.status(orderId);
        return statusResponse;
    } catch (e) {
        console.error("Midtrans status check error", e.message);
        return null; // Might be not found yet
    }
};

const isSuccessStatus = (status) => {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'success' || s === 'settlement' || s === 'capture';
};

// 1. Create Transaction (Get QR Data)
const createTransaction = async (req, res) => {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    try {
        console.log(`[Midtrans] Start Transaction: Order ${orderId}, Amount: ${amount}`);

        // 1. Cek DB dulu
        const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });
        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        const parameter = {
            "payment_type": "gopay",
            "transaction_details": {
                "order_id": orderId.toString(),
                "gross_amount": Math.round(amount)
            },
            "custom_expiry": {
                "order_time": new Date().toISOString().replace('T', ' ').substring(0, 19) + " +0000",
                "expiry_duration": 15,
                "unit": "minute"
            }
        };

        const chargeResponse = await coreApi.charge(parameter);
        if (process.env.NODE_ENV !== 'production') console.log("[Midtrans] Core API Response:", chargeResponse);

        // Midtrans GoPay/QRIS will return actions
        if (chargeResponse.status_code == '201') {
            let qrUrl = null;
            if (chargeResponse.actions && chargeResponse.actions.length > 0) {
                // Find action with name "generate-qr-code"
                const qrAction = chargeResponse.actions.find(a => a.name === 'generate-qr-code');
                if (qrAction) qrUrl = qrAction.url;
            }

            return res.json({
                success: true,
                data: {
                    qrString: qrUrl, // We map the URL to qrString for the frontend
                    amount: chargeResponse.gross_amount,
                    orderId: chargeResponse.order_id,
                    expiry: chargeResponse.expiry_time
                }
            });
        }

        // --- HANDLING "ALREADY COMPLETED" or other errors ---
        if (chargeResponse.status_code == '406' || chargeResponse.status_code == '409') {
            // Already created, check status
            console.log("[Midtrans] Transaction exists. Checking status...");
            const check = await fetchTransactionStatus(orderId.toString());

            if (check && isSuccessStatus(check.transaction_status)) {
                if (order && order.paymentStatus !== 'Paid') {
                    const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                    const updatedOrder = await prisma.order.update({
                        where: { transactionCode: orderId.toString() },
                        data: { paymentStatus: 'Paid', status: newStatus },
                        include: { table: { include: { location: true } }, items: { include: { product: true } } }
                    });

                    // EMIT SOCKET UPDATE
                    if (req.io) {
                        req.io.emit('order_update', { transactionCode: orderId.toString(), status: 'Paid', source: 'create-check' });
                        req.io.to(orderId.toString()).emit('order_update', { transactionCode: orderId.toString(), status: 'Paid', source: 'create-check-direct' });

                        if (order.status === 'WaitingPayment') {
                            req.io.emit('new_order', updatedOrder);
                            if (updatedOrder.storeId) {
                                req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                            }
                        }
                    }
                }
                return res.json({ success: true, status: 'Paid', message: 'Transaction verified as Paid' });
            } else if (check) {
                return res.json({ success: true, status: 'Pending', message: 'Transaction exists but pending' });
            }
        }

        throw new Error(chargeResponse.status_message || "Gagal dari Midtrans");
    } catch (error) {
        console.error("[Midtrans] Create Error:", error.message || error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
    }
};

// 2. Webhook Handler (Instant Notification)
const handleCallback = async (req, res) => {
    try {
        const notificationData = req.body;
        
        // Midtrans Native Authentication
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        const hash = crypto.createHash('sha512').update(
            notificationData.order_id + notificationData.status_code + notificationData.gross_amount + serverKey
        ).digest('hex');

        if (notificationData.signature_key !== hash) {
            console.error("Invalid Midtrans Signature!");
            return res.status(403).json({ status: 'error', message: "Invalid Signature" });
        }

        const transactionStatus = notificationData.transaction_status;
        const fraudStatus = notificationData.fraud_status;
        const order_id = notificationData.order_id;

        console.log(`[Midtrans] Webhook Hit for Order: ${order_id}, Status: ${transactionStatus}`);

        if (transactionStatus == 'capture' || transactionStatus == 'settlement' || transactionStatus == 'success') {
            if (transactionStatus == 'capture' && fraudStatus == 'challenge') {
                return res.status(200).json({ status: 'ok', message: 'Challenge ignored' });
            }

            const order = await prisma.order.findUnique({ where: { transactionCode: order_id.toString() } });

            if (order) {
                if (order.paymentStatus !== 'Paid') {
                    const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                    let generatedQueueNumber = order.queueNumber;
                    if (order.status === 'WaitingPayment' && (!order.queueNumber || order.queueNumber === 0)) {
                        const parts = new Intl.DateTimeFormat('en-US', {
                            timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric'
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
                        where: { transactionCode: order_id.toString() },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus,
                            queueNumber: generatedQueueNumber
                        },
                        include: { table: { include: { location: true } }, items: { include: { product: true } } }
                    });

                    // EMIT NEW ORDER if it was waiting
                    if (req.io) {
                        req.io.emit('order_update', { transactionCode: order_id, status: 'Paid', source: 'webhook' });
                        req.io.to(order_id).emit('order_update', { transactionCode: order_id, status: 'Paid', source: 'webhook_direct' });

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
                return res.status(200).json({ status: 'ok', message: 'Order not found' });
            }
        }

        console.log(`[Midtrans] Webhook ignored (Status: ${transactionStatus})`);
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

        const result = await fetchTransactionStatus(orderId);

        if (result && isSuccessStatus(result.transaction_status)) {
            const order = localOrder || await prisma.order.findUnique({ where: { transactionCode: orderId } });

            if (order && order.paymentStatus !== 'Paid') {
                const newStatus = order.status === 'WaitingPayment' ? 'Pending' : order.status;

                let generatedQueueNumber = order.queueNumber;
                if (order.status === 'WaitingPayment' && (!order.queueNumber || order.queueNumber === 0)) {
                    const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric'
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
                    data: { paymentStatus: 'Paid', status: newStatus, queueNumber: generatedQueueNumber },
                    include: { table: { include: { location: true } }, items: { include: { product: true } } }
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
            }
            return res.json({ success: true, status: 'Paid' });
        }

        res.json({ success: true, status: 'Pending', raw_status: result?.transaction_status });

    } catch (error) {
        console.error("[Midtrans] Check Status Error:", error);
        res.status(500).json({ success: false });
    }
};

// 4. Manual Expire for Timer
const expireOrder = async (req, res) => {
    try {
        const { orderId } = req.body;

        const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.paymentStatus === 'Paid') {
            return res.json({ success: false, message: 'Order already Paid' });
        }

        try {
            await coreApi.transaction.cancel(orderId.toString());
        } catch(e) {
            console.error("Cancel Midtrans failed, might already be canceled", e.message);
        }

        if (order.status !== 'WaitingPayment') {
            return res.json({ success: false, message: 'Order status is not valid for expiry' });
        }

        await prisma.order.update({
            where: { transactionCode: orderId.toString() },
            data: { status: 'Cancelled', paymentStatus: 'Expired' }
        });

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
