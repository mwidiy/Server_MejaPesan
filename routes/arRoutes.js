const express = require('express');
const router = express.Router();
const { uploadAr } = require('../middleware/upload');
const { getArAssets, uploadArAsset, deleteArAsset } = require('../controllers/arController');
const { verifyToken: protect } = require('../middleware/authMiddleware');

router.get('/assets', protect, getArAssets);
router.post('/upload', protect, uploadAr.single('model'), uploadArAsset);
router.delete('/delete/:id', protect, deleteArAsset);

module.exports = router;
