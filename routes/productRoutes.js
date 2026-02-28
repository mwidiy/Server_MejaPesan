const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

const { uploadImage } = require('../middleware/upload');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

const { verifyToken } = require('../middleware/authMiddleware');

// Define routes
// Apply 5-minute Cache to Catalog Get (Bypass DB on Refresh Spikes)
router.get('/', cacheMiddleware(300), productController.getAllProducts);
router.get('/:id', cacheMiddleware(300), productController.getProductById);

router.post('/', verifyToken, uploadImage.single('image'), productController.createProduct);
router.put('/:id', verifyToken, uploadImage.single('image'), productController.updateProduct);
router.delete('/:id', verifyToken, productController.deleteProduct);

module.exports = router;
