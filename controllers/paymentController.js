const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const admin = require('../utils/firebase');
const NodeCache = require('node-cache');
const { sendWAMessage } = require('../services/whatsappService');

const midtransClient = require('midtrans-client');
const crypto = require('crypto');

// --- PERFORMANCE: In-Memory Cache for Active Unique Codes (TTL 6 min) ---
const uniqueCodeCache = new NodeCache({ stdTTL: 360, checkperiod: 60 });

// --- MIDTRANS CONFIG ---
const coreApi = new midtransClient.CoreApi({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

const snapApi = new midtransClient.Snap({
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

// Helper: Generate Midtrans Snap Token
const getMidtransSnapToken = async (orderId, amount) => {
    try {
        const midtransOrderId = `${orderId.toString()}_MD_${Date.now()}`;
        const parameter = {
            transaction_details: {
                order_id: midtransOrderId,
                gross_amount: Math.round(amount)
            },
            customer_details: {
                first_name: "Customer",
            }
        };

        const transaction = await snapApi.createTransaction(parameter);
        if (!transaction.token) throw new Error("Midtrans tidak mengembalikan Snap Token.");

        return {
            snapToken: transaction.token,
            clientKey: process.env.MIDTRANS_CLIENT_KEY,
            isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
            amount: Math.round(amount),
            finalAmount: Math.round(amount),
            orderId: midtransOrderId,
            gateway: 'midtrans',
            expiry: new Date(Date.now() + 15 * 60000).toISOString()
        };
    } catch (midError) {
        console.error("[Midtrans Helper] Error:", midError.message);
        throw midError;
    }
};

// Helper: Generate Custom QRIS with Unique Code
const getCustomQRIS = async (orderId, amount, currentOrderTotal) => {
    try {
        let baseAmount = Math.round(amount);
        let finalAmount = baseAmount;
        let shouldGenerateNew = true;

        // Prevent re-generating unique code if already present (within 1-999 range)
        if (currentOrderTotal > baseAmount && (currentOrderTotal - baseAmount) <= 999) {
            finalAmount = currentOrderTotal;
            shouldGenerateNew = false;
        }

        if (shouldGenerateNew) {
            const cacheKey = `uq_${baseAmount}`;
            let usedCodes = uniqueCodeCache.get(cacheKey);

            if (!usedCodes) {
                const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
                const activeSimilarOrders = await prisma.order.findMany({
                    where: {
                        totalAmount: { gte: baseAmount + 1, lte: baseAmount + 999 },
                        paymentStatus: 'Unpaid',
                        status: { in: ['WaitingPayment', 'Pending'] },
                        createdAt: { gte: sixMinutesAgo },
                        transactionCode: { not: orderId.toString() }
                    },
                    select: { totalAmount: true }
                });
                usedCodes = activeSimilarOrders.map(o => o.totalAmount - baseAmount);
            }

            const usedSet = new Set(usedCodes);
            let uniqueCode = 1;
            while (usedSet.has(uniqueCode)) {
                uniqueCode++;
                if (uniqueCode > 999) throw new Error("Antrean pembayaran penuh, coba lagi dalam beberapa menit.");
            }

            finalAmount = baseAmount + uniqueCode;
            usedCodes = [...(Array.isArray(usedCodes) ? usedCodes : []), uniqueCode];
            uniqueCodeCache.set(cacheKey, usedCodes);

            // Update local DB with final amount (this reflects the unique code)
            await prisma.order.update({
                where: { transactionCode: orderId.toString() },
                data: { totalAmount: finalAmount }
            });
        }

        let dynamicQrisString = generateDynamicQris(RAW_STATIC_QRIS, finalAmount);
        return {
            qrString: dynamicQrisString,
            amount: finalAmount,
            finalAmount: finalAmount,
            orderId: orderId,
            expiry: new Date(Date.now() + 10 * 60000).toISOString(),
            gateway: 'homemade'
        };
    } catch (error) {
        console.error("[Custom PG Helper] Error:", error.message);
        throw error;
    }
};

// 1. Create Transaction (Get QR Data)
const createTransaction = async (req, res) => {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing orderId or amount' });
    }

    try {
        let gateway = 'homemade';
        const config = await prisma.systemConfig.findUnique({
            where: { key: 'GLOBAL_PAYMENT_GATEWAY' }
        });
        if (config && config.value) gateway = config.value;

        const order = await prisma.order.findUnique({ where: { transactionCode: orderId.toString() } });
        if (order && order.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Order already paid' });
        }

        if (gateway === 'midtrans') {
            const data = await getMidtransSnapToken(orderId, amount);
            return res.json({ success: true, data });
        } else {
            const data = await getCustomQRIS(orderId, amount, order.totalAmount);
            return res.json({ success: true, data });
        }

    } catch (error) {
        console.error("[Create Transaction] Error:", error.message);
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

                    // FIRE-AND-FORGET: Respond to webhook IMMEDIATELY, then process side-effects in background
                    const _io = req.io;
                    const _orderTC = order.transactionCode;
                    const _orderStatus = order.status;
                    const _updatedOrder = updatedOrder;
                    const _exactAmount = exactAmount;

                    // Respond 200 INSTANTLY to webhook provider
                    res.status(200).json({ status: 'ok', message: 'Order Paid via Custom PG' });

                    // Background: Socket.IO + FCM (non-blocking)
                    setTimeout(async () => {
                        try {
                            if (_io) {
                                _io.emit('order_update', { transactionCode: _orderTC, status: 'Paid', source: 'webhook-custom' });
                                _io.to(_orderTC).emit('order_update', { transactionCode: _orderTC, status: 'Paid', source: 'webhook-custom-direct' });

                                if (_orderStatus === 'WaitingPayment') {
                                    _io.emit('new_order', _updatedOrder);
                                    if (_updatedOrder.storeId) {
                                        _io.to(`store_${_updatedOrder.storeId}`).emit('new_order', _updatedOrder);
                                    }
                                }
                            }

                            // FCM Push Notification
                            if (_updatedOrder.storeId) {
                                let storeData = null;
                                try {
                                    storeData = await prisma.store.findUnique({
                                        where: { id: _updatedOrder.storeId },
                                        include: { owner: true }
                                    });
                                    const fcmToken = storeData?.owner?.fcmToken;
                                    if (fcmToken) {
                                        const tableName = _updatedOrder.table?.name || 'Takeaway';
                                        const itemCount = _updatedOrder.items?.length || 0;
                                        const payload = {
                                            token: fcmToken,
                                            data: {
                                                type: 'new_order',
                                                title: 'Pesanan Baru (QRIS): ' + tableName,
                                                body: `Pembayaran QRIS Rp ${_updatedOrder.totalAmount?.toLocaleString('id-ID') || _exactAmount} diterima. ${itemCount} menu.`,
                                                transactionCode: _orderTC,
                                                customerName: _updatedOrder.customerName || ''
                                            },
                                            android: { priority: 'high' }
                                        };
                                        await admin.messaging().send(payload);
                                        console.log(`📲 FCM sent for QRIS payment: ${_orderTC}`);
                                    }
                                } catch (fcmError) {
                                    console.error('FCM QRIS Notification Error:', fcmError.message);
                                }

                                // TAHAP WA: Send WhatsApp Confirmation for QRIS Paid
                                if (_updatedOrder.customerPhone && _updatedOrder.storeId) {
                                    try {
                                        const waMessage = `✅ *Pembayaran Berhasil!*\n\nTerima kasih kak *${_updatedOrder.customerName}*, pembayaran Rp ${_updatedOrder.totalAmount?.toLocaleString('id-ID')} sudah kami terima.\n\n🆔 Kode: *${_orderTC}*\n\nPesanan kamu sekarang sedang diproses. Mohon ditunggu ya kak! 🍳`;
                                        const fullJid = `${_updatedOrder.customerPhone}@${_updatedOrder.customerPhoneJidType || 's.whatsapp.net'}`;
                                        await sendWAMessage(_updatedOrder.storeId, fullJid, waMessage);
                                        console.log(`[WA] Sent Payment Confirmation to ${_updatedOrder.customerPhone}`);
                                    } catch (waErr) {
                                        console.error('[WA] Failed to send payment confirmation:', waErr.message);
                                    }
                                }
                            }
                        } catch (bgErr) {
                            console.error('[Custom PG Webhook] Background task error:', bgErr.message);
                        }
                    }, 0);
                    return; // Already responded above
                } else {
                    console.error(`[Custom PG Webhook] NO MATCH for amount: Rp ${exactAmount}`);
                    return res.status(200).json({ status: 'ignored', message: 'No order matched this nominal' });
                }
            }
        }

        // --- MIDTRANS WEBHOOK MATCHING ---
        if (payload.transaction_status) {
            const status = payload.transaction_status.toLowerCase();
            const fullOrderId = payload.order_id;
            const actualOrderId = fullOrderId.split('_MD_')[0]; // Ambil ID asli lokal

            console.log(`[Midtrans Webhook] Incoming Status:`, status, "for Order:", actualOrderId);
            
            if (isSuccessStatus(status)) {
                // Find order matching actualOrderId
                const order = await prisma.order.findUnique({
                    where: { transactionCode: actualOrderId },
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

                    // FIRE-AND-FORGET: Respond to Midtrans webhook IMMEDIATELY
                    const _ioMT = req.io;
                    const _orderTCMT = order.transactionCode;
                    const _orderStatusMT = order.status;
                    const _updatedOrderMT = updatedOrder;

                    res.status(200).json({ status: 'ok', message: 'Order Paid via Midtrans' });

                    // Background: Socket.IO + FCM
                    setTimeout(async () => {
                        try {
                            if (_ioMT) {
                                _ioMT.emit('order_update', { transactionCode: _orderTCMT, status: 'Paid', source: 'webhook-midtrans' });
                                _ioMT.to(_orderTCMT).emit('order_update', { transactionCode: _orderTCMT, status: 'Paid', source: 'webhook-midtrans-direct' });

                                if (_orderStatusMT === 'WaitingPayment') {
                                    _ioMT.emit('new_order', _updatedOrderMT);
                                    if (_updatedOrderMT.storeId) {
                                        _ioMT.to(`store_${_updatedOrderMT.storeId}`).emit('new_order', _updatedOrderMT);
                                    }
                                }
                            }

                            if (_updatedOrderMT.storeId) {
                                let storeData = null;
                                try {
                                    storeData = await prisma.store.findUnique({
                                        where: { id: _updatedOrderMT.storeId },
                                        include: { owner: true }
                                    });
                                    const fcmToken = storeData?.owner?.fcmToken;
                                    if (fcmToken) {
                                        const tableName = _updatedOrderMT.table?.name || 'Takeaway';
                                        const itemCount = _updatedOrderMT.items?.length || 0;
                                        const payloadFcm = {
                                            token: fcmToken,
                                            data: {
                                                type: 'new_order',
                                                title: 'Pesanan Baru (Midtrans): ' + tableName,
                                                body: `Pembayaran Midtrans Rp ${_updatedOrderMT.totalAmount?.toLocaleString('id-ID')} diterima. ${itemCount} menu.`,
                                                transactionCode: _orderTCMT,
                                                customerName: _updatedOrderMT.customerName || ''
                                            },
                                            android: { priority: 'high' }
                                        };
                                        await admin.messaging().send(payloadFcm);
                                        console.log(`📲 FCM sent for Midtrans payment: ${_orderTCMT}`);
                                    }
                                } catch (fcmError) {
                                    console.error('FCM Midtrans Notification Error:', fcmError.message);
                                }

                                // TAHAP WA: Send WhatsApp Confirmation for Midtrans Paid
                                if (_updatedOrderMT.customerPhone && _updatedOrderMT.storeId) {
                                    try {
                                        const waMessage = `✅ *Pembayaran Berhasil (QRIS)!*\n\nTerima kasih kak *${_updatedOrderMT.customerName}*, pembayaran Rp ${_updatedOrderMT.totalAmount?.toLocaleString('id-ID')} via Midtrans sudah kami terima.\n\n🆔 Kode: *${_orderTCMT}*\n\nPesanan kamu sekarang sedang diproses. Mohon ditunggu ya kak! 🍳`;
                                        const fullJid = `${_updatedOrderMT.customerPhone}@${_updatedOrderMT.customerPhoneJidType || 's.whatsapp.net'}`;
                                        await sendWAMessage(_updatedOrderMT.storeId, fullJid, waMessage);
                                        console.log(`[WA] Sent Midtrans Payment Confirmation to ${_updatedOrderMT.customerPhone}`);
                                    } catch (waErr) {
                                        console.error('[WA] Failed to send Midtrans confirmation:', waErr.message);
                                    }
                                }
                            }
                        } catch (bgErr) {
                            console.error('[Midtrans Webhook] Background task error:', bgErr.message);
                        }
                    }, 0);
                    return; // Already responded above
                } else if (order && order.paymentStatus === 'Paid') {
                    // Already Paid
                    console.log(`[Midtrans Webhook] Order ${actualOrderId} already paid`);
                    return res.status(200).json({ status: 'ok', message: 'Order already paid' });
                } else {
                    console.error(`[Midtrans Webhook] NO MATCH for Midtrans orderId: ${actualOrderId}`);
                    return res.status(200).json({ status: 'ignored', message: 'No order matched this Midtrans ID' });
                }
            } else {
                console.log(`[Midtrans Webhook] Ignored non-success status: ${status} for ${actualOrderId}`);
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

// 3. Status Polling Backup (DB-ONLY — NO external API calls)
const checkStatus = async (req, res) => {
    const { orderId } = req.params;

    if (!orderId) return res.status(400).json({ message: 'Missing params' });

    const actualOrderId = orderId.split('_MD_')[0];

    try {
        // PERFORMANCE: Only query local DB. Webhook handles Midtrans status updates.
        const localOrder = await prisma.order.findUnique({
            where: { transactionCode: actualOrderId },
            select: { paymentStatus: true }
        });

        if (localOrder && localOrder.paymentStatus === 'Paid') {
            return res.json({ success: true, status: 'Paid', message: 'Verified from Local DB' });
        }

        // Not paid yet — webhook hasn't fired
        res.json({ success: true, status: 'Pending' });

    } catch (error) {
        console.error("[Check Status] DB Error:", error);
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
    expireOrder,
    getMidtransSnapToken,
    getCustomQRIS
};
