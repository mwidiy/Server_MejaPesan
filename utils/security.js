const crypto = require('crypto');

/**
 * Sign data using HMAC-SHA256
 * @param {string} data - The string to sign
 * @returns {string} - Hex encoded signature
 */
const signData = (data) => {
    const secret = process.env.BOT_SECRET || 'quacxel_default_secret';
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
};

/**
 * Verify if the signature matches the data
 * @param {string} data - The original data
 * @param {string} sig - The signature to verify
 * @returns {boolean}
 */
const verifySignature = (data, sig) => {
    if (!sig) return false;
    const expected = signData(data);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
};

module.exports = {
    signData,
    verifySignature
};
