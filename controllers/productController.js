const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// Helper function untuk menghapus gambar fisik (diabaikan kalau Cloudinary URL)
const removeImage = (filePath) => {
    if (!filePath) return;
    if (filePath.includes('res.cloudinary.com')) return; // Cloudinary handled via Dashboard/API separately if needed

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

// GET /api/products
// Ambil semua produk yang aktif
const getAllProducts = async (req, res) => {
    const { status } = req.query;
    try {
        const storeId = identifyStore(req);
        if (!storeId) return res.status(400).json({ error: "Store Context Required (storeId)" });

        const whereClause = {
            storeId: storeId // Enforce Store Scope
        };
        if (status === 'active') {
            whereClause.isActive = true;
        }

        const products = await prisma.product.findMany({
            where: whereClause,
            // Include category relation
            include: {
                category: true
            },
            orderBy: [
                { category: { name: 'asc' } }, // Urutkan berdasarkan nama kategori
                { name: 'asc' }
            ]
        });

        // Mapping agar frontend tetap menerima 'category' sebagai String (bukan object)
        const formattedProducts = products.map(product => ({
            ...product,
            category: product.category ? product.category.name : null, // Flatten
            categoryId: product.categoryId // Optional: kirim juga ID-nya jika butuh
        }));

        res.status(200).json({
            success: true,
            message: "List semua menu berhasil diambil",
            data: formattedProducts,
        });
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data produk",
            error: error.message,
        });
    }
};

// GET /api/products/:id
// Ambil detail produk berdasarkan ID
const getProductById = async (req, res) => {
    const { id } = req.params;
    try {
        const product = await prisma.product.findUnique({
            where: { id: Number(id) },
            include: { category: true }
        });

        if (!product) {
            return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
        }

        // Flatten logic if needed for consistency
        const formattedProduct = {
            ...product,
            category: product.category ? product.category.name : null
        };

        res.status(200).json({
            success: true,
            data: formattedProduct
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// POST /api/products
// Tambah Menu Baru
const createProduct = async (req, res) => {
    const { name, categoryId, price, description } = req.body;
    let imageUrl = req.body.image;

    if (req.file) {
        imageUrl = req.file.path; // SECURED: Extract Cloudinary Secure URL
    }

    try {
        // SAFETY CHECK: Ensure storeId exists
        if (!req.storeId) {
            return res.status(400).json({
                success: false,
                message: "Akses Ditolak: User tidak memiliki toko yang aktif."
            });
        }

        const newProduct = await prisma.product.create({
            data: {
                name,
                // Fix: Use 'connect' for relationship instead of scalar 'categoryId'
                category: { connect: { id: parseInt(categoryId) } },
                price: Number(price),
                description,
                image: imageUrl,
                isActive: true,
                ar3dModel: req.body.ar3dModel || null,
                isArActive: req.body.isArActive === 'true' || false,
                store: { connect: { id: req.storeId } } // Connect to Store
            },
            include: {
                category: true
            }
        });

        // Format result for consistency?
        const formattedProduct = {
            ...newProduct,
            category: newProduct.category ? newProduct.category.name : null
        };

        // Trigger update real-time
        req.io.emit('products_updated');

        res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan",
            data: formattedProduct
        });
    } catch (error) {
        console.error("Error creating product:", error);
        res.status(500).json({
            success: false,
            message: "Gagal menambahkan produk",
            error: error.message
        });
    }
};

// PUT /api/products/:id
// Edit Menu
const updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, categoryId, price, description, isActive, ar3dModel, isArActive } = req.body;
    let imageUrl = req.body.image;

    if (req.file) {
        imageUrl = req.file.path; // SECURED: Extract Cloudinary Secure URL
    }

    try {
        const existingProduct = await prisma.product.findFirst({
            where: { id: Number(id), storeId: req.storeId }
        });

        if (!existingProduct) {
            return res.status(404).json({ success: false, message: "Produk tidak ditemukan atau akses ditolak" });
        }

        if (req.file && existingProduct.image) {
            removeImage(existingProduct.image);
        }

        const updatedProduct = await prisma.product.update({
            where: { id: Number(id) },
            data: {
                name: name !== undefined ? name : undefined,
                categoryId: categoryId !== undefined ? parseInt(categoryId) : undefined,
                price: price !== undefined ? Number(price) : undefined,
                description: description !== undefined ? description : undefined,
                image: imageUrl !== undefined ? imageUrl : undefined,
                isActive: isActive !== undefined ? (String(isActive) === 'true') : undefined,
                ar3dModel: ar3dModel !== undefined ? ar3dModel : undefined,
                isArActive: isArActive !== undefined ? (String(isArActive) === 'true') : undefined
            },
            include: {
                category: true
            }
        });

        const formattedProduct = {
            ...updatedProduct,
            category: updatedProduct.category ? updatedProduct.category.name : null
        };

        // Trigger update real-time
        req.io.emit('products_updated');

        res.status(200).json({
            success: true,
            message: "Produk berhasil diupdate",
            data: formattedProduct
        });
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ success: false, message: "Gagal update produk", error: error.message });
    }
};

// DELETE /api/products/:id
// Hapus Menu
const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const product = await prisma.product.findFirst({
            where: { id: Number(id), storeId: req.storeId }
        });

        if (!product) return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });

        // Hapus file gambar jika ada
        if (product.image) {
            removeImage(product.image);
        }

        // Hapus related OrderItems terlebih dahulu (Cascade Delete)
        await prisma.orderItem.deleteMany({
            where: { productId: Number(id) }
        });

        await prisma.product.delete({
            where: { id: Number(id) }
        });

        // Trigger update real-time
        req.io.emit('products_updated');

        res.status(200).json({
            success: true,
            message: "Produk berhasil dihapus"
        });
    } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).json({ success: false, message: "Gagal menghapus produk", error: error.message });
    }
};

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};
