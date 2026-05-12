const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

/**
 * Generate a short code for a URL
 * @param {string} originalUrl 
 * @returns {Promise<string>} shortCode
 */
const generateShortLink = async (originalUrl) => {
    try {
        // Check if this URL already has a short code
        const existing = await prisma.shortLink.findFirst({
            where: { originalUrl }
        });
        if (existing) return existing.code;

        // Create new short code
        let isUnique = false;
        let code = '';
        
        while (!isUnique) {
            // Generate 6 character alphanumeric code
            code = crypto.randomBytes(4).toString('hex').slice(0, 6);
            
            const conflict = await prisma.shortLink.findUnique({
                where: { code }
            });
            if (!conflict) isUnique = true;
        }

        await prisma.shortLink.create({
            data: {
                code,
                originalUrl
            }
        });

        return code;
    } catch (err) {
        console.error('[Shortener] Fatal Error:', err.message);
        
        // --- AUTO-REPAIR LOGIC: If table is missing, try to create it once ---
        if (err.code === 'P2021' || err.message.includes('does not exist')) {
            console.log('[Shortener] Attempting to create missing table short_links...');
            try {
                await prisma.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "short_links" (
                        "code" TEXT NOT NULL,
                        "originalUrl" TEXT NOT NULL,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "short_links_pkey" PRIMARY KEY ("code")
                    );
                `);
                console.log('[Shortener] Table short_links created successfully. Retrying generation...');
                return generateShortLink(originalUrl); // Retry once
            } catch (createErr) {
                console.error('[Shortener] Auto-repair failed:', createErr.message);
            }
        }
        return null;
    }
};

/**
 * Get long URL from short code
 * @param {string} code 
 * @returns {Promise<string|null>}
 */
const getOriginalUrl = async (code) => {
    try {
        const link = await prisma.shortLink.findUnique({
            where: { code }
        });
        return link ? link.originalUrl : null;
    } catch (err) {
        console.error('[Shortener] Lookup Error:', err);
        return null;
    }
};

module.exports = {
    generateShortLink,
    getOriginalUrl
};
