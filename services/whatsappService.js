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

const logger = pino({ level: 'info' });

// Global object to store active connections and their last QR
const sessions = new Map();
const lastQrCodes = new Map();

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
                    const body = msg.message.conversation || msg.message.extendedTextMessage?.text;

                    if (body) {
                        console.log(`[WA] Message from ${from} for store ${storeId}: ${body}`);
                        
                        // SIMPLE AUTO-REPLY LOGIC
                        const pwaUrl = process.env.PWA_URL || 'https://staging.quacxel.my.id';
                        const replyMessage = `Halo! Terima kasih sudah menghubungi kami. \n\nUntuk memesan makanan, silakan klik link berikut ini ya kak: \n${pwaUrl}/?storeId=${storeId}`;
                        
                        await sock.sendMessage(from, { text: replyMessage });
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
