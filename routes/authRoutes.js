const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/google-login
router.post('/google-login', authController.googleLogin);

module.exports = router;
