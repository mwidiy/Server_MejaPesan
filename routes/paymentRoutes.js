const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// 1. Create Transaction (Get QR)
router.post('/create-transaction', paymentController.createTransaction);

// 2. Webhook Callback
// Pakasir sends URL-encoded or JSON. Express handles JSON by default, 
// Safest to add both middleware in index.js or specific here.
router.post('/callback', express.urlencoded({ extended: true }), paymentController.handleCallback);
router.post('/webhook', express.urlencoded({ extended: true }), paymentController.handleCallback); // Webhook Alias

// 3. Polling Status (Backup)
// 3. Polling Status (Backup)
router.get('/check-status/:orderId', paymentController.checkStatus);

// 4. Expire Order (Timer Timeout)
router.post('/expire-order', express.urlencoded({ extended: true }), paymentController.expireOrder);

module.exports = router;
