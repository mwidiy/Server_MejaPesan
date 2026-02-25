const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { identifyStore } = require('../middleware/authMiddleware');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client (Service Role for Admin Access to Storage)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

        // DEFAULT ASSETS (Public for everyone, hosted on Supabase CDN)
        // Using `getPublicUrl` guarantees we always use the correct Supabase domain
        const default1Url = supabase.storage.from('AR').getPublicUrl('defaul1.glb').data.publicUrl;
        const default2Url = supabase.storage.from('AR').getPublicUrl('defaul2.glb').data.publicUrl;

        const defaultAssets = [
            { name: 'defaul1.glb', url: default1Url, isDefault: true },
            { name: 'defaul2.glb', url: default2Url, isDefault: true }
        ];

        res.json({ success: true, data: [...defaultAssets, ...assets] });
    } catch (error) {
        console.error("Get AR Assets Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch assets" });
    }
};

// POST /api/ar/upload
// Upload file (.glb format) dan simpan ke Supabase CDN
const uploadArAsset = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded or invalid format" });
    }

    const storeId = identifyStore(req);
    if (!storeId) {
        return res.status(403).json({ success: false, message: "Store Context Missing. Cannot save asset." });
    }

    // STRICT CHECK
    const originalName = req.file.originalname;
    if (!originalName.toLowerCase().endsWith('.glb') && !originalName.toLowerCase().endsWith('.gltf')) {
        return res.status(400).json({ success: false, message: "Security Block: Only .glb/.gltf files allowed!" });
    }

    try {
        // --- 1. Stream Buffer to Supabase ---
        // Create unique safe name
        const safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const uniqueFileName = `${Date.now()}_${storeId}_${safeName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('AR')
            .upload(uniqueFileName, req.file.buffer, {
                contentType: req.file.mimetype || 'model/gltf-binary', // Fallback to standard GLB MIME Type
                cacheControl: '3600',
                upsert: false // Don't overwrite existing
            });

        if (uploadError) {
            console.error("Supabase Upload Error:", uploadError);
            return res.status(500).json({ success: false, message: `Upload failed: ${uploadError.message}` });
        }

        // --- 2. Retrieve Public URL ---
        const { data: { publicUrl } } = supabase.storage
            .from('AR')
            .getPublicUrl(uniqueFileName);

        // --- 3. Save to Prisma Database ---
        const newAsset = await prisma.arAsset.create({
            data: {
                name: originalName,       // Friendly name for Kasir App display
                url: publicUrl,           // Supabase CDN URL
                storeId: storeId
            }
        });

        res.status(201).json({ success: true, data: newAsset });
    } catch (error) {
        console.error("Complete Upload Pipeline Error:", error);
        res.status(500).json({ success: false, message: "Upload pipeline failed" });
    }
};

// DELETE /api/ar/delete/:id
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

        // 2. Extract Filename from URL (Supabase handles deletions by file path)
        // URL is like: https://[project].supabase.co/storage/v1/object/public/AR/1700000_1_file.glb
        // We only need the trailing filename part
        const filename = asset.url.split('/').pop();

        // 3. Delete from Supabase Storage
        const { error: removeError } = await supabase.storage
            .from('AR')
            .remove([filename]);

        if (removeError) {
            console.error("Supabase Deletion Warning:", removeError);
            // We can choose to proceed with DB deletion even if cloud deletion fails
        }

        // 4. Delete from DB
        await prisma.arAsset.delete({
            where: { id: asset.id }
        });

        res.json({ success: true, message: "Asset deleted completely" });

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
