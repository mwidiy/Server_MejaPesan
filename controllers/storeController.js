const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const { clearCache } = require('../middleware/cacheMiddleware');
const { deleteCloudinaryImage } = require('../middleware/upload');

// Helper to delete old file if needed
const deleteFile = (filename) => {
    if (!filename) return;
    // Cek apakah itu URL atau nama file local
    if (filename.includes('res.cloudinary.com')) {
        deleteCloudinaryImage(filename);
        return;
    }
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
        const storeIdRaw = identifyStore(req);
        const storeId = parseInt(storeIdRaw);
        if (isNaN(storeId)) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

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
        let { name, isOpen, bankName, bankNumber, bankHolder, ewalletType, ewalletNumber, ewalletName, whatsappNumber, isKasirQrVerificationEnabled, cashPaymentMode, isCashActive, isDineInActive, isTakeawayActive, isDeliveryActive, isAiEnabled, isAutoReplyEnabled } = req.body;
        if (!req.storeId) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        // --- HARDENING: SERVER-SIDE VALIDATION & SANITIZATION ---
        const alphanumericSpaceDashRegex = /^[a-zA-Z0-9 \-\.,']+$/;
        const numericRegex = /^[0-9]+$/;
        const ewalletTypes = ['Gopay', 'OVO', 'Dana', 'ShopeePay'];

        if (name != null) {
            if (name.length > 10) return res.status(400).json({ error: "Nama Toko terlalu panjang (Maks 10 huruf)" });
            if (!alphanumericSpaceDashRegex.test(name)) return res.status(400).json({ error: "Nama Toko mengandung karakter tidak valid" });
        }
        if (bankName != null) {
            if (bankName.length > 30) return res.status(400).json({ error: "Bank Name too long (Max 30)" });
            if (bankName.length > 0 && !alphanumericSpaceDashRegex.test(bankName)) return res.status(400).json({ error: "Bank Name contains invalid characters" });
        }
        if (bankNumber != null) {
            if (bankNumber.length > 20) return res.status(400).json({ error: "Bank Number too long (Max 20)" });
            if (bankNumber.length > 0 && !numericRegex.test(bankNumber)) return res.status(400).json({ error: "Bank Number must be numeric" });
        }
        if (bankHolder != null) {
            if (bankHolder.length > 50) return res.status(400).json({ error: "Bank Holder Name too long (Max 50)" });
            if (bankHolder.length > 0 && !alphanumericSpaceDashRegex.test(bankHolder)) return res.status(400).json({ error: "Bank Holder Name contains invalid characters" });
        }
        if (ewalletType != null && ewalletType.length > 0) {
            const matchedType = ewalletTypes.find(t => t.toLowerCase() === ewalletType.toLowerCase());
            if (!matchedType) return res.status(400).json({ error: "Invalid E-Wallet Type" });
            // Normalize value for database
            ewalletType = matchedType;
        }
        if (ewalletNumber != null) {
            if (ewalletNumber.length > 20) return res.status(400).json({ error: "E-Wallet Number too long (Max 20)" });
            if (ewalletNumber.length > 0 && !numericRegex.test(ewalletNumber)) return res.status(400).json({ error: "E-Wallet Number must be numeric" });
        }
        if (ewalletName != null) {
            if (ewalletName.length > 50) return res.status(400).json({ error: "E-Wallet Name too long (Max 50)" });
            if (ewalletName.length > 0 && !alphanumericSpaceDashRegex.test(ewalletName)) return res.status(400).json({ error: "E-Wallet Name contains invalid characters" });
        }
        if (whatsappNumber != null) {
            if (whatsappNumber.length > 20) return res.status(400).json({ error: "WhatsApp Number too long (Max 20)" });
            if (whatsappNumber.length > 0 && !numericRegex.test(whatsappNumber)) return res.status(400).json({ error: "WhatsApp Number must be numeric" });
        }
        if (cashPaymentMode != null) {
            const validModes = ['pre', 'post'];
            if (!validModes.includes(cashPaymentMode)) return res.status(400).json({ error: "Cash Payment Mode must be 'pre' or 'post'" });
        }

        // --- SANITIZATION & NORMALIZATION ---
        const sanitizedData = {
            name: (name !== undefined && name !== null) ? name : undefined,
            isOpen: (isOpen === true || isOpen === 'true') ? true : (isOpen === false || isOpen === 'false' ? false : undefined),
            bankName: (bankName !== undefined && bankName !== null) ? bankName : undefined,
            bankNumber: (bankNumber !== undefined && bankNumber !== null) ? bankNumber : undefined,
            bankHolder: (bankHolder !== undefined && bankHolder !== null) ? bankHolder : undefined,
            ewalletType: (ewalletType !== undefined && ewalletType !== null) ? ewalletType : undefined,
            ewalletNumber: (ewalletNumber !== undefined && ewalletNumber !== null) ? ewalletNumber : undefined,
            ewalletName: (ewalletName !== undefined && ewalletName !== null) ? ewalletName : undefined,
            whatsappNumber: (whatsappNumber !== undefined && whatsappNumber !== null) ? whatsappNumber : undefined,
            isKasirQrVerificationEnabled: (isKasirQrVerificationEnabled === 'true' || isKasirQrVerificationEnabled === true) ? true : (isKasirQrVerificationEnabled === 'false' || isKasirQrVerificationEnabled === false ? false : undefined),
            cashPaymentMode: (cashPaymentMode !== undefined && cashPaymentMode !== null) ? cashPaymentMode : undefined,
            isCashActive: (isCashActive === 'true' || isCashActive === true) ? true : (isCashActive === 'false' || isCashActive === false ? false : undefined),
            isDineInActive: (isDineInActive === 'true' || isDineInActive === true) ? true : (isDineInActive === 'false' || isDineInActive === false ? false : undefined),
            isTakeawayActive: (isTakeawayActive === 'true' || isTakeawayActive === true) ? true : (isTakeawayActive === 'false' || isTakeawayActive === false ? false : undefined),
            isDeliveryActive: (isDeliveryActive === 'true' || isDeliveryActive === true) ? true : (isDeliveryActive === 'false' || isDeliveryActive === false ? false : undefined),
            isAiEnabled: (isAiEnabled === 'true' || isAiEnabled === true) ? true : (isAiEnabled === 'false' || isAiEnabled === false ? false : undefined),
            isAutoReplyEnabled: (isAutoReplyEnabled === 'true' || isAutoReplyEnabled === true) ? true : (isAutoReplyEnabled === 'false' || isAutoReplyEnabled === false ? false : undefined)
        };

        const storeIdInt = parseInt(req.storeId);
        if (isNaN(storeIdInt)) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        // Update Store
        const updated = await prisma.store.update({
            where: { id: storeIdInt },
            data: sanitizedData
        });

        // Cascade Update: If isOpen is changing, update all Tables
        if (sanitizedData.isOpen !== undefined) {
            await prisma.table.updateMany({
                where: {
                    location: {
                        storeId: storeIdInt
                    }
                },
                data: {
                    isActive: sanitizedData.isOpen
                }
            });
        }

        clearCache('/api/store', req.storeId);

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
        const storeId = parseInt(req.storeId);
        if (isNaN(storeId)) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        // Delete old logo
        if (store.logo) deleteFile(store.logo);

        const filename = req.file.path; // SECURED: Extract Cloudinary Secure URL

        const updated = await prisma.store.update({
            where: { id: storeId },
            data: { logo: filename }
        });

        clearCache('/api/store', storeId);

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
        const storeId = parseInt(req.storeId);
        if (isNaN(storeId)) return res.status(400).json({ error: 'User tidak memiliki akses Toko' });

        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        // Delete old qris
        if (store.qrisImage) deleteFile(store.qrisImage);

        const filename = req.file.path; // SECURED: Extract Cloudinary Secure URL

        const updated = await prisma.store.update({
            where: { id: storeId },
            data: { qrisImage: filename }
        });

        clearCache('/api/store', storeId);

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
