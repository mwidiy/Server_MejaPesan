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

// Global object to store active connections
const sessions = new Map();

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
 * Initialize a WhatsApp session for a specific store (Pairing Code Only)
 */
const initWASession = async (storeId, io) => {
    // TAHAP 40: Fetch phone number from DB
    const store = await prisma.store.findUnique({
        where: { id: parseInt(storeId) },
        select: { whatsappNumber: true }
    });

    if (!store || !store.whatsappNumber) {
        console.error(`[WA] Cannot init session: whatsappNumber is missing for store ${storeId}`);
        if (io) io.to(`store_${storeId}`).emit('wa_error', { message: 'Nomor WhatsApp belum diatur.' });
        return null;
    }

    // TAHAP 40: ROBUST PHONE FORMATTING (Must be international without +)
    let phoneNumber = store.whatsappNumber.replace(/\D/g, '');
    if (phoneNumber.startsWith('0')) {
        phoneNumber = '62' + phoneNumber.slice(1);
    }
    // If it starts with 62 but was entered as +62, the replace(/\D/g) already handled it.

    // Prevent duplicate initialization
    const existingSock = sessions.get(storeId);
    if (existingSock) {
        if (existingSock.user) {
            if (io) io.to(`store_${storeId}`).emit('wa_status', { status: 'connected' });
            return existingSock;
        }
    }

    const sessionDir = path.join(__dirname, '../sessions', `store_${storeId}`);
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
        printQRInTerminal: false,
        // TAHAP 40: Use official browser info for better pairing compatibility
        browser: ["Ubuntu", "Chrome", "121.0.6167.184"],
        syncFullHistory: false, 
        markOnlineOnConnect: true
    });

    sessions.set(storeId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // TAHAP 40: SPEED UP PAIRING
        // Instead of blind timeout, wait for 'qr' event or a specific state
        // If we get a 'qr', it means WhatsApp is ready to pair
        if (qr && !sock.authState.creds.registered) {
            console.log(`[WA] Connection ready for pairing. Requesting code for ${phoneNumber}...`);
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`[WA] Pairing Code for store ${storeId}: ${code}`);
                if (io) io.to(`store_${storeId}`).emit('wa_pairing_code', { code });
            } catch (err) {
                console.error('[WA] Pairing Code Error:', err.message);
                if (io) io.to(`store_${storeId}`).emit('wa_error', { message: 'Gagal ambil kode. Cek nomor di profil.' });
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            
            sessions.delete(storeId);
            if (shouldReconnect) {
                initWASession(storeId, io);
            } else {
                console.log(`[WA] Logged out from store ${storeId}. Cleaning up...`);
                if (fs.existsSync(sessionDir)) rimraf.sync(sessionDir);
                await prisma.store.update({
                    where: { id: parseInt(storeId) },
                    data: { isWaBotActive: false }
                });
                if (io) io.to(`store_${storeId}`).emit('wa_status', { status: 'disconnected' });
            }
        } else if (connection === 'open') {
            console.log(`[WA] Connection opened successfully for store ${storeId}`);
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

const disconnectWA = async (storeId) => {
    try {
        const sock = sessions.get(storeId);
        const sessionDir = path.join(__dirname, '../sessions', `store_${storeId}`);

        if (sock) {
            // TAHAP 40: Proper Logout
            try {
                await sock.logout();
            } catch (err) {
                console.warn(`[WA] Socket logout warning for store ${storeId}:`, err.message);
            }
            sock.end();
            sessions.delete(storeId);
        }

        // Always clean up directory to be sure
        if (fs.existsSync(sessionDir)) {
            rimraf.sync(sessionDir);
        }

        await prisma.store.update({
            where: { id: parseInt(storeId) },
            data: { isWaBotActive: false }
        });

        console.log(`[WA] Store ${storeId} disconnected and session cleared.`);
        return true;
    } catch (err) {
        console.error(`[WA] Disconnect error for store ${storeId}:`, err);
        return false;
    }
};

const getWAStatus = (storeId) => {
    const sock = sessions.get(parseInt(storeId));
    return sock && sock.user ? 'connected' : 'disconnected';
};

module.exports = {
    initWASession,
    restartAllActiveSessions,
    sendWAMessage,
    disconnectWA,
    getWAStatus,
    sessions
};
