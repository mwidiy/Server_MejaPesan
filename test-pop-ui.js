require('dotenv').config();
const crypto = require('crypto');

async function run() {
    const merchantCode = process.env.DUITKU_MERCHANT_CODE;
    const apiKey = process.env.DUITKU_API_KEY;
    const orderId = 'INV-POP-001';
    const amount = 15000;

    const payload = {
        merchantCode: merchantCode,
        paymentAmount: amount,
        merchantOrderId: orderId,
        productDetails: `Pesanan QuackXel #${orderId}`,
        email: 'test@quacxel.my.id',
        phoneNumber: '08123456789',
        itemDetails: [{ name: 'Nasi Goreng', price: amount, quantity: 1 }],
        customerDetail: {
            firstName: "Tester",
            lastName: "QuackXel",
            email: "test@quacxel.my.id",
            phoneNumber: "08123456789",
            billingAddress: {
                firstName: "Tester",
                lastName: "QuackXel",
                address: "Jl. Test",
                city: "Jakarta",
                postalCode: "11530",
                phone: "08123456789",
                countryCode: "ID"
            },
            shippingAddress: {
                firstName: "Tester",
                lastName: "QuackXel",
                address: "Jl. Test",
                city: "Jakarta",
                postalCode: "11530",
                phone: "08123456789",
                countryCode: "ID"
            }
        },
        customerVaName: 'Tester QuackXel',
        callbackUrl: 'https://api.quacxel.my.id/api/payment/callback',
        returnUrl: 'https://quacxel.my.id/order/123',
        expiryPeriod: 15
    };

    const timestamp = Date.now().toString();
    const signature = crypto.createHash('sha256').update(merchantCode + timestamp + apiKey).digest('hex');

    console.log("Timestamp:", timestamp);
    console.log("Signature:", signature);

    try {
        const res = await fetch('https://api-sandbox.duitku.com/api/merchant/createInvoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-duitku-signature': signature,
                'x-duitku-timestamp': timestamp,
                'x-duitku-merchantcode': merchantCode
            },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        console.log(`Status: ${res.status}`);
        console.log(`Response: ${text.substring(0, 1000)}`);
    } catch (e) {
        console.log("Error:", e.message);
    }
}

run();
