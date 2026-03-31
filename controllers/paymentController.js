const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const admin = require('../utils/firebase');

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

// --- CUSTOM DYNAMIC QRIS ENGINE ---
function calculateCrc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function generateDynamicQris(staticQR, amount) {
    // 1. Change POI Method (Static to Dynamic)
    let modifiedStr = staticQR.replace("010211", "010212");

    // 2. Inject the Transaction Amount (Tag 54)
    let newAmtStr = Math.round(amount).toString();
    let newLenStr = newAmtStr.length.toString().padStart(2, '0');
    let tag54Payload = "54" + newLenStr + newAmtStr;
    
    if (!modifiedStr.includes("5303360")) {
        throw new Error("Tag 53 for Currency IDR (5303360) not found in the static QRIS");
    }
    modifiedStr = modifiedStr.replace("5303360", "5303360" + tag54Payload);

    // 3. Prepare String for CRC Calculation
    let crcTagIndex = modifiedStr.lastIndexOf("6304");
    if (crcTagIndex === -1) {
        throw new Error("CRC tag 6304 not found");
    }
    let strForCrc = modifiedStr.slice(0, crcTagIndex + 4);

    // 4 & 5. Calculate New CRC16 Checksum & Assemble
    let newCrc = calculateCrc16(strForCrc);
    return strForCrc + newCrc;
}

const RAW_STATIC_QRIS = "00020101021126610014COM.GO-JEK.WWW01189360091439559600780210G9559600780303UMI51440014ID.CO.QRIS.WWW0215ID10254109926280303UMI5204899953033605802ID5925MUHAMAD WIDIYANTO, Digita6008PEMALANG61055235362070703A0163046140";

// 1. Create Transaction (Get QR Data)
const createTransaction = async (req, res) => {
    const { orderId, amount, gateway = 'homemade' } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    try {
        const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });
        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        // --- MIDTRANS GATEWAY LOGIC ---
        if (gateway === 'midtrans') {
            try {
                const midtransOrderId = orderId.toString();
                const qrisParam = {
                    payment_type: "qris",
                    transaction_details: {
                        order_id: midtransOrderId,
                        gross_amount: Math.round(amount)
                    }
                };

                const chargeResponse = await coreApi.charge(qrisParam);
                const qrAction = chargeResponse.actions?.find(a => a.name === 'generate-qr-code');
                
                if (!qrAction || !qrAction.url) {
                    throw new Error("Gagal mendapatkan QR dari Midtrans");
                }

                console.log(`[Midtrans] Generated QR for Order ${orderId}`);

                return res.json({
                    success: true,
                    data: {
                        qrString: qrAction.url, // URL to QR Code Image API
                        amount: Math.round(amount),
                        orderId: orderId,
                        gateway: 'midtrans',
                        expiry: new Date(Date.now() + 15 * 60000).toISOString()
                    }
                });
            } catch (midError) {
                console.error("[Midtrans] Create Error:", midError.message || midError);
                return res.status(500).json({ success: false, message: "Gagal membuat transaksi Midtrans. Silakan gunakan server lokal." });
            }
        }

        // --- CUSTOM PG UNIQUE CODE LOGIC (SMART SEQUENTIAL) ---
        let baseAmount = Math.round(amount);
        let finalAmount = baseAmount;
        let shouldGenerateNew = true;
        
        // Prevent re-generating unique code on refresh for the SAME order
        if (order.totalAmount > baseAmount && (order.totalAmount - baseAmount) <= 999) {
            finalAmount = order.totalAmount;
            shouldGenerateNew = false;
        }

        if (shouldGenerateNew) {
            // 6 minutes expiration rule
            const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

            // Fetch all UNPAID orders with the same base amount configured within the last 6 mins
            const activeSimilarOrders = await prisma.order.findMany({
                where: {
                    totalAmount: {
                        gte: baseAmount + 1,
                        lte: baseAmount + 999
                    },
                    paymentStatus: 'Unpaid',
                    status: { in: ['WaitingPayment', 'Pending'] },
                    createdAt: { gte: sixMinutesAgo },
                    transactionCode: { not: orderId.toString() } // exclude self
                },
                select: { totalAmount: true }
            });

            // Extract used codes into a Set for O(1) lookup
            const usedCodes = new Set(activeSimilarOrders.map(o => o.totalAmount - baseAmount));

            // Find the smallest available code starting from 1
            let uniqueCode = 1;
            while (usedCodes.has(uniqueCode)) {
                uniqueCode++;
                if (uniqueCode > 999) {
                    throw new Error("Antrean pembayaran penuh, coba lagi dalam beberapa menit.");
                }
            }
            
            finalAmount = baseAmount + uniqueCode;
            
            await prisma.order.update({
                where: { id: order.id },
                data: { totalAmount: finalAmount }
            });
        }

        // --- GENERATE DYNAMIC QRIS STRING ---
        let dynamicQrisString = generateDynamicQris(RAW_STATIC_QRIS, finalAmount);
        console.log(`[Custom PG] Generated QRIS for Order ${orderId} | Nominal: Rp ${finalAmount}`);

        return res.json({
            success: true,
            data: {
                qrString: dynamicQrisString, 
                amount: finalAmount,
                orderId: orderId,
                expiry: new Date(Date.now() + 10 * 60000).toISOString()
            }
        });

    } catch (error) {
        console.error("[Custom PG] Create Error:", error.message || error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
    }
};

// 2. Webhook Handler (Instant Notification)
const handleCallback = async (req, res) => {
    try {
        const payload = req.body;
        
        // --- CUSTOM PG WEBHOOK MATCHING ---
        if (payload.app_sumber && payload.isi_pesan && payload.isi_pesan.toLowerCase().includes("pembayaran")) {
            console.log(`[Custom PG Webhook] Incoming:`, payload.isi_pesan);
            
            // Extract Amount (e.g., "Rp 15.012")
            const match = payload.isi_pesan.match(/Rp\s*([\d.,]+)/i);
            
            if (match) {
                const rawAmountStr = match[1].replace(/\./g, '').replace(/,/g, '');
                const exactAmount = parseInt(rawAmountStr, 10);
                console.log(`[Custom PG Webhook] Extracted Amount: Rp ${exactAmount}`);
                
                // Find order matching exact nominal
                const order = await prisma.order.findFirst({
                    where: {
                        totalAmount: exactAmount,
                        paymentStatus: 'Unpaid',
                        status: { in: ['WaitingPayment', 'Pending'] }
                    },
                    orderBy: { createdAt: 'desc' },
                    include: { table: { include: { location: true } }, items: { include: { product: true } } }
                });

                if (order) {
                    console.log(`[Custom PG Webhook] MATCHED Order: ${order.transactionCode}`);
                    
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
                        where: { id: order.id },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus,
                            queueNumber: generatedQueueNumber
                        },
                        include: { table: { include: { location: true } }, items: { include: { product: true } } }
                    });

                    // Emit Realtime Sockets
                    if (req.io) {
                        req.io.emit('order_update', { transactionCode: order.transactionCode, status: 'Paid', source: 'webhook-custom' });
                        req.io.to(order.transactionCode).emit('order_update', { transactionCode: order.transactionCode, status: 'Paid', source: 'webhook-custom-direct' });

                        if (order.status === 'WaitingPayment') {
                            req.io.emit('new_order', updatedOrder);
                            if (updatedOrder.storeId) {
                                req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                            }
                        }
                    }

                    // --- FCM PUSH NOTIFICATION (QRIS Payment Success) ---
                    if (updatedOrder.storeId) {
                        let storeData = null;
                        try {
                            storeData = await prisma.store.findUnique({
                                where: { id: updatedOrder.storeId },
                                include: { owner: true }
                            });
                            const fcmToken = storeData?.owner?.fcmToken;
                            if (fcmToken) {
                                const tableName = updatedOrder.table?.name || 'Takeaway';
                                const itemCount = updatedOrder.items?.length || 0;
                                const payload = {
                                    token: fcmToken,
                                    data: {
                                        type: 'new_order',
                                        title: 'Pesanan Baru (QRIS): ' + tableName,
                                        body: `Pembayaran QRIS Rp ${updatedOrder.totalAmount?.toLocaleString('id-ID') || exactAmount} diterima. ${itemCount} menu.`,
                                        transactionCode: order.transactionCode,
                                        customerName: updatedOrder.customerName || ''
                                    },
                                    android: {
                                        priority: 'high'
                                    }
                                };
                                await admin.messaging().send(payload);
                                console.log(`📲 FCM sent for QRIS payment: ${order.transactionCode}`);
                            }
                        } catch (fcmError) {
                            console.error('FCM QRIS Notification Error:', fcmError.message);
                            if (fcmError?.errorInfo?.code === 'messaging/registration-token-not-registered') {
                                try {
                                    const ownerId = storeData?.owner?.id;
                                    if (ownerId) {
                                        await prisma.user.update({ where: { id: ownerId }, data: { fcmToken: null } });
                                        console.warn(`🗑️ Stale FCM token cleared for user ${ownerId}`);
                                    }
                                } catch (cleanErr) { console.error('FCM token cleanup error:', cleanErr.message); }
                            }
                        }
                    }
                    return res.status(200).json({ status: 'ok', message: 'Order Paid via Custom PG' });
                } else {
                    console.error(`[Custom PG Webhook] NO MATCH for amount: Rp ${exactAmount}`);
                    return res.status(200).json({ status: 'ignored', message: 'No order matched this nominal' });
                }
            }
        }

        // --- MIDTRANS WEBHOOK MATCHING ---
        if (payload.transaction_status) {
            console.log(`[Midtrans Webhook] Incoming Status:`, payload.transaction_status, "for Order:", payload.order_id);
            const status = payload.transaction_status.toLowerCase();
            const orderId = payload.order_id;
            
            if (isSuccessStatus(status)) {
                // Find order matching order_id
                const order = await prisma.order.findUnique({
                    where: { transactionCode: orderId },
                    include: { table: { include: { location: true } }, items: { include: { product: true } } }
                });

                if (order && order.paymentStatus !== 'Paid') {
                    console.log(`[Midtrans Webhook] MATCHED Order: ${order.transactionCode}`);
                    
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
                        where: { id: order.id },
                        data: {
                            paymentStatus: 'Paid',
                            status: newStatus,
                            queueNumber: generatedQueueNumber
                        },
                        include: { table: { include: { location: true } }, items: { include: { product: true } } }
                    });

                    // Emit Realtime Sockets
                    if (req.io) {
                        req.io.emit('order_update', { transactionCode: order.transactionCode, status: 'Paid', source: 'webhook-midtrans' });
                        req.io.to(order.transactionCode).emit('order_update', { transactionCode: order.transactionCode, status: 'Paid', source: 'webhook-midtrans-direct' });

                        if (order.status === 'WaitingPayment') {
                            req.io.emit('new_order', updatedOrder);
                            if (updatedOrder.storeId) {
                                req.io.to(`store_${updatedOrder.storeId}`).emit('new_order', updatedOrder);
                            }
                        }
                    }

                    // --- FCM PUSH NOTIFICATION (Midtrans Payment Success) ---
                    if (updatedOrder.storeId) {
                        let storeData = null;
                        try {
                            storeData = await prisma.store.findUnique({
                                where: { id: updatedOrder.storeId },
                                include: { owner: true }
                            });
                            const fcmToken = storeData?.owner?.fcmToken;
                            if (fcmToken) {
                                const tableName = updatedOrder.table?.name || 'Takeaway';
                                const itemCount = updatedOrder.items?.length || 0;
                                const payloadFcm = {
                                    token: fcmToken,
                                    data: {
                                        type: 'new_order',
                                        title: 'Pesanan Baru (Midtrans): ' + tableName,
                                        body: `Pembayaran Midtrans Rp ${updatedOrder.totalAmount?.toLocaleString('id-ID')} diterima. ${itemCount} menu.`,
                                        transactionCode: order.transactionCode,
                                        customerName: updatedOrder.customerName || ''
                                    },
                                    android: { priority: 'high' }
                                };
                                await admin.messaging().send(payloadFcm);
                                console.log(`📲 FCM sent for Midtrans payment: ${order.transactionCode}`);
                            }
                        } catch (fcmError) {
                            console.error('FCM Midtrans Notification Error:', fcmError.message);
                        }
                    }
                    return res.status(200).json({ status: 'ok', message: 'Order Paid via Midtrans' });
                } else if (order && order.paymentStatus === 'Paid') {
                    // Already Paid
                    console.log(`[Midtrans Webhook] Order ${orderId} already paid`);
                    return res.status(200).json({ status: 'ok', message: 'Order already paid' });
                } else {
                    console.error(`[Midtrans Webhook] NO MATCH for Midtrans orderId: ${orderId}`);
                    return res.status(200).json({ status: 'ignored', message: 'No order matched this Midtrans ID' });
                }
            } else {
                console.log(`[Midtrans Webhook] Ignored non-success status: ${status} for ${orderId}`);
                return res.status(200).json({ status: 'ok', message: 'Ignored status' });
            }
        }

        // Catch-All
        res.status(200).json({ status: 'ok', message: 'Ignored unknown payload' });

    } catch (error) {
        console.error("[Custom PG] Webhook Error:", error);
        res.status(500).json({ status: 'error', message: "Internal Error" });
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

                // --- FCM PUSH NOTIFICATION (Polling Payment Confirm) ---
                if (updatedOrder.storeId && order.status === 'WaitingPayment') {
                    let storeData = null;
                    try {
                        storeData = await prisma.store.findUnique({
                            where: { id: updatedOrder.storeId },
                            include: { owner: true }
                        });
                        const fcmToken = storeData?.owner?.fcmToken;
                        if (fcmToken) {
                            const tableName = updatedOrder.table?.name || 'Takeaway';
                            const payload = {
                                token: fcmToken,
                                data: {
                                    type: 'new_order',
                                    title: 'Pesanan Baru (QRIS): ' + tableName,
                                    body: `Pembayaran QRIS diterima. ${updatedOrder.items?.length || 0} menu.`,
                                    transactionCode: orderId,
                                    customerName: updatedOrder.customerName || ''
                                },
                                android: {
                                    priority: 'high'
                                }
                            };
                            await admin.messaging().send(payload);
                            console.log(`📲 FCM sent for polling payment confirm: ${orderId}`);
                        }
                    } catch (fcmError) {
                        console.error('FCM Polling Notification Error:', fcmError.message);
                        if (fcmError?.errorInfo?.code === 'messaging/registration-token-not-registered') {
                            try {
                                const ownerId = storeData?.owner?.id;
                                if (ownerId) {
                                    await prisma.user.update({ where: { id: ownerId }, data: { fcmToken: null } });
                                    console.warn(`🗑️ Stale FCM token cleared for user ${ownerId}`);
                                }
                            } catch (cleanErr) { console.error('FCM token cleanup error:', cleanErr.message); }
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
