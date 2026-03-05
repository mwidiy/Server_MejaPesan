require('dotenv').config();
const crypto = require('crypto');

async function testSignature(formulaName, sigString, removeAmountAndMethod = false) {
    const merchantCode = process.env.DUITKU_MERCHANT_CODE;
    const orderId = 'INV-TEST-99' + Math.floor(Math.random() * 1000);
    const amount = 15000;

    // Replace placeholders
    const actualSigString = sigString
        .replace('{merchantCode}', merchantCode)
        .replace('{orderId}', orderId)
        .replace('{amount}', amount)
        .replace('{apiKey}', process.env.DUITKU_API_KEY);

    const signature = crypto.createHash('md5').update(actualSigString).digest('hex');

    const payload = {
        merchantCode: merchantCode,
        paymentAmount: amount,
        merchantOrderId: orderId,
        productDetails: `Test #${orderId}`,
        email: 'test@example.com',
        phoneNumber: '08123456789',
        customerVaName: 'Test Customer',
        callbackUrl: 'https://api.quacxel.my.id/api/payment/callback',
        returnUrl: 'https://quacxel.my.id/order/123',
        signature: signature,
        expiryPeriod: 15
    };

    if (!removeAmountAndMethod) {
        payload.itemDetails = [{ name: 'Test', price: amount, quantity: 1 }];
    }

    try {
        const res = await fetch('https://sandbox.duitku.com/webapi/api/merchant/createInvoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        console.log(`[${formulaName}] Status: ${res.status} -> ${text.substring(0, 100)}`);
    } catch (e) {
        console.log(`[${formulaName}] Error: ${e.message}`);
    }
}

async function run() {
    await testSignature("Standard (Code+Id+Amount+Key)", "{merchantCode}{orderId}{amount}{apiKey}");
    await testSignature("No Amount (Code+Id+Key)", "{merchantCode}{orderId}{apiKey}");
    await testSignature("Amount Second (Code+Amount+Id+Key)", "{merchantCode}{amount}{orderId}{apiKey}");
    await testSignature("Minimal Payload + Standard Sig", "{merchantCode}{orderId}{amount}{apiKey}", true);
}

run();
