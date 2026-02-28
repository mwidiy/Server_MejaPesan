const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const { uploadImage } = require('../middleware/upload');

const { verifyToken } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

router.get('/', cacheMiddleware(300), storeController.getStore);
router.put('/', verifyToken, storeController.updateStore);
router.post('/upload-logo', verifyToken, uploadImage.single('image'), storeController.uploadLogo);
router.post('/upload-qris', verifyToken, uploadImage.single('image'), storeController.uploadQris);

module.exports = router;
