const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// In-memory mock sessions map
const sessions = new Map();

/**
 * Get or Create a Virtual Table for WhatsApp orders (Preserved for DB backwards compatibility)
 */
const getOrCreateVirtualTable = async (storeId) => {
    try {
        let location = await prisma.location.findFirst({
            where: { storeId: parseInt(storeId), name: 'WhatsApp' }
        });

        if (!location) {
            location = await prisma.location.create({
                data: { storeId: parseInt(storeId), name: 'WhatsApp' }
            });
            console.log(`[WA_DISABLED] Created Virtual Location 'WhatsApp' for store ${storeId}`);
        }

        let table = await prisma.table.findFirst({
            where: { locationId: location.id, name: 'Order' }
        });

        if (!table) {
            table = await prisma.table.create({
                data: {
                    locationId: location.id,
                    name: 'Order',
                    qrCode: `whatsapp_order_${storeId}_${Date.now()}`,
                    isActive: true
                }
            });
            console.log(`[WA_DISABLED] Created Virtual Table 'Order' for store ${storeId}`);
        }

        return table;
    } catch (err) {
        console.error('[WA_DISABLED] Error getting virtual table:', err.message);
        return null;
    }
};

/**
 * Safe No-Op Functions (WA Feature Decommissioned)
 */
const initWASession = async (storeId, io) => {
    console.log(`[WA_DISABLED] Init WA requested for store ${storeId}, but feature is permanently disabled.`);
    if (io) {
        io.to(`store_${storeId}`).emit('wa_error', { 
            message: 'Fitur WhatsApp Bot telah dinonaktifkan demi performa dan keamanan akun.' 
        });
    }
    return null;
};

const restartAllActiveSessions = async () => {
    // No-op
};

const sendWAMessage = async (storeId, jid, message) => {
    console.log(`[WA_DISABLED] Message not sent to ${jid} (WA Feature Disabled)`);
    return false;
};

const disconnectWA = async (storeId) => {
    try {
        await prisma.store.update({
            where: { id: parseInt(storeId) },
            data: { isWaBotActive: false }
        });
        return true;
    } catch (err) {
        return false;
    }
};

const getWAStatus = (storeId) => {
    return 'disabled';
};

const getSocketByStoreId = (storeId) => {
    return null;
};

module.exports = {
    initWASession,
    restartAllActiveSessions,
    sendWAMessage,
    disconnectWA,
    getWAStatus,
    getSocketByStoreId,
    getOrCreateVirtualTable,
    sessions
};
