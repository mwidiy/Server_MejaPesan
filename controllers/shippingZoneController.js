const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { identifyStore } = require('../middleware/authMiddleware');

const getAllZones = async (req, res) => {
    try {
        const { storeId } = req.query; // PWA butuh get berdasarkan store
        
        let whereClause = {};
        const authStoreId = identifyStore(req);
        const targetStoreId = storeId || authStoreId;
        
        if (targetStoreId) {
            whereClause.storeId = parseInt(targetStoreId);
        }

        const zones = await prisma.shippingZone.findMany({
            where: whereClause,
            orderBy: { id: 'asc' }
        });
        
        // Map cost -> fee untuk KASIR App
        const formattedZones = zones.map(z => ({ ...z, fee: z.cost }));
        res.json({ success: true, data: formattedZones });
    } catch (error) {
        console.error("Get All Zones Error:", error);
        res.status(500).json({ message: error.message });
    }
};

const createZone = async (req, res) => {
    try {
        const { name, cost, fee, isActive } = req.body;
        const storeId = identifyStore(req) || req.body.storeId;
        
        if (!storeId) return res.status(400).json({ success: false, error: "storeId is required" });

        const finalCost = fee !== undefined ? fee : cost;

        const newZone = await prisma.shippingZone.create({
            data: {
                name,
                cost: parseInt(finalCost),
                isActive: isActive !== undefined ? isActive : true,
                store: { connect: { id: parseInt(storeId) } }
            }
        });
        res.json({ success: true, data: { ...newZone, fee: newZone.cost } });
    } catch (error) {
        console.error("Create Zone Error:", error);
        res.status(500).json({ message: error.message });
    }
};

const updateZone = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, cost, fee, isActive } = req.body;
        
        const finalCost = fee !== undefined ? fee : cost;

        const updatedZone = await prisma.shippingZone.update({
            where: { id: parseInt(id) },
            data: {
                name,
                cost: finalCost !== undefined ? parseInt(finalCost) : undefined,
                isActive
            }
        });
        res.json({ success: true, data: { ...updatedZone, fee: updatedZone.cost } });
    } catch (error) {
        console.error("Update Zone Error:", error);
        res.status(500).json({ message: error.message });
    }
};

const deleteZone = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Dapatkan data zona sebelum dihapus
        const zone = await prisma.shippingZone.findUnique({ where: { id: parseInt(id) } });
        if (!zone) return res.status(404).json({ message: "Zone not found" });

        const deletedZone = await prisma.shippingZone.delete({
            where: { id: parseInt(id) }
        });
        
        // Cek apakah sisa zona aktif = 0 untuk store ini
        const activeZonesCount = await prisma.shippingZone.count({
            where: { storeId: zone.storeId, isActive: true }
        });
        
        // Jika tidak ada zona aktif lagi, nonaktifkan isDeliveryActive di store
        if (activeZonesCount === 0) {
            await prisma.store.update({
                where: { id: zone.storeId },
                data: { isDeliveryActive: false }
            });
        }

        res.json({ success: true, data: { ...deletedZone, fee: deletedZone.cost } });
    } catch (error) {
        console.error("Delete Zone Error:", error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getAllZones, createZone, updateZone, deleteZone };
