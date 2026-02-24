const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

// Helper to delete old file if needed
const deleteFile = (filename) => {
    if (!filename) return;
    // Cek apakah itu URL atau nama file local (Cloudinary URL tak perlu dihapus lokal)
    if (filename.startsWith('http')) return;

    const filePath = path.join(__dirname, '../public/images', filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
};

const { identifyStore } = require('../middleware/authMiddleware');

// GET /api/store
// Ambil data store milik User yang login
const getStore = async (req, res) => {
    try {
        const storeId = identifyStore(req);
        if (!storeId) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        const store = await prisma.store.findFirst({
            where: { id: storeId }
        });

        if (!store) return res.status(404).json({ error: 'Store not found' });

        res.json({ success: true, data: store });
    } catch (error) {
        console.error("Get Store Error:", error);
        res.status(500).json({ error: `Failed to fetch store: ${error.message}` });
    }
};

// PUT /api/store
// Update Info
const updateStore = async (req, res) => {
    try {
        const { name, isOpen, bankName, bankNumber, bankHolder, ewalletType, ewalletNumber, ewalletName, whatsappNumber } = req.body;
        if (!req.storeId) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        // --- HARDENING: SERVER-SIDE VALIDATION & SANITIZATION ---
        const alphanumericSpaceDashRegex = /^[a-zA-Z0-9 \-]+$/;
        const numericRegex = /^[0-9]+$/;
        const ewalletTypes = ['Gopay', 'OVO', 'Dana', 'ShopeePay', 'LinkAja'];

        if (name !== undefined) {
            if (name.length > 50) return res.status(400).json({ error: "Store Name too long (Max 50)" });
            if (!alphanumericSpaceDashRegex.test(name)) return res.status(400).json({ error: "Store Name contains invalid characters" });
        }
        if (bankName !== undefined) {
            if (bankName.length > 30) return res.status(400).json({ error: "Bank Name too long (Max 30)" });
            if (bankName.length > 0 && !alphanumericSpaceDashRegex.test(bankName)) return res.status(400).json({ error: "Bank Name contains invalid characters" });
        }
        if (bankNumber !== undefined) {
            if (bankNumber.length > 20) return res.status(400).json({ error: "Bank Number too long (Max 20)" });
            if (bankNumber.length > 0 && !numericRegex.test(bankNumber)) return res.status(400).json({ error: "Bank Number must be numeric" });
        }
        if (bankHolder !== undefined) {
            if (bankHolder.length > 50) return res.status(400).json({ error: "Bank Holder Name too long (Max 50)" });
            if (bankHolder.length > 0 && !alphanumericSpaceDashRegex.test(bankHolder)) return res.status(400).json({ error: "Bank Holder Name contains invalid characters" });
        }
        if (ewalletType !== undefined) {
            if (ewalletType.length > 0 && !ewalletTypes.includes(ewalletType)) return res.status(400).json({ error: "Invalid E-Wallet Type" });
        }
        if (ewalletNumber !== undefined) {
            if (ewalletNumber.length > 20) return res.status(400).json({ error: "E-Wallet Number too long (Max 20)" });
            if (ewalletNumber.length > 0 && !numericRegex.test(ewalletNumber)) return res.status(400).json({ error: "E-Wallet Number must be numeric" });
        }
        if (ewalletName !== undefined) {
            if (ewalletName.length > 50) return res.status(400).json({ error: "E-Wallet Name too long (Max 50)" });
            if (ewalletName.length > 0 && !alphanumericSpaceDashRegex.test(ewalletName)) return res.status(400).json({ error: "E-Wallet Name contains invalid characters" });
        }
        if (whatsappNumber !== undefined) {
            if (whatsappNumber.length > 20) return res.status(400).json({ error: "WhatsApp Number too long (Max 20)" });
            if (whatsappNumber.length > 0 && !numericRegex.test(whatsappNumber)) return res.status(400).json({ error: "WhatsApp Number must be numeric" });
        }

        // Update Store
        const updated = await prisma.store.update({
            where: { id: req.storeId },
            data: {
                name,
                isOpen,
                bankName,
                bankNumber,
                bankHolder,
                ewalletType,
                ewalletNumber,
                ewalletName,
                whatsappNumber
            }
        });

        // Cascade Update: If isOpen is changing, update all Tables
        if (isOpen !== undefined) {
            await prisma.table.updateMany({
                where: {
                    location: {
                        storeId: req.storeId
                    }
                },
                data: {
                    isActive: isOpen
                }
            });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error("Update Store Error:", error);
        res.status(500).json({ error: `Failed to update store: ${error.message}` });
    }
};

// POST /api/store/upload-logo
const uploadLogo = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!req.storeId) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        const store = await prisma.store.findUnique({ where: { id: req.storeId } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        // Delete old logo
        if (store.logo) deleteFile(store.logo);

        const filename = req.file.path; // SECURED: Extract Cloudinary Secure URL

        const updated = await prisma.store.update({
            where: { id: req.storeId },
            data: { logo: filename }
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error("Upload Logo Error:", error);
        res.status(500).json({ error: `Failed to upload logo: ${error.message}` });
    }
};

// POST /api/store/upload-qris
const uploadQris = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!req.storeId) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        const store = await prisma.store.findUnique({ where: { id: req.storeId } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        // Delete old qris
        if (store.qrisImage) deleteFile(store.qrisImage);

        const filename = req.file.path; // SECURED: Extract Cloudinary Secure URL

        const updated = await prisma.store.update({
            where: { id: req.storeId },
            data: { qrisImage: filename }
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error("Upload QRIS Error:", error);
        res.status(500).json({ error: `Failed to upload QRIS: ${error.message}` });
    }
};

module.exports = {
    getStore,
    updateStore,
    uploadLogo,
    uploadQris
};
