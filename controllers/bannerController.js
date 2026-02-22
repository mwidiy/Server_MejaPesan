const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// Helper function untuk menghapus gambar fisik
// Sama seperti di productController
const removeImage = (filePath) => {
    if (!filePath) return;

    // filePath usually looks like: http://localhost:3000/uploads/image-123.jpg
    // We need to extract the filename: image-123.jpg
    try {
        const urlObj = new URL(filePath); // Safe parsing if it's a full URL
        const fileName = path.basename(urlObj.pathname);
        const localPath = path.join(__dirname, '../public/images', fileName);

        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            console.log(`🗑️ Deleted old image: ${fileName}`);
        }
    } catch (err) {
        // Fallback if filePath is just a relative path or invalid URL
        console.log(`⚠️ Could not parse URL or delete image: ${filePath}`, err.message);
        // Try simple basename just in case it's not a full URL
        try {
            const fileName = path.basename(filePath);
            const localPath = path.join(__dirname, '../public/images', fileName);
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
                console.log(`🗑️ Deleted old image (fallback): ${fileName}`);
            }
        } catch (e) {
            console.error("Failed to delete image", e);
        }
    }
};

const { identifyStore } = require('../middleware/authMiddleware');

// GET /api/banners
// Ambil semua banner
const getAllBanners = async (req, res) => {
    const { status } = req.query;
    try {
        const storeId = identifyStore(req);
        if (!storeId) return res.status(400).json({ error: "Store Context Required (storeId)" });

        const whereClause = { storeId: storeId };
        if (status === 'active') whereClause.isActive = true;

        const banners = await prisma.banner.findMany({
            where: whereClause,
            orderBy: { createdAt: 'asc' } // Urutkan dari yang terlama (Ascending)
        });

        res.status(200).json({
            success: true,
            message: "List semua banner berhasil diambil",
            data: banners,
        });
    } catch (error) {
        console.error("Error fetching banners:", error);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data banner",
            error: error.message,
        });
    }
};

// POST /api/banners
// Tambah Banner Baru
const createBanner = async (req, res) => {
    const { title, subtitle, highlightText } = req.body;

    // Validasi: Pastikan gambar diupload
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "Image is required"
        });
    }

    const imageUrl = `http://${req.headers.host}/uploads/${req.file.filename}`;

    try {
        // Ensure storeId is missing? No, verifyToken ensures we have user, but we should assert it.
        // req.storeId comes from verifyToken
        if (!req.storeId) {
            return res.status(403).json({ success: false, message: "Store context missing. Are you logged in?" });
        }

        const newBanner = await prisma.banner.create({
            data: {
                title,
                subtitle: subtitle || null,
                highlightText: highlightText || null,
                image: imageUrl,
                isActive: true,
                store: { connect: { id: req.storeId } } // Link to Store
            }
        });

        // Trigger Realtime ONLY to this store's room
        if (req.io) {
            req.io.to('store_' + req.storeId).emit('banners_updated');
            // Keep global emit for backward compatibility if needed, or remove? 
            // Better keep global for now until PWA is confirmed fully migrated to room logic?
            // Actually PWA doesn't join socket room yet for banners? PWA waiting page joined.
            // PWA Home page joins? Let's check PWA Home page later. 
            // For now, emit global 'banners_updated' is what PWA listens to.
            req.io.emit('banners_updated');
        }

        res.status(201).json({
            success: true,
            message: "Banner berhasil ditambahkan",
            data: newBanner
        });
    } catch (error) {
        console.error("Error creating banner:", error);
        // Hapus gambar jika gagal insert DB untuk menghindari file sampah
        if (req.file) {
            removeImage(imageUrl);
        }
        res.status(500).json({
            success: false,
            message: "Gagal menambahkan banner",
            error: error.message
        });
    }
};

// PUT /api/banners/:id
// Update Banner
const updateBanner = async (req, res) => {
    const { id } = req.params;
    const { title, subtitle, highlightText, isActive } = req.body;

    try {
        // Cari banner lama (Scoped to Store)
        const existingBanner = await prisma.banner.findFirst({
            where: { id: Number(id), storeId: req.storeId }
        });
        if (!existingBanner) {
            return res.status(404).json({ success: false, message: "Banner tidak ditemukan" });
        }

        let imageUrl = existingBanner.image;

        // Cek Gambar Baru
        if (req.file) {
            // Panggil helper removeImage() untuk menghapus gambar lama
            if (existingBanner.image) {
                removeImage(existingBanner.image);
            }
            // Update URL baru
            imageUrl = `http://${req.headers.host}/uploads/${req.file.filename}`;
        }
        // Jika tidak upload: Gunakan gambar lama (imageUrl sudah diset ke existingBanner.image)

        // Update DB
        const updatedBanner = await prisma.banner.update({
            where: { id: Number(id) },
            data: {
                title: title !== undefined ? title : undefined,
                subtitle: subtitle !== undefined ? subtitle : undefined,
                highlightText: highlightText !== undefined ? highlightText : undefined,
                image: imageUrl,
                isActive: isActive !== undefined ? (String(isActive) === 'true') : undefined
            }
        });

        // Trigger Realtime
        if (req.io) {
            req.io.emit('banners_updated');
        }

        res.status(200).json({
            success: true,
            message: "Banner berhasil diupdate",
            data: updatedBanner
        });

    } catch (error) {
        console.error("Error updating banner:", error);
        // Hapus gambar baru jika gagal update DB
        if (req.file) {
            const newImageUrl = `http://${req.headers.host}/uploads/${req.file.filename}`;
            removeImage(newImageUrl);
        }
        res.status(500).json({ success: false, message: "Gagal update banner", error: error.message });
    }
};

// DELETE /api/banners/:id
// Hapus Banner
const deleteBanner = async (req, res) => {
    const { id } = req.params;
    try {
        const banner = await prisma.banner.findFirst({
            where: { id: Number(id), storeId: req.storeId }
        });
        if (!banner) return res.status(404).json({ success: false, message: "Banner tidak ditemukan" });

        // Hapus gambar fisiknya
        if (banner.image) {
            removeImage(banner.image);
        }

        // Hapus data dari database
        await prisma.banner.delete({
            where: { id: Number(id) }
        });

        // Trigger Realtime
        if (req.io) {
            req.io.emit('banners_updated');
        }

        res.status(200).json({
            success: true,
            message: "Banner berhasil dihapus"
        });
    } catch (error) {
        console.error("Error deleting banner:", error);
        res.status(500).json({ success: false, message: "Gagal menghapus banner", error: error.message });
    }
};

module.exports = {
    getAllBanners,
    createBanner,
    updateBanner,
    deleteBanner
};
