const express = require('express');
const router = express.Router();
const { initWASession, sessions } = require('../services/whatsappService');
const { verifyToken } = require('../middleware/authMiddleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Trigger WhatsApp QR Generation
 * Protected by verifyToken to ensure only the store owner can trigger it
 */
router.post('/init', verifyToken, async (req, res) => {
    try {
        const storeId = req.storeId; // Extracted from token by middleware
        
        if (!storeId) {
            return res.status(400).json({ success: false, message: 'Store ID tidak ditemukan dalam token.' });
        }

        // TAHAP 37: Optimization - Don't re-init if already connected
        const existingSock = sessions.get(parseInt(storeId));
        if (existingSock && existingSock.user) {
            return res.json({ 
                success: true, 
                message: 'WhatsApp sudah terhubung.',
                status: 'connected'
            });
        }

        // Initialize session (this will emit QR via Socket.io)
        await initWASession(storeId, req.io);

        res.json({ 
            success: true, 
            message: 'Inisialisasi WhatsApp dimulai. Silakan cek Socket.io untuk QR Code.' 
        });
    } catch (err) {
        console.error('[WA Route] Error init:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get current WhatsApp status
 */
router.get('/status', verifyToken, async (req, res) => {
    try {
        const storeId = req.storeId;
        const sock = sessions.get(parseInt(storeId));
        // TAHAP 36: More accurate status check (check if authenticated)
        const isConnected = sock && sock.user ? 'connected' : 'disconnected';
        
        const store = await prisma.store.findUnique({
            where: { id: parseInt(storeId) },
            select: { isWaBotActive: true }
        });

        res.json({
            success: true,
            status: isConnected,
            isDbActive: store?.isWaBotActive || false
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Disconnect/Logout WhatsApp
 */
router.post('/disconnect', verifyToken, async (req, res) => {
    try {
        const storeId = req.storeId;
        const sock = sessions.get(storeId);
        
        if (sock) {
            await sock.logout();
            sessions.delete(storeId);
        }

        await prisma.store.update({
            where: { id: parseInt(storeId) },
            data: { isWaBotActive: false }
        });

        res.json({ success: true, message: 'WhatsApp berhasil diputuskan.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
