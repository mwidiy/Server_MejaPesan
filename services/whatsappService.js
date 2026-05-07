const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const crypto = require('crypto');
const { signData } = require('../utils/security');

const logger = pino({ level: 'info' });

// Global object to store active connections and their last QR
const sessions = new Map();
const lastQrCodes = new Map();

/**
 * Get or Create a Virtual Table for WhatsApp orders
 */
const getOrCreateVirtualTable = async (storeId) => {
    // 1. Check/Create Location "WhatsApp"
    let location = await prisma.location.findFirst({
        where: { storeId: parseInt(storeId), name: 'WhatsApp' }
    });

    if (!location) {
        location = await prisma.location.create({
            data: { storeId: parseInt(storeId), name: 'WhatsApp' }
        });
        console.log(`[WA] Created Virtual Location 'WhatsApp' for store ${storeId}`);
    }

    // 2. Check/Create Table "Order"
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
        console.log(`[WA] Created Virtual Table 'Order' in Location 'WhatsApp' for store ${storeId}`);
    }

    return table;
};

/**
 * Initialize a WhatsApp session for a specific store
 */
const initWASession = async (storeId, io) => {
    // TAHAP 37: Prevent duplicate initialization
    const existingSock = sessions.get(storeId);
    if (existingSock) {
        console.log(`[WA] Session for store ${storeId} already exists. Re-emitting last QR if available.`);
        const lastQr = lastQrCodes.get(storeId);
        if (lastQr && io) {
            console.log(`[WA] Re-emitting last QR code for store ${storeId}`);
            io.to(`store_${storeId}`).emit('wa_qr_code', { qr: lastQr });
            io.to(`store_${storeId}`).emit('whatsapp_qr', { qr: lastQr });
        }
        return;
    }

    const sessionDir = path.join(__dirname, '../sessions', `store_${storeId}`);
    
    // Ensure sessions directory exists
    if (!fs.existsSync(path.join(__dirname, '../sessions'))) {
        fs.mkdirSync(path.join(__dirname, '../sessions'));
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: true,
        browser: ['Mac OS', 'Chrome', '121.0.6167.184'], // TAHAP 34: Use a more specific, modern Chrome version
        syncFullHistory: false, // Don't sync old chats to avoid detection and save resources
        markOnlineOnConnect: true
    });

    sessions.set(storeId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[WA] New QR Code generated for store ${storeId}`);
            lastQrCodes.set(storeId, qr); // Cache the QR
            // Emit QR to Socket.io for the Admin App (as JSONObject)
            if (io) {
                io.to(`store_${storeId}`).emit('wa_qr_code', { qr });
                io.to(`store_${storeId}`).emit('whatsapp_qr', { qr });
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            
            console.log(`[WA] Connection closed for store ${storeId}. Reason:`, lastDisconnect.error, 'Reconnect:', shouldReconnect);
            
            sessions.delete(storeId);
            lastQrCodes.delete(storeId); // Clear QR on close

            if (shouldReconnect) {
                initWASession(storeId, io);
            } else {
                console.log(`[WA] Logged out from store ${storeId}. Cleaning up...`);
                rimraf.sync(sessionDir);
                // Update DB state
                await prisma.store.update({
                    where: { id: parseInt(storeId) },
                    data: { isWaBotActive: false }
                });
                if (io) io.to(`store_${storeId}`).emit('wa_status', { status: 'disconnected' });
            }
        } else if (connection === 'open') {
            console.log(`[WA] Connection opened successfully for store ${storeId}`);
            lastQrCodes.delete(storeId); // Clear QR on success
            await prisma.store.update({
                where: { id: parseInt(storeId) },
                data: { isWaBotActive: true }
            });
            if (io) io.to(`store_${storeId}`).emit('wa_status', { status: 'connected' });
        }
    });

    // Handle Incoming Messages
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe && msg.message) {
                    const from = msg.key.remoteJid;
                    // TAHAP 38: Robust JID Extraction (Handle suffixes like :1 or @lid)
                    const fullId = from.split('@')[0];
                    const phone = fullId.split(':')[0]; // Remove device suffix
                    const jidType = from.split('@')[1]; // s.whatsapp.net or lid
                    
                    const pushName = msg.pushName || 'Pelanggan WA';
                    const body = msg.message.conversation || msg.message.extendedTextMessage?.text;

                    if (body) {
                        console.log(`[WA DEBUG] Incoming Message from ${from} (${pushName}). Extracted Phone: ${phone}`);
                        
                        try {
                            // 1. Ensure Virtual Table Exists
                            const virtualTable = await getOrCreateVirtualTable(storeId);
                            
                            // 2. Generate Secure Link
                            const pwaUrl = process.env.PWA_URL || 'https://staging.quacxel.my.id';
                            // TAHAP 39: Include JID Type (jt) in signature for full identity security
                            const sig = signData(`${String(storeId)}:${String(virtualTable.id)}:${String(phone)}:${String(jidType)}`);
                            
                            // 3. Construct URL with Magical Identity parameters
                            // jt = jidType (lid or s.whatsapp.net)
                            const magicalLink = `${pwaUrl}/?s=${storeId}&t=${virtualTable.id}&p=${phone}&jt=${jidType}&n=${encodeURIComponent(pushName)}&sig=${sig}`;
                            
                            const welcomeMsg = `Halo kak *${pushName}*! Terima kasih sudah menghubungi kami. \n\nSilakan klik link di bawah ini untuk melihat menu dan langsung memesan ya kak. Nomor WhatsApp kakak sudah terhubung otomatis: \n\n${magicalLink}`;
                            
                            // TAHAP 39: Disable link preview to avoid missing dependency errors (link-preview-js)
                            await sock.sendMessage(from, { text: welcomeMsg }, { linkPreview: null });
                            console.log(`[WA DEBUG] Sent Magical Link to ${from} (Type: ${jidType})`);
                        } catch (err) {
                            console.error('[WA DEBUG] Error sending welcome message:', err);
                        }
                    }
                }
            }
        }
    });

    return sock;
};

/**
 * Restart all active bot sessions (call this on server start)
 */
const restartAllActiveSessions = async (io) => {
    try {
        const activeStores = await prisma.store.findMany({
            where: { isWaBotActive: true },
            select: { id: true }
        });

        console.log(`[WA] Restarting ${activeStores.length} active bot sessions...`);
        for (const store of activeStores) {
            initWASession(store.id, io);
        }
    } catch (err) {
        console.error('[WA] Error restarting sessions:', err);
    }
};

/**
 * Send a WhatsApp message for a specific store
 * @param {number|string} storeId 
 * @param {string} phone - Recipient phone number (e.g. 62812...)
 * @param {string} message - Message text
 */
const sendWAMessage = async (storeId, phone, message) => {
    try {
        const sock = sessions.get(parseInt(storeId));
        if (!sock) {
            console.warn(`[WA] Cannot send message: No active session for store ${storeId}`);
            return false;
        }

        // TAHAP 38: Smart JID Formatting
        let jid;
        if (phone.includes('@')) {
            jid = phone; // Already a full JID
        } else if (phone.length > 15) {
            // Likely a LID or Group ID if it's very long and has non-digits
            jid = `${phone}@lid`;
        } else {
            // Standard phone number
            const cleanPhone = phone.replace(/\D/g, '');
            jid = `${cleanPhone}@s.whatsapp.net`;
        }

        console.log(`[WA DEBUG] Sending message to JID: ${jid}`);
        await sock.sendMessage(jid, { text: message });
        return true;
    } catch (err) {
        console.error(`[WA] Error sending message for store ${storeId}:`, err.message);
        return false;
    }
};

module.exports = {
    initWASession,
    restartAllActiveSessions,
    sendWAMessage,
    sessions
};
