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
    console.log(`[WA] Initializing session for store ${storeId}...`);
    
    if (sessions.has(storeId)) {
        console.log(`[WA] Session already active for store ${storeId}.`);
        
        // If we have a pending QR, re-emit it to the new socket connection
        const lastQr = lastQrCodes.get(storeId);
        if (lastQr && io) {
            console.log(`[WA] Re-emitting last QR code for store ${storeId}`);
            io.to(`store_${storeId}`).emit('wa_qr_code', { qr: lastQr });
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
                    const phone = from.split('@')[0];
                    const pushName = msg.pushName || 'Pelanggan WA';
                    const body = msg.message.conversation || msg.message.extendedTextMessage?.text;

                    if (body) {
                        console.log(`[WA] Message from ${from} (${pushName}) for store ${storeId}: ${body}`);
                        
                        try {
                            // 1. Ensure Virtual Table Exists
                            const virtualTable = await getOrCreateVirtualTable(storeId);
                            
                            // 2. Generate Secure Link
                            const pwaUrl = process.env.PWA_URL || 'https://staging.quacxel.my.id';
                            const sig = signData(`${storeId}:${virtualTable.id}:${phone}`);
                            
                            // 3. Construct URL with Magical Identity parameters
                            // s = storeId, t = tableId, p = phone, n = name, sig = signature
                            const magicalLink = `${pwaUrl}/?s=${storeId}&t=${virtualTable.id}&p=${phone}&n=${encodeURIComponent(pushName)}&sig=${sig}`;
                            
                            const replyMessage = `Halo kak ${pushName}! Terima kasih sudah menghubungi kami. \n\nSilakan klik link di bawah ini untuk melihat menu dan langsung memesan ya kak. Nomor WhatsApp kakak sudah terhubung otomatis: \n\n${magicalLink}`;
                            
                            await sock.sendMessage(from, { text: replyMessage });
                        } catch (err) {
                            console.error('[WA] Error handling message:', err);
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

module.exports = {
    initWASession,
    restartAllActiveSessions,
    sessions
};
