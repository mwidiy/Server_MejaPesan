const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Ensure AR directory exists (Images now go to Cloudinary so no local dir needed)
const arDir = 'public/ar-assets';
if (!fs.existsSync(arDir)) fs.mkdirSync(arDir, { recursive: true });

// --- Image Upload Config (Cloudinary) ---
const storageImage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'kasir_assets', // Folder name in Cloudinary Dashboard
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], // Automatic format validation
        public_id: (req, file) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            // Don't include format extension here, Cloudinary adds it
            return 'IMG-' + uniqueSuffix;
        }
    }
});

const uploadImage = multer({
    storage: storageImage,
    limits: { fileSize: 1024 * 1024 * 5 } // 5MB Limit (Prevents DoS)
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
