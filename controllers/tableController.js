const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { clearCache } = require('../middleware/cacheMiddleware');

// Helper: Slugify Name (Huruf kecil, spasi jadi strip)
const createSlug = (name) => {
    return name.toString().toLowerCase().trim().replace(/\s+/g, '-');
};

// Helper: Generate Random Alphanumeric String
const generateRandomString = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
};

// Get all tables (Scoped to Store via Location)
exports.getAllTables = async (req, res) => {
    try {
        if (!req.storeId) return res.status(400).json({ error: "Access Denied: No Store" });

        const tables = await prisma.table.findMany({
            where: {
                location: { storeId: req.storeId }
            },
            include: { location: true },
            orderBy: { name: 'asc' },
        });
        res.json(tables);
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch tables: ${error.message}` });
    }
};

// Get table by QR Code (Public Scan)
exports.getTableByQrCode = async (req, res) => {
    try {
        const { code } = req.params;

        // Cari meja berdasarkan qrCode
        const table = await prisma.table.findFirst({
            where: { qrCode: code },
            include: { location: true }
        });

        if (!table) {
            return res.status(404).json({ message: "Meja tidak ditemukan" });
        }

        res.status(200).json(table);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Create a new table
exports.createTable = async (req, res) => {
    try {
        const { name, locationId } = req.body;

        if (!name || !locationId) {
            return res.status(400).json({ error: "Name and Location ID are required" });
        }
        if (name.length > 30) return res.status(400).json({ error: "Table name must be less than 30 characters" });
        if (!/^[a-zA-Z0-9 \-]+$/.test(name)) return res.status(400).json({ error: "Table name contains invalid characters" });
        if (!req.storeId) return res.status(400).json({ error: "Access Denied: No Store" });

        // SAFETY: Verify location belongs to this store
        const location = await prisma.location.findFirst({
            where: { id: parseInt(locationId), storeId: req.storeId }
        });
        if (!location) return res.status(404).json({ error: "Location Invalid or Access Denied" });

        // Generate QR Logic: TBL-[SLUG_NAMA]-[RANDOM_STRING]
        const slug = createSlug(name);
        const randomStr = generateRandomString(4); // 4 digit alphanumeric
        const qrCode = `TBL-${slug}-${randomStr}`;

        const table = await prisma.table.create({
            data: {
                name,
                locationId: parseInt(locationId),
                qrCode, // Auto-generated
            },
            include: { location: true },
        });

        clearCache('/api/tables', req.storeId);

        res.status(201).json(table);
    } catch (error) {
        res.status(500).json({ error: `Failed to create table: ${error.message}` });
    }
};

// Update a table
exports.updateTable = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, locationId, isActive } = req.body;

        // Verify Ownership
        const exists = await prisma.table.findFirst({
            where: {
                id: parseInt(id),
                location: { storeId: req.storeId }
            }
        });
        if (!exists) return res.status(404).json({ error: "Table not found or access denied" });

        const updateData = {};
        if (name !== undefined) {
            if (name.length > 30) return res.status(400).json({ error: "Table name must be less than 30 characters" });
            if (!/^[a-zA-Z0-9 \-]+$/.test(name)) return res.status(400).json({ error: "Table name contains invalid characters" });
            updateData.name = name;
        }
        if (locationId !== undefined) {
            // If changing location, verify new location ownership
            const validLoc = await prisma.location.findFirst({
                where: { id: parseInt(locationId), storeId: req.storeId }
            });
            if (!validLoc) return res.status(400).json({ error: "Target Location Invalid" });
            updateData.locationId = parseInt(locationId);
        }
        if (isActive !== undefined) updateData.isActive = isActive;

        // Note: qrCode is NOT updated to preserve printed stickers

        const table = await prisma.table.update({
            where: { id: parseInt(id) },
            data: updateData,
            include: { location: true },
        });

        // SOCKET & LOGIC: If table is deactivated
        if (isActive === false) {
            // 1. Auto-cancel unpaid orders for this table (WaitingPayment or Pending)
            const pendingOrders = await prisma.order.findMany({
                where: { tableId: parseInt(id), status: { in: ['WaitingPayment', 'Pending'] } }
            });

            for (const order of pendingOrders) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'Cancelled', cancellationReason: 'Kantin menutup/menonaktifkan meja ini' }
                });
                // Notify user their specific order is cancelled
                if (req.io) req.io.emit('order_status_updated', { ...order, status: 'Cancelled', cancelReason: 'Kantin menutup/menonaktifkan meja ini' });
            }

            // 2. Broadcast table deactivation to ALL users on this table
            if (req.io) {
                console.log(`[Socket] Emitting table_deactivated for Table ${id}`);
                req.io.emit('table_deactivated', { tableId: parseInt(id) });
            }
        }

        clearCache('/api/tables', req.storeId);

        res.json(table);
    } catch (error) {
        res.status(500).json({ error: `Failed to update table: ${error.message}` });
    }
};

// Update table status (KASIR toggle endpoint)
exports.updateTableStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        // Ownership check
        const exists = await prisma.table.findFirst({
            where: {
                id: parseInt(id),
                location: { storeId: req.storeId }
            }
        });
        if (!exists) return res.status(404).json({ error: "Table not found or access denied" });

        const table = await prisma.table.update({
            where: { id: parseInt(id) },
            data: { isActive },
            include: { location: true },
        });

        // SOCKET: Emit based on activation/deactivation
        if (isActive === false) {
            // 1. Auto-cancel unpaid orders for this table
            const pendingOrders = await prisma.order.findMany({
                where: { tableId: parseInt(id), status: { in: ['WaitingPayment', 'Pending'] } }
            });

            for (const order of pendingOrders) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'Cancelled', cancellationReason: 'Kantin menutup/menonaktifkan meja ini' }
                });
                // Notify KASIR dashboard that order is cancelled
                if (req.io) req.io.emit('order_status_updated', { ...order, status: 'Cancelled', cancelReason: 'Kantin menutup/menonaktifkan meja ini' });
            }

            // 2. Broadcast to PWA users on this table
            if (req.io) {
                console.log(`[Socket] table_deactivated → Table ${id}`);
                req.io.emit('table_deactivated', { tableId: parseInt(id) });
            }
        } else if (isActive === true) {
            // Re-activation: tell PWA users they can come back
            if (req.io) {
                console.log(`[Socket] table_activated → Table ${id}`);
                req.io.emit('table_activated', { tableId: parseInt(id) });
            }
        }

        clearCache('/api/tables', req.storeId);

        res.json(table);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a table
exports.deleteTable = async (req, res) => {
    try {
        const { id } = req.params;

        // Ownership check
        const exists = await prisma.table.findFirst({
            where: {
                id: parseInt(id),
                location: { storeId: req.storeId }
            }
        });
        if (!exists) return res.status(404).json({ error: "Table not found or access denied" });

        await prisma.table.delete({
            where: { id: parseInt(id) },
        });

        clearCache('/api/tables', req.storeId);

        res.json({ message: "Table deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
