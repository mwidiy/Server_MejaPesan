const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const { identifyStore } = require('../middleware/authMiddleware');

// GET /api/ar/assets
// Ambil aset AR milik Store yang sedang login
const getArAssets = async (req, res) => {
    try {
        const storeId = identifyStore(req);
        if (!storeId) {
            return res.status(400).json({ success: false, message: "Store Context Required" });
        }

        const assets = await prisma.arAsset.findMany({
            where: { storeId: storeId },
            orderBy: { createdAt: 'desc' }
        });

        // DEFAULT ASSETS (Public for everyone)
        const defaultAssets = [
            { name: 'anime.glb', url: `http://${req.headers.host}/ar-assets/anime.glb`, isDefault: true },
            { name: 'cake.glb', url: `http://${req.headers.host}/ar-assets/cake.glb`, isDefault: true }
        ];

        res.json({ success: true, data: [...defaultAssets, ...assets] });
    } catch (error) {
        console.error("Get AR Assets Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch assets" });
    }
};

// POST /api/ar/upload
// Upload file dan simpan record ke DB
const uploadArAsset = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded or invalid format" });
    }

    // STRICT CHECK
    if (!req.file.filename.toLowerCase().endsWith('.glb') && !req.file.filename.toLowerCase().endsWith('.gltf')) {
        // ... (Same deletion logic as before)
        try { fs.unlinkSync(path.join(__dirname, '../public/ar-assets', req.file.filename)); } catch (e) { }
        return res.status(400).json({ success: false, message: "Security Block: Only .glb files allowed!" });
    }

    const fileUrl = `http://${req.headers.host}/ar-assets/${req.file.filename}`;
    const storeId = identifyStore(req);

    if (!storeId) {
        // If no store context, delete the uploaded file to prevent orphans
        try { fs.unlinkSync(path.join(__dirname, '../public/ar-assets', req.file.filename)); } catch (e) { }
        return res.status(403).json({ success: false, message: "Store Context Missing. Cannot save asset." });
    }

    try {
        // Save to Database
        // Use originalname for display, filename (timestamped) for URL
        const newAsset = await prisma.arAsset.create({
            data: {
                name: req.file.originalname, // Friendly name
                url: `http://${req.headers.host}/ar-assets/${req.file.filename}`, // Timestamped unique URL
                storeId: storeId
            }
        });

        res.status(201).json({ success: true, data: newAsset });
    } catch (error) {
        console.error(error);
        // Clean up file if DB fails
        try { fs.unlinkSync(path.join(__dirname, '../public/ar-assets', req.file.filename)); } catch (e) { }
        res.status(500).json({ success: false, message: "Upload failed" });
    }
};

// DELETE /api/ar/delete/:filename
const deleteArAsset = async (req, res) => {
    const { id } = req.params; // ID based deletion
    const storeId = identifyStore(req);

    if (!storeId) return res.status(403).json({ message: "Store not identified" });

    try {
        // 1. Find Asset (Verify Ownership)
        const asset = await prisma.arAsset.findFirst({
            where: {
                id: Number(id),
                storeId: storeId
            }
        });

        if (!asset) {
            return res.status(404).json({ success: false, message: "Asset not found or unauthorized" });
        }

        // 2. Delete File from Disk
        // Extract filename from URL
        const filename = asset.url.split('/').pop();
        const filePath = path.join(__dirname, '../public/ar-assets', filename);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // 3. Delete from DB
        await prisma.arAsset.delete({
            where: { id: asset.id }
        });

        res.json({ success: true, message: "Asset deleted" });

    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ success: false, message: "Delete failed", error: error.message });
    }
};

module.exports = {
    getArAssets,
    uploadArAsset,
    deleteArAsset
};
