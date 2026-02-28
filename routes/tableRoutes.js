const express = require('express');
const router = express.Router();
const tableController = require('../controllers/tableController');

const { verifyToken } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

// Define routes
router.get('/', verifyToken, cacheMiddleware(300), tableController.getAllTables);
router.post('/', verifyToken, tableController.createTable);
router.get('/scan/:code', cacheMiddleware(300), tableController.getTableByQrCode); // Public (Scan doesn't need auth usually, or does it? Scan is usually public landing)
router.put('/:id', verifyToken, tableController.updateTable);
router.patch('/:id/status', verifyToken, tableController.updateTableStatus);
router.delete('/:id', verifyToken, tableController.deleteTable);

module.exports = router;
