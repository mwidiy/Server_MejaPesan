const express = require('express');
const router = express.Router();
const tableController = require('../controllers/tableController');

const { verifyToken } = require('../middleware/authMiddleware');

// Define routes
router.get('/', verifyToken, tableController.getAllTables);
router.post('/', verifyToken, tableController.createTable);
router.get('/scan/:code', tableController.getTableByQrCode); // Public (Scan doesn't need auth usually, or does it? Scan is usually public landing)
router.put('/:id', verifyToken, tableController.updateTable);
router.patch('/:id/status', verifyToken, tableController.updateTableStatus);
router.delete('/:id', verifyToken, tableController.deleteTable);

module.exports = router;
