const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

const { uploadImage } = require('../middleware/upload');

const { verifyToken } = require('../middleware/authMiddleware');

// GET /api/products
// GET /api/products (Public with ?storeId=...)
router.get('/', productController.getAllProducts);

// GET /api/products/:id
router.get('/:id', productController.getProductById);

// POST /api/products
router.post('/', verifyToken, uploadImage.single('image'), productController.createProduct);

// PUT /api/products/:id
router.put('/:id', verifyToken, uploadImage.single('image'), productController.updateProduct);

// DELETE /api/products/:id
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
