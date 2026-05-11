const express = require('express');
const router = express.Router();
const { initWASession, sessions, disconnectWA, getWAStatus } = require('../services/whatsappService');
const { verifyToken } = require('../middleware/authMiddleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getPromotionStats, startBroadcast } = require('../controllers/promotionController');

/**
 * TAHAP 40: Universal WhatsApp Init (Pairing Code Only)
 * Both /init and /pair now trigger the same Pairing Code logic
 */
const handleInit = async (req, res) => {
    try {
        const storeId = req.storeId;
        if (!storeId) return res.status(400).json({ success: false, message: 'Store ID tidak ditemukan.' });

        // TAHAP 40: Strict Real-time Validation (Always re-fetch from DB)
        const store = await prisma.store.findUnique({
            where: { id: parseInt(storeId) },
            select: { whatsappNumber: true }
        });

        if (!store || !store.whatsappNumber) {
            return res.status(400).json({ 
                success: false, 
                message: 'Gagal: Nomor WhatsApp belum diatur di Pengaturan Resto.' 
            });
        }

        const numericStoreId = parseInt(storeId);
        const existingSock = sessions.get(numericStoreId);
        if (existingSock && existingSock.user) {
            return res.json({ success: true, message: 'WhatsApp sudah terhubung.', status: 'connected' });
        }

        const { waType } = req.body;
        // TAHAP 41: Robust IO handling (fallback to global if req.app.get is empty)
        const io = req.app.get('io') || global.ioInstance;
        
        // initWASession now automatically fetches number and requests pairing code
        await initWASession(storeId, io, waType || 'standard');
        res.json({ success: true, message: 'Proses pairing dimulai. Silakan cek kode di aplikasi.' });
    } catch (err) {
        console.error('[WA Route] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

router.post('/init', verifyToken, handleInit);
router.post('/pair', verifyToken, handleInit);

/**
 * Get current WhatsApp status
 */
router.get('/status', verifyToken, async (req, res) => {
    try {
        const storeId = req.storeId;
        const status = getWAStatus(storeId);
        
        const store = await prisma.store.findUnique({
            where: { id: parseInt(storeId) },
            select: { isWaBotActive: true }
        });

        res.json({
            success: true,
            status: status,
            isDbActive: store?.isWaBotActive || false
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Manual disconnect
 */
router.post('/disconnect', verifyToken, async (req, res) => {
    try {
        const storeId = req.storeId;
        const success = await disconnectWA(parseInt(storeId));
        if (success) {
            const io = req.app.get('io');
            if (io) io.to(`store_${storeId}`).emit('wa_status', { status: 'disconnected' });
            res.json({ success: true, message: 'WhatsApp berhasil diputuskan.' });
        } else {
            res.status(400).json({ success: false, message: 'Gagal memutuskan atau tidak ada sesi aktif.' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Promotion / Broadcast Routes
 */
router.get('/promotion/stats', verifyToken, getPromotionStats);
router.post('/promotion/start', verifyToken, startBroadcast);

module.exports = router;
