const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// POST /api/auth/google-login
router.post('/google-login', authController.googleLogin);

// POST /api/auth/update-fcm-token
router.post('/update-fcm-token', verifyToken, authController.updateFcmToken);

module.exports = router;
