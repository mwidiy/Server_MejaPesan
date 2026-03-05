require('dotenv').config();
const { getDuitkuSignature } = require('./utils/crypto');

const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE;
const DUITKU_API_KEY = process.env.DUITKU_API_KEY;

const orderId = "QRIS-TEST999";
const amount = 15000;

const signature = getDuitkuSignature(DUITKU_MERCHANT_CODE, orderId, amount, DUITKU_API_KEY);

const methodsToTest = ['VC', 'M1', 'M2', 'B1', 'I1', 'A1', 'SP', 'OV', 'DA', 'LA', 'FT', 'NQ'];

async function testAll() {
    for (const pm of methodsToTest) {
        const payload = {
            merchantCode: DUITKU_MERCHANT_CODE,
            paymentAmount: amount,
            merchantOrderId: orderId,
            productDetails: `Pesanan QuackXel #${orderId}`,
            email: 'customer@quacxel.my.id',
            phoneNumber: '08123456789',
            itemDetails: [{ name: "Pesanan QuackXel", price: amount, quantity: 1 }],
            customerVaName: 'Customer',
            callbackUrl: 'https://api.quacxel.my.id/api/payments/webhook',
            returnUrl: `https://quacxel.my.id/order/${orderId}`,
            signature: signature,
            expiryPeriod: 15
        };

        try {
            const res = await fetch('https://sandbox.duitku.com/webapi/api/merchant/createInvoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.statusCode === '00') {
                console.log(`✅ SUCCESS WITH METHOD: ${pm} => URL: ${data.paymentUrl}`);
                break;
            } else {
                console.log(`❌ Failed with ${pm}:`, data.statusMessage || data.Message);
            }
        } catch (e) {
            console.error(`Error with ${pm}:`, e.message);
        }
    }
}

testAll();
