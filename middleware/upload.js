const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
const imageDir = 'public/images';
const arDir = 'public/ar-assets';
if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
if (!fs.existsSync(arDir)) fs.mkdirSync(arDir, { recursive: true });

// --- Image Upload Config ---
const storageImage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, imageDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const imgName = 'IMG-' + uniqueSuffix + path.extname(file.originalname);
        cb(null, imgName);
    }
});

const filterImage = (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') && allowedExts.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type! Only JPG/PNG/WEBP Images are allowed.'), false);
    }
};

const uploadImage = multer({
    storage: storageImage,
    limits: { fileSize: 1024 * 1024 * 5 }, // 5MB Limit (Prevents DoS)
    fileFilter: filterImage
});

// --- AR Upload Config ---
const storageAr = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, arDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const uniqueName = Date.now() + '_' + safeName;
        cb(null, uniqueName);
    }
});

const filterAr = (req, file, cb) => {
    const allowedGlb = ['.glb'];
    const ext = path.extname(file.originalname).toLowerCase();
    if ((file.mimetype === 'model/gltf-binary' || file.mimetype === 'application/octet-stream') && allowedGlb.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type! Only GLB models are allowed.'), false);
    }
};

const uploadAr = multer({
    storage: storageAr,
    limits: { fileSize: 1024 * 1024 * 40 }, // 40MB Limit
    fileFilter: filterAr
});

module.exports = { uploadImage, uploadAr };
