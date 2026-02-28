const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { uploadImage } = require('../middleware/upload');
const { verifyToken } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');

// GET /api/banners -> getAllBanners (Public or Private depending on usage, handled by identifyStore inside controller)
router.get('/', cacheMiddleware(300), bannerController.getAllBanners);

// Protected Routes (Require Authentication)
// POST /api/banners -> upload.single('image'), createBanner
router.post('/', verifyToken, uploadImage.single('image'), bannerController.createBanner);

// PUT /api/banners/:id -> upload.single('image'), updateBanner
router.put('/:id', verifyToken, uploadImage.single('image'), bannerController.updateBanner);

// DELETE /api/banners/:id -> deleteBanner
router.delete('/:id', verifyToken, bannerController.deleteBanner);

module.exports = router;
