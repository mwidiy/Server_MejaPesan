const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/categories
// Ambil semua kategori
const { identifyStore } = require('../middleware/authMiddleware');

// GET /api/categories
// Ambil semua kategori
const getAllCategories = async (req, res) => {
    try {
        const storeId = identifyStore(req);
        if (!storeId) return res.status(400).json({ error: "Store Context Required (storeId)" });

        const categories = await prisma.category.findMany({
            where: { storeId: storeId }, // Multi-tenancy scope
            orderBy: {
                name: 'asc'
            }
        });

        res.status(200).json({
            success: true,
            message: "List kategori berhasil diambil",
            data: categories
        });
    } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data kategori",
            error: error.message
        });
    }
};

// POST /api/categories
// Tambah kategori baru
const createCategory = async (req, res) => {
    const { name } = req.body;

    if (!name || name.trim() === "") {
        return res.status(400).json({
            success: false,
            message: "Nama kategori tidak boleh kosong"
        });
    }

    try {
        const newCategory = await prisma.category.create({
            data: {
                name: name,
                store: { connect: { id: req.storeId } }
            }
        });

        res.status(201).json({
            success: true,
            message: "Kategori berhasil ditambahkan",
            data: newCategory
        });
    } catch (error) {
        console.error("Error creating category:", error);
        // Handle unique constraint violation
        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: "Kategori dengan nama tersebut sudah ada"
            });
        }
        res.status(500).json({
            success: false,
            message: "Gagal menambahkan kategori",
            error: error.message
        });
    }
};

// PUT /api/categories/:id
// Update kategori
const updateCategory = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    try {
        // Check ownership first
        const category = await prisma.category.findFirst({
            where: { id: Number(id), storeId: req.storeId }
        });
        if (!category) return res.status(404).json({ success: false, message: "Kategori tidak ditemukan (Store mismatch)" });

        const updatedCategory = await prisma.category.update({
            where: { id: Number(id) },
            data: { name: name }
        });

        res.status(200).json({
            success: true,
            message: "Kategori berhasil diupdate",
            data: updatedCategory
        });
    } catch (error) {
        console.error("Error updating category:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: "Kategori tidak ditemukan" });
        }
        res.status(500).json({
            success: false,
            message: "Gagal update kategori",
            error: error.message
        });
    }
};

// DELETE /api/categories/:id
// Hapus kategori (dengan validasi relasi)
const deleteCategory = async (req, res) => {
    const { id } = req.params;
    const categoryId = Number(id);

    try {
        const categoryId = Number(id);

        const category = await prisma.category.findFirst({
            where: { id: categoryId, storeId: req.storeId }
        });
        if (!category) return res.status(404).json({ success: false, message: "Kategori tidak ditemukan (Store mismatch)" });

        // Cek dulu apakah kategori ini sedang dipakai oleh produk
        const productCount = await prisma.product.count({
            where: { categoryId: categoryId, storeId: req.storeId }
        });

        if (productCount > 0) {
            return res.status(400).json({
                success: false,
                message: "Kategori tidak bisa dihapus karena masih memiliki produk."
            });
        }

        await prisma.category.delete({
            where: { id: categoryId }
        });

        res.status(200).json({
            success: true,
            message: "Kategori berhasil dihapus"
        });
    } catch (error) {
        console.error("Error deleting category:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: "Kategori tidak ditemukan" });
        }
        res.status(500).json({
            success: false,
            message: "Gagal menghapus kategori",
            error: error.message
        });
    }
};

module.exports = {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
};
