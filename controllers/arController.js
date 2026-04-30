const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { identifyStore } = require('../middleware/authMiddleware');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const gltfPipeline = require('gltf-pipeline');
const processGlb = gltfPipeline.processGlb;

// Configuration for local storage
const AR_ASSETS_DIR = path.join(__dirname, '../public/ar-assets');

// Ensure directory exists
if (!fs.existsSync(AR_ASSETS_DIR)) {
    fs.mkdirSync(AR_ASSETS_DIR, { recursive: true });
}

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

        // Use base URL from env or request headers
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        // DEFAULT ASSETS (Hosted locally)
        const defaultAssets = [
            { id: -1, name: 'defaul1.glb', url: `${baseUrl}/ar-assets/defaul1.glb`, isDefault: true },
            { id: -2, name: 'defaul2.glb', url: `${baseUrl}/ar-assets/defaul2.glb`, isDefault: true }
        ];

        res.json({ success: true, data: [...defaultAssets, ...assets] });
    } catch (error) {
        console.error("Get AR Assets Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch assets" });
    }
};

// POST /api/ar/upload
// Upload file (.glb format), kompres dengan Draco, dan simpan di VPS Lokal
const uploadArAsset = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded or invalid format" });
    }

    const storeId = identifyStore(req);
    if (!storeId) {
        return res.status(403).json({ success: false, message: "Store Context Missing. Cannot save asset." });
    }

    // STRICT CHECK: Only GLB/GLTF allowed
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') {
        return res.status(400).json({ success: false, message: "Security Block: Only .glb/.gltf files allowed!" });
    }

    try {
        console.log(`[AR_UPLOAD] Starting optimization for: ${originalName} (${(req.file.size / 1024).toFixed(2)} KB)`);

        // --- 1. Optimize with Draco Compression ---
        const options = {
            dracoOptions: {
                compressionLevel: 7 // High compression
            }
        };

        let processedBuffer;
        try {
            // processGlb works for both GLB and GLTF buffers
            const results = await processGlb(req.file.buffer, options);
            processedBuffer = results.glb;
            console.log(`[AR_UPLOAD] Optimization Success: New size is ${(processedBuffer.length / 1024).toFixed(2)} KB`);
        } catch (optimizeError) {
            console.warn("[AR_UPLOAD] Optimization failed, saving original file instead.", optimizeError.message);
            processedBuffer = req.file.buffer;
        }

        // --- 2. Save to VPS Local Disk ---
        // Use UUID for security (prevents enumeration)
        const uniqueFileName = `${uuidv4()}${ext}`;
        const filePath = path.join(AR_ASSETS_DIR, uniqueFileName);

        fs.writeFileSync(filePath, processedBuffer);

        // --- 3. Build Public URL ---
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const publicUrl = `${protocol}://${host}/ar-assets/${uniqueFileName}`;

        // --- 4. Save to Prisma Database ---
        const newAsset = await prisma.arAsset.create({
            data: {
                name: originalName,       // Friendly name display
                url: publicUrl,           // VPS Local URL
                storeId: storeId
            }
        });

        res.status(201).json({ success: true, data: newAsset });
    } catch (error) {
        console.error("Complete Upload Pipeline Error:", error);
        res.status(500).json({ success: false, message: "Upload pipeline failed", error: error.message });
    }
};

// DELETE /api/ar/delete/:id
const deleteArAsset = async (req, res) => {
    const { id } = req.params;
    const storeId = identifyStore(req);

    if (!storeId) return res.status(403).json({ message: "Store not identified" });

    try {
        const asset = await prisma.arAsset.findFirst({
            where: {
                id: Number(id),
                storeId: storeId
            }
        });

        if (!asset) {
            return res.status(404).json({ success: false, message: "Asset not found or unauthorized" });
        }

        // 1. Delete from VPS Disk
        try {
            const filename = path.basename(asset.url);
            const filePath = path.join(AR_ASSETS_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[AR_DELETE] Deleted local file: ${filename}`);
            }
        } catch (fsError) {
            console.error("[AR_DELETE] Disk deletion error:", fsError.message);
        }

        // 2. Delete from DB
        await prisma.arAsset.delete({
            where: { id: asset.id }
        });

        res.json({ success: true, message: "Asset deleted completely from VPS" });

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
