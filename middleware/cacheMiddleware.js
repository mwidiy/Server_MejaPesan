const NodeCache = require("node-cache");

// STD TTL: 300 detik (5 menit). Check period: 60 detik.
const myCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

/**
 * Middleware untuk meng-cache response API (GET)
 * @param {number} duration - Durasi cache dalam detik (default: 300)
 */
const cacheMiddleware = (duration = 300) => {
    return (req, res, next) => {
        // HANYA CACHE UNTUK REQUEST GET
        if (req.method !== 'GET') {
            return next();
        }

        // 1. Kenali toko mana yang request (Multi-tenant isolation)
        // Store ID diambil dari parameter, query, middleware auth(req.storeId), atau origin headers
        const storeId = req.query.storeId || req.storeId || req.headers['x-store-id'] || 'global';

        // 2. Buat Cache Key yang unik per Toko dan URL
        // Contoh: "store_2_/api/products?status=active"
        const key = `store_${storeId}_${req.originalUrl || req.url}`;

        // 3. Cek apakah memori cache punya data untuk key ini
        const cachedResponse = myCache.get(key);

        if (cachedResponse) {
            // JIKA ADA: Langsung kirim dari RAM (Bypass Prisma DB)
            if (process.env.NODE_ENV !== 'production') {
                console.log(`⚡ [RAM CACHE HIT] Served ${key} directly from Memory!`);
            }
            return res.status(200).json(cachedResponse);
        } else {
            // JIKA KOSONG: Biarkan lanjut ke Controller (Prisma DB), tapi bajak fungsi res.json()
            if (process.env.NODE_ENV !== 'production') {
                console.log(`💾 [DB FETCH] Cache Miss for ${key}. Hitting Database...`);
            }

            // Simpan fungsi asli res.json
            const originalJson = res.json;

            // Override res.json
            res.json = (body) => {
                // Hanya cache respon jika statusnya sukses (biasanya 200/201 dan body.success == true)
                if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
                    myCache.set(key, body, duration);
                }

                // Panggil fungsi asli res.json dengan datanya
                originalJson.call(res, body);
            };

            next(); // Lanjutkan ke Prisma (Controller)
        }
    };
};

/**
 * Fungsi utilitas untuk MENGHAPUS / MEMBAKAR cache tertentu
 * Dipanggil ketika ada operasi POST/PUT/DELETE
 * @param {string} prefix - Prefix atau kata kunci URL yang mau dihapus (contoh: "products")
 * @param {string|number} storeId - ID Toko (Wajib untuk Multi-tenant)
 */
const clearCache = (prefix, storeId) => {
    const sId = storeId || 'global';
    const keys = myCache.keys();

    // Cari semua key cache yang mengandung prefix dan ID Toko ini
    const keysToDelete = keys.filter(key =>
        key.startsWith(`store_${sId}_`) && key.includes(prefix)
    );

    if (keysToDelete.length > 0) {
        myCache.del(keysToDelete);
        if (process.env.NODE_ENV !== 'production') {
            console.log(`🔥 [CACHE BURNT] Flushed ${keysToDelete.length} memory blocks for ${prefix} in Store ${sId}`);
        }
    }
};

module.exports = { cacheMiddleware, clearCache };
