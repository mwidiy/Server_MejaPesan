const crypto = require('crypto');

/**
 * Generate MD5 Hash string for Duitku
 * @param {string} text - The input string to hash
 * @returns {string} - The MD5 hashed string
 */
const generateMD5 = (text) => {
    return crypto.createHash('md5').update(text).digest('hex');
};

/**
 * Generate Duitku Signature for Create Transaction
 * @param {string} merchantCode
 * @param {string} orderId
 * @param {number|string} amount
 * @param {string} apiKey
 */
const getDuitkuSignature = (merchantCode, orderId, amount, apiKey) => {
    // Format: merchantCode + orderId + amount + apiKey
    const signatureString = `${merchantCode}${orderId}${amount}${apiKey}`;
    return generateMD5(signatureString);
};

/**
 * Generate Duitku Signature for Callback / Webhook Check
 * @param {string} merchantCode
 * @param {number|string} amount
 * @param {string} orderId
 * @param {string} apiKey
 */
const getDuitkuCallbackSignature = (merchantCode, amount, orderId, apiKey) => {
    // Format: merchantCode + amount + merchantOrderId + apiKey
    const signatureString = `${merchantCode}${amount}${orderId}${apiKey}`;
    return generateMD5(signatureString);
};

module.exports = {
    generateMD5,
    getDuitkuSignature,
    getDuitkuCallbackSignature
};
