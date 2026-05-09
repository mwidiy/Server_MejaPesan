const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getSocketByStoreId, getOrCreateVirtualTable } = require('../services/whatsappService');
const { signData } = require('../utils/security');

/**
 * Get Promotion Stats for the Kasir App
 */
const getPromotionStats = async (req, res) => {
    try {
        const storeId = req.storeId;
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));

        // 1. LOYAL: Ordered >= 3 times in last 30 days
        const loyalCustomers = await prisma.$queryRaw`
            SELECT "customerPhone", "customerName", COUNT(id) as count
            FROM "Order"
            WHERE "storeId" = ${storeId} AND "createdAt" >= ${thirtyDaysAgo}
            GROUP BY "customerPhone", "customerName"
            HAVING COUNT(id) >= 3
        `;

        // 2. CHURNING: Last order was between 14-60 days ago
        const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));
        const churningCustomers = await prisma.$queryRaw`
            SELECT "customerPhone", "customerName", MAX("createdAt") as lastOrder
            FROM "Order"
            WHERE "storeId" = ${storeId}
            GROUP BY "customerPhone", "customerName"
            HAVING MAX("createdAt") <= ${fourteenDaysAgo} AND MAX("createdAt") >= ${sixtyDaysAgo}
        `;

        res.status(200).json({
            success: true,
            data: {
                loyalCount: loyalCustomers.length,
                churningCount: churningCustomers.length
            }
        });
    } catch (error) {
        console.error('[Promotion] Stats Error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil statistik promosi' });
    }
};

/**
 * Start Sequential Broadcast Job
 */
const startBroadcast = async (req, res) => {
    try {
        const storeId = req.storeId;
        const { type } = req.body; // 'LOYAL' or 'CHURNING'
        
        const store = await prisma.store.findUnique({
            where: { id: storeId },
            include: { products: { where: { isActive: true }, take: 5 } }
        });

        if (!store.isWaBotActive) {
            return res.status(400).json({ success: false, message: 'WhatsApp Bot belum aktif' });
        }

        // Fetch target customers
        const now = new Date();
        let targets = [];
        
        if (type === 'LOYAL') {
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
            targets = await prisma.$queryRaw`
                SELECT "customerPhone", "customerName"
                FROM "Order"
                WHERE "storeId" = ${storeId} AND "createdAt" >= ${thirtyDaysAgo}
                GROUP BY "customerPhone", "customerName"
                HAVING COUNT(id) >= 3
            `;
        } else if (type === 'CHURNING') {
            const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
            const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));
            targets = await prisma.$queryRaw`
                SELECT "customerPhone", "customerName"
                FROM "Order"
                WHERE "storeId" = ${storeId}
                GROUP BY "customerPhone", "customerName"
                HAVING MAX("createdAt") <= ${fourteenDaysAgo} AND MAX("createdAt") >= ${sixtyDaysAgo}
            `;
        }

        // Filter out those who received promo recently (last 7 days)
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const recentLogs = await prisma.promotionLog.findMany({
            where: { storeId, sentAt: { gte: sevenDaysAgo } },
            select: { customerPhone: true }
        });
        const recentPhones = new Set(recentLogs.map(l => l.customerPhone));
        
        const finalTargets = targets.filter(t => !recentPhones.has(t.customerPhone));

        if (finalTargets.length === 0) {
            return res.status(200).json({ success: true, message: 'Tidak ada target promosi baru saat ini' });
        }

        // Start background process
        processBroadcast(storeId, finalTargets, type, store);

        res.status(200).json({
            success: true,
            message: `Memulai pengiriman ke ${finalTargets.length} pelanggan...`,
            targetCount: finalTargets.length
        });
    } catch (error) {
        console.error('[Promotion] Start Error:', error);
        res.status(500).json({ success: false, message: 'Gagal memulai promosi' });
    }
};

/**
 * Background Broadcast Process (Anti-Ban Protocol)
 */
async function processBroadcast(storeId, targets, type, store) {
    const sock = getSocketByStoreId(storeId);

    // TAHAP 43: Ensure virtual table exists for correct link context
    const virtualTable = await getOrCreateVirtualTable(storeId);
    console.log(`[Promotion] Starting Broadcast for Store ${storeId} to ${targets.length} targets. Sock Status: ${sock ? 'ONLINE' : 'OFFLINE'}`);
    if (!sock) {
        console.error(`[Promotion] CRITICAL: WhatsApp Socket not found for Store ${storeId}. Aborting broadcast.`);
        return;
    }

    const pwaUrl = process.env.PWA_URL || 'https://staging.quacxel.my.id';

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        
        // TAHAP 43: Robust Phone Formatting
        const cleanPhone = formatPhone(target.customerPhone);
        if (!cleanPhone) continue;

        // TAHAP 44: Determine JID Type (LID vs PN)
        const isLid = cleanPhone.length >= 14 && cleanPhone.startsWith('1');
        const jidSuffix = isLid ? '@lid' : '@s.whatsapp.net';
        const jidType = isLid ? 'lid' : 's.whatsapp.net';

        // 1. Variasi Greeting (Natural)
        const greetings = ["Halo", "Hai", "Selamat Siang", "Permisi"];
        const greeting = greetings[Math.floor(Math.random() * greetings.length)];
        
        // 2. Generate Magical Link with proper signing
        const phone = target.customerPhone; // Original stored ID
        const sig = signData(`${String(storeId)}:${String(virtualTable.id)}:${String(phone)}:${String(jidType)}`);
        const magicalLink = `${pwaUrl}/?s=${storeId}&t=${virtualTable.id}&p=${phone}&jt=${jidType}&n=${encodeURIComponent(target.customerName)}&sig=${sig}&src=promo`;
        
        // 3. Template Selection
        let message = "";
        if (type === 'LOYAL') {
            message = `${greeting} Kak *${target.customerName}*! Terima kasih banyak sudah jadi pelanggan setia *${store.name}*. Kami sangat menghargai kehadiran Kakak nih. Mampir lagi yuk hari ini, menu andalan kami siap melayani: \n\n${magicalLink}`;
        } else {
            message = `${greeting} Kak *${target.customerName}*! *${store.name}* kangen nih, udah lama Kakak nggak mampir. Yuk cek menu terbaru kita atau pesan lagi lewat link ini ya: \n\n${magicalLink}`;
        }

        try {
            // TAHAP 44: Send to proper JID (LID or PN)
            await sock.sendMessage(`${cleanPhone}${jidSuffix}`, { 
                text: message,
                linkPreview: null 
            });
            
            // Log to DB
            await prisma.promotionLog.create({
                data: {
                    storeId,
                    customerPhone: target.customerPhone,
                    type: type
                }
            });
            
            console.log(`[Promotion] Sent ${type} to ${cleanPhone} (${i + 1}/${targets.length})`);
        } catch (err) {
            console.error(`[Promotion] Failed to send to ${target.customerPhone}:`, err.message);
        }

        // 4. RANDOM DELAY (30-60 seconds) - ANTI BAN
        if (i < targets.length - 1) {
            const delay = Math.floor(Math.random() * (60000 - 30000 + 1) + 30000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    console.log(`[Promotion] Broadcast for Store ${storeId} COMPLETED.`);
}

/**
 * Helper to format phone for WhatsApp
 */
function formatPhone(phone) {
    if (!phone) return null;
    let clean = phone.replace(/\D/g, '');
    
    // TAHAP 44: LID Detection (Starts with 1 and long)
    if (clean.length >= 14 && clean.startsWith('1')) {
        return clean; // Return as-is for LID
    }

    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    }
    if (!clean.startsWith('62')) {
        clean = '62' + clean;
    }
    return clean;
}

module.exports = { getPromotionStats, startBroadcast };
