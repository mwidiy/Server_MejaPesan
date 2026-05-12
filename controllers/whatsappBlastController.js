const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const whatsappService = require('../services/whatsappService');
const { generateShortLink } = require('../utils/urlShortener');
const { signData } = require('../utils/security');

/**
 * Get customers by segment (Loyal or Lapsed)
 */
const getSegments = async (req, res) => {
    try {
        const { storeId } = req.params;
        const sId = parseInt(storeId);

        // 1. Pelanggan Setia (Loyal)
        // Kriteria: Order > 2 kali dalam 30 hari terakhir
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const loyalRaw = await prisma.order.groupBy({
            by: ['customerPhone', 'customerName', 'customerPhoneJidType'],
            where: {
                storeId: sId,
                paymentStatus: 'Paid',
                createdAt: { gte: thirtyDaysAgo },
                customerPhone: { not: null }
            },
            _count: {
                id: true
            },
            having: {
                id: { _count: { gte: 3 } }
            }
        });

        // 2. Pelanggan Jarang Pesen (Lapsed)
        // Kriteria: Pernah order, tapi order terakhir > 14 hari yang lalu
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        // Subquery approach: Get all customers and their last order date
        const allCustomers = await prisma.order.groupBy({
            by: ['customerPhone', 'customerName', 'customerPhoneJidType'],
            where: {
                storeId: sId,
                customerPhone: { not: null }
            },
            _max: {
                createdAt: true
            }
        });

        const lapsedRaw = allCustomers.filter(c => {
            const lastOrder = new Date(c._max.createdAt);
            return lastOrder < fourteenDaysAgo;
        });

        res.json({
            success: true,
            data: {
                loyalCount: loyalRaw.length,
                lapsedCount: lapsedRaw.length,
                segments: {
                    loyal: loyalRaw,
                    lapsed: lapsedRaw
                }
            }
        });
    } catch (err) {
        console.error('[Blast] Segment Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Send Blast to a segment
 */
const sendBlast = async (req, res) => {
    try {
        const { storeId, segment, message } = req.body;
        const sId = parseInt(storeId);

        if (!message) return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong.' });

        const sock = whatsappService.getSocketByStoreId(sId);
        if (!sock) return res.status(400).json({ success: false, message: 'WhatsApp Bot tidak aktif. Silakan hubungkan dulu.' });

        // Get recipients based on segment
        let recipients = [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        if (segment === 'loyal') {
            recipients = await prisma.order.groupBy({
                by: ['customerPhone', 'customerName', 'customerPhoneJidType'],
                where: {
                    storeId: sId,
                    paymentStatus: 'Paid',
                    createdAt: { gte: thirtyDaysAgo },
                    customerPhone: { not: null }
                },
                _count: { id: true },
                having: { id: { _count: { gte: 3 } } }
            });
        } else if (segment === 'lapsed') {
            const all = await prisma.order.groupBy({
                by: ['customerPhone', 'customerName', 'customerPhoneJidType'],
                where: { storeId: sId, customerPhone: { not: null } },
                _max: { createdAt: true }
            });
            recipients = all.filter(c => new Date(c._max.createdAt) < fourteenDaysAgo);
        }

        if (recipients.length === 0) {
            return res.json({ success: true, message: 'Tidak ada pelanggan dalam segmen ini.' });
        }

        // Process Blast
        const virtualTable = await whatsappService.getOrCreateVirtualTable(sId);
        const pwaUrl = process.env.PWA_URL || 'https://quacxel.my.id';

        let successCount = 0;
        for (const customer of recipients) {
            const phone = customer.customerPhone;
            const jidType = customer.customerPhoneJidType || 's.whatsapp.net';
            const name = customer.customerName || 'Kak';

            // Generate Magical Link
            const sig = signData(`${String(sId)}:${String(virtualTable.id)}:${String(phone)}:${String(jidType)}`);
            const longLink = `${pwaUrl}/?s=${sId}&t=${virtualTable.id}&p=${phone}&jt=${jidType}&n=${encodeURIComponent(name)}&sig=${sig}`;
            
            // Shorten it!
            const shortCode = await generateShortLink(longLink);
            const shortLink = `${process.env.API_PUBLIC_URL || 'http://localhost:3000'}/go/${shortCode}`;

            // Replace placeholder in message
            const finalMessage = message
                .replace(/{{nama}}/g, name)
                .replace(/{{link}}/g, shortLink);

            const sent = await whatsappService.sendWAMessage(sId, `${phone}@${jidType}`, finalMessage);
            if (sent) {
                successCount++;
                // Log to PromotionLog
                await prisma.promotionLog.create({
                    data: {
                        storeId: sId,
                        customerPhone: phone,
                        type: segment.toUpperCase()
                    }
                }).catch(() => {});
            }

            // Small delay to prevent spam detection
            await new Promise(r => setTimeout(r, 2000));
        }

        res.json({
            success: true,
            message: `Blast terkirim ke ${successCount} dari ${recipients.length} pelanggan.`
        });
    } catch (err) {
        console.error('[Blast] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getSegments,
    sendBlast
};
