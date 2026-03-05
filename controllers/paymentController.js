const { PrismaClient } = require('@prisma/client');
const { getDuitkuSignature, getDuitkuCallbackSignature } = require('../utils/crypto');
const prisma = new PrismaClient();

// --- DUITKU CONFIG ---
const DUITKU_API_KEY = process.env.DUITKU_API_KEY;
const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE;
const DUITKU_ENV = process.env.DUITKU_ENV || 'sandbox'; // 'sandbox' atau 'production'

const DUITKU_BASE_URL = DUITKU_ENV === 'sandbox'
    ? 'https://sandbox.duitku.com/webapi/api/merchant'
    : 'https://passport.duitku.com/webapi/api/merchant';

const callbackUrl = process.env.DUITKU_CALLBACK_URL || 'https://api.quacxel.my.id/api/payments/webhook';

// 1. Create Transaction (Inquiry)
const createTransaction = async (req, res) => {
    const { orderId, amount, customerName = 'Customer', email = 'customer@quacxel.my.id', phone = '08123456789' } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    if (!DUITKU_MERCHANT_CODE || !DUITKU_API_KEY) {
        console.error("❌ Duitku configs are missing in .env");
        return res.status(500).json({ success: false, message: 'Server Config Error' });
    }

    try {
        console.log(`[Duitku] Start Transaction: Order ${orderId}, Amount: ${amount}`);

        // 1. Cek DB dulu
        const order = await prisma.order.findUnique({
            where: { transactionCode: orderId.toString() },
            include: { items: { include: { product: true } } }
        });

        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        const finalAmount = parseInt(amount);
        const signature = getDuitkuSignature(DUITKU_MERCHANT_CODE, orderId.toString(), finalAmount, DUITKU_API_KEY);

        console.log(`[Duitku Debug] Signature String Components: Code=${DUITKU_MERCHANT_CODE}, OrderId=${orderId.toString()}, Amount=${finalAmount}, Key=${DUITKU_API_KEY}`);

        // Build Item Details
        const itemDetails = order?.items?.map(item => ({
            name: item.product.name.substring(0, 50),
            price: item.price,
            quantity: item.quantity
        })) || [{
            name: "Pesanan QuackXel",
            price: finalAmount,
            quantity: 1
        }];

        const payload = {
            merchantCode: DUITKU_MERCHANT_CODE,
            paymentAmount: finalAmount,
            paymentMethod: "SP", // Gunakan SP (ShopeePay/QRIS) sbg default test. Wajib diaktifkan di dashboard Sandbox Duitku!
            merchantOrderId: orderId.toString(),
            productDetails: `Pesanan QuackXel #${orderId}`,
            email: email,
            phoneNumber: phone,
            itemDetails: itemDetails,
            customerVaName: customerName,
            callbackUrl: callbackUrl,
            returnUrl: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/order/${orderId}` : `https://quacxel.my.id/order/${orderId}`,
            signature: signature,
            expiryPeriod: 15 // 15 mins expiry
        };

        const response = await fetch(`${DUITKU_BASE_URL}/v2/inquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (process.env.NODE_ENV !== 'production') console.log("[Duitku] Inquiry Response:", result);

        if (result.statusCode === '00') {
            return res.json({
                success: true,
                data: {
                    paymentUrl: result.paymentUrl,
                    reference: result.reference,
                    amount: amount,
                    orderId: orderId.toString()
                }
            });
        }

        let errorMessage = result.statusMessage || result.Message || 'Gagal membuat tagihan Duitku';

        // Peringatan khusus jika Merchant belum mengaktifkan metode pembayaran di Sandbox Duitku
        if (errorMessage.toLowerCase().includes('payment channel not available')) {
            errorMessage = "Metode Pembayaran belum diaktifkan. Silakan login ke Dashboard Sandbox Duitku -> My Project -> Centang metode ShopeePay (SP) / QRIS.";
        }

        console.error("[Duitku] Failed Creating Payment Link:", result);
        res.status(400).json({
            success: false,
            message: errorMessage,
            details: result
        });

    } catch (error) {
        console.error("[Duitku] Create Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// 2. Webhook Handler
const handleCallback = async (req, res) => {
    try {
        const { merchantOrderId, amount, resultCode, signature } = req.body;
        console.log(`[Duitku] Webhook Hit for Order: ${merchantOrderId}, Status Code: ${resultCode}`);

        if (!merchantOrderId || !amount || !resultCode || !signature) {
            return res.status(400).json({ status: 'error', message: 'Bad Request' });
        }

        // Validasi Signature
        const expectedSignature = getDuitkuCallbackSignature(DUITKU_MERCHANT_CODE, amount, merchantOrderId, DUITKU_API_KEY);
        if (signature !== expectedSignature) {
            console.error(`[Duitku] 🚨 Invalid Signature for Order ${merchantOrderId}`);
            return res.status(400).json({ status: 'error', message: 'Invalid Signature' });
        }

        if (resultCode === '00') { // 00 = Success
            const order = await prisma.order.findUnique({ where: { transactionCode: merchantOrderId.toString() } });

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
                        where: { transactionCode: merchantOrderId.toString() },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus,
                            queueNumber: generatedQueueNumber
                        },
                        include: {
                            table: { include: { location: true } },
                            items: { include: { product: true } }
                        }
                    });
                    console.log(`[Duitku] Order ${merchantOrderId} UPDATED to Paid (Queue: ${generatedQueueNumber})`);

                    if (req.io) {
                        req.io.emit('order_update', { transactionCode: merchantOrderId, status: 'Paid', source: 'webhook' });
                        req.io.to(merchantOrderId).emit('order_update', { transactionCode: merchantOrderId, status: 'Paid', source: 'webhook_direct' });

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
                console.log(`[Duitku] Order ${merchantOrderId} not found in DB`);
                return res.status(200).json({ status: 'ok', message: 'Order not found' });
            }
        }

        console.log(`[Duitku] Webhook ignored (ResultCode: ${resultCode})`);
        res.status(200).json({ status: 'ok', message: 'Ignored' });

    } catch (error) {
        console.error("[Duitku] Webhook Error:", error);
        res.status(200).json({ status: 'error', message: "Internal Error handled" });
    }
};

// 3. Status Polling Backup
const checkStatus = async (req, res) => {
    const { orderId } = req.params;
    let { amount } = req.query; // PWA mungkin ngirim amount

    if (!orderId) return res.status(400).json({ message: 'Missing params' });

    try {
        const localOrder = await prisma.order.findUnique({ where: { transactionCode: orderId } });

        if (localOrder && localOrder.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Verified from Local DB' });
        }

        // Tembak Duitku Check Status API
        // Signature: MD5(merchantCode + merchantOrderId + apiKey)
        const signatureCheck = generateMD5(`${DUITKU_MERCHANT_CODE}${orderId}${DUITKU_API_KEY}`);

        const payload = {
            merchantCode: DUITKU_MERCHANT_CODE,
            merchantOrderId: orderId.toString(),
            signature: signatureCheck
        };

        const response = await fetch(`${DUITKU_BASE_URL}/transactionStatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.statusCode === '00') {
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
                console.log(`[Duitku] Polling found PAID status for ${orderId}`);
            }
            return res.json({ success: true, status: 'Paid' });
        }

        res.json({ success: true, status: 'Pending', raw_status: result.statusMessage });

    } catch (error) {
        console.error("[Duitku] Check Status Error:", error);
        res.status(500).json({ success: false });
    }
};

const { generateMD5 } = require('../utils/crypto'); // Need generateMD5 for status check

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

module.exports = {
    createTransaction,
    handleCallback,
    checkStatus,
    expireOrder
};
