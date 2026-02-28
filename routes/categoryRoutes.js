const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

const { verifyToken } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

// Define routes
router.get('/', cacheMiddleware(300), categoryController.getAllCategories);
router.post('/', verifyToken, categoryController.createCategory);
router.put('/:id', verifyToken, categoryController.updateCategory);
router.delete('/:id', verifyToken, categoryController.deleteCategory);

module.exports = router;
