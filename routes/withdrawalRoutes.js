const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const { verifyToken } = require('../middleware/authMiddleware');

// Public Route (Telegram Webhook)
router.get('/process', withdrawalController.processWithdrawal);
router.post('/process', withdrawalController.processWithdrawal);

// All routes require authentication
router.use(verifyToken);

router.get('/balance', withdrawalController.getBalance);
router.post('/request', withdrawalController.requestWithdrawal);
router.get('/history', withdrawalController.getHistory);

module.exports = router;
