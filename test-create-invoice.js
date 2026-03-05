require('dotenv').config();
const crypto = require('crypto');

async function run() {
    const merchantCode = process.env.DUITKU_MERCHANT_CODE;
    const apiKey = process.env.DUITKU_API_KEY;
    const orderId = 'INV-TEST-31';
    const amount = 15000;

    const signature = crypto.createHash('md5').update(`${merchantCode}${orderId}${amount}${apiKey}`).digest('hex');

    const payload = {
        merchantCode: merchantCode,
        paymentAmount: amount,
        merchantOrderId: orderId,
        productDetails: `Pesanan QuackXel #${orderId}`,
        email: 'test@example.com',
        phoneNumber: '08123456789',
        itemDetails: [{ name: 'Test Item', price: amount, quantity: 1 }],
        customerVaName: 'Test Customer',
        callbackUrl: 'https://api.quacxel.my.id/api/payment/callback',
        returnUrl: 'https://quacxel.my.id/order/123',
        signature: signature,
        expiryPeriod: 15
    };

    const urlsToTest = [
        'https://sandbox.duitku.com/webapi/api/merchant/createInvoice',
        'https://api-sandbox.duitku.com/api/merchant/createInvoice',
        'https://sandbox.duitku.com/webapi/api/merchant/createinvoice'
    ];

    for (const url of urlsToTest) {
        console.log(`\nTesting URL: ${url}`);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            console.log(`Status: ${res.status}`);
            console.log(`Response: ${text.substring(0, 500)}`);
        } catch (e) {
            console.log("Error:", e.message);
        }
    }
}

run();
