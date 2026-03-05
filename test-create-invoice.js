require('dotenv').config();
const crypto = require('crypto');

const DUITKU_API_KEY = process.env.DUITKU_API_KEY;
const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE;

const orderId = 'INV-TEST-001';
const amount = 15000;

const signature = crypto.createHash('md5').update(`${DUITKU_MERCHANT_CODE}${orderId}${amount}${DUITKU_API_KEY}`).digest('hex');

const payload = {
    merchantCode: DUITKU_MERCHANT_CODE,
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

async function testCreateInvoice() {
    console.log("Testing POST /api/merchant/createInvoice...");
    const res = await fetch('https://sandbox.duitku.com/webapi/api/merchant/createInvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log(text);
}

testCreateInvoice();
