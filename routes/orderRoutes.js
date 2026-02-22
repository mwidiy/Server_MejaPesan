const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// POST /api/orders
// POST /api/orders/batch (Ambil Banyak Pesanan)
router.post('/batch', orderController.getOrdersByBatch);

const { verifyToken } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate Limiter: Max 5 orders per minute per IP to prevent spam
const orderLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: { error: "Teralu banyak permintaan, coba lagi nanti." },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /api/orders (Buat Pesanan - Public customer) - Rate Limited
router.post('/', orderLimiter, orderController.createOrder);

// GET /api/orders (Ambil Semua - Protected Admin)
router.get('/', verifyToken, orderController.getAllOrders);

// GET /api/orders/export-pdf (Protected)
router.get('/export-pdf', verifyToken, orderController.exportOrdersPdf);

// PUT /api/orders/:id/status (Legacy/Specific) - PROTECTED
router.put('/:id/status', verifyToken, orderController.updateOrderStatus);

// PUT /api/orders/:id (Generic Update) - PROTECTED
router.put('/:id', verifyToken, orderController.updateOrderStatus);

// GET /api/orders/code/:code (Ambil pesanan by Transaction Code)
router.get('/code/:code', orderController.getOrderByTransactionCode);

// GET /api/orders/:id (Ambil detail pesanan)
router.get('/:id', orderController.getOrderById);

// GET /api/orders/code/:code (Ambil pesanan by Transaction Code)


// --- CANCELLATION & REFUND ROUTING ---
// POST /api/orders/cancel (Request/Auto Cancel dari User)
router.post('/cancel', orderLimiter, orderController.requestCancel);

// PUT /api/orders/:id/cancel-approve (Admin Approve) - PROTECTED
router.put('/:id/cancel-approve', verifyToken, orderController.approveCancel);

// PUT /api/orders/:id/cancel-reject (Admin Reject) - PROTECTED
router.put('/:id/cancel-reject', verifyToken, orderController.rejectCancel);

// POST /api/orders/refund-verify (Scan Refund QR) - PROTECTED
router.post('/refund-verify', verifyToken, orderController.verifyRefund);

module.exports = router;
