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

// --- AR Upload Config (Supabase - Memory Storage) ---
// File is held in RAM (buffer) as we will stream it directly to Supabase
const storageAr = multer.memoryStorage();

const filterAr = (req, file, cb) => {
    // Basic validation, strict validation is in the controller
    cb(null, true);
};

const uploadAr = multer({
    storage: storageAr,
    limits: { fileSize: 1024 * 1024 * 40 }, // 40MB Limit
    fileFilter: filterAr
});

module.exports = { uploadImage, uploadAr };
