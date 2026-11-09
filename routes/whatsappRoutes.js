const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');

/**
 * WhatsApp routes - Disabled for performance and ban prevention
 */
router.post('/init', verifyToken, (req, res) => {
    res.json({ 
        success: false, 
        message: 'Fitur WhatsApp Bot telah dinonaktifkan demi performa & keamanan akun.' 
    });
});

router.post('/pair', verifyToken, (req, res) => {
    res.json({ 
        success: false, 
        message: 'Fitur WhatsApp Bot telah dinonaktifkan demi performa & keamanan akun.' 
    });
});

router.get('/status', verifyToken, (req, res) => {
    res.json({
        success: true,
        status: 'disabled',
        isDbActive: false
    });
});

router.post('/disconnect', verifyToken, (req, res) => {
    res.json({ 
        success: true, 
        message: 'WhatsApp sudah tidak aktif.' 
    });
});

router.get('/promotion/stats', verifyToken, (req, res) => {
    res.json({ success: true, totalSent: 0, loyal: 0, churning: 0, feedback: 0 });
});

router.post('/promotion/start', verifyToken, (req, res) => {
    res.json({ success: false, message: 'Fitur broadcast WhatsApp dinonaktifkan.' });
});

router.get('/blast/segments', verifyToken, (req, res) => {
    res.json({ success: true, segments: [] });
});

router.post('/blast/send', verifyToken, (req, res) => {
    res.json({ success: false, message: 'Fitur blast WhatsApp dinonaktifkan.' });
});

module.exports = router;
