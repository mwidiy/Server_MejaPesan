const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get all locations (Scoped to Store)
exports.getAllLocations = async (req, res) => {
    try {
        if (!req.storeId) return res.status(400).json({ error: "Access Denied: No Store" });
        const locations = await prisma.location.findMany({
            where: { storeId: req.storeId },
            orderBy: { name: 'asc' },
        });
        res.json(locations);
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch locations: ${error.message}` });
    }
};

// Create a new location (Linked to Store)
exports.createLocation = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: "Name is required" });
        if (name.length > 50) return res.status(400).json({ error: "Name must be less than 50 characters" });
        if (!/^[a-zA-Z0-9 \-]+$/.test(name)) return res.status(400).json({ error: "Name contains invalid characters" });
        if (!req.storeId) return res.status(400).json({ error: "Access Denied: No Store" });

        const location = await prisma.location.create({
            data: {
                name,
                store: { connect: { id: req.storeId } }
            },
        });
        res.status(201).json(location);
    } catch (error) {
        console.error("Create Location Error:", error);
        res.status(500).json({ error: `Failed to create location: ${error.message}` });
    }
};

// Update a location (Scoped)
exports.updateLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        if (name) {
            if (name.length > 50) return res.status(400).json({ error: "Name must be less than 50 characters" });
            if (!/^[a-zA-Z0-9 \-]+$/.test(name)) return res.status(400).json({ error: "Name contains invalid characters" });
        }

        // Ensure location belongs to store
        const exists = await prisma.location.findFirst({
            where: { id: parseInt(id), storeId: req.storeId }
        });
        if (!exists) return res.status(404).json({ error: "Location not found or access denied" });

        const location = await prisma.location.update({
            where: { id: parseInt(id) },
            data: { name },
        });
        res.json(location);
    } catch (error) {
        res.status(500).json({ error: `Failed to update: ${error.message}` });
    }
};

// Delete a location (Scoped)
exports.deleteLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const locationId = parseInt(id);

        // Ensure location belongs to store
        const exists = await prisma.location.findFirst({
            where: { id: locationId, storeId: req.storeId }
        });
        if (!exists) return res.status(404).json({ error: "Location not found or access denied" });

        // Cek apakah lokasi ini dipakai oleh meja
        const tableCount = await prisma.table.count({
            where: { locationId: locationId },
        });

        if (tableCount > 0) {
            return res.status(400).json({
                error: "Lokasi tidak bisa dihapus karena masih memiliki meja.",
            });
        }

        await prisma.location.delete({
            where: { id: locationId },
        });

        res.json({ message: "Location deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: `Failed to delete: ${error.message}` });
    }
};
