const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAllZones = async (req, res) => {
    try {
        const { storeId } = req.query; // PWA butuh get berdasarkan store
        
        let whereClause = {};
        if (storeId) {
            whereClause.storeId = parseInt(storeId);
        }

        const zones = await prisma.shippingZone.findMany({
            where: whereClause,
            orderBy: { id: 'asc' }
        });
        res.json(zones);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createZone = async (req, res) => {
    try {
        const { name, cost, isActive, storeId } = req.body;
        
        if (!storeId) return res.status(400).json({ message: "storeId is required" });

        const newZone = await prisma.shippingZone.create({
            data: {
                name,
                cost: parseInt(cost),
                isActive: isActive !== undefined ? isActive : true,
                storeId: parseInt(storeId)
            }
        });
        res.json(newZone);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateZone = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, cost, isActive } = req.body;
        const updatedZone = await prisma.shippingZone.update({
            where: { id: parseInt(id) },
            data: {
                name,
                cost: cost !== undefined ? parseInt(cost) : undefined,
                isActive
            }
        });
        res.json(updatedZone);
    } catch (error) {
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

        res.json(deletedZone);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getAllZones, createZone, updateZone, deleteZone };
