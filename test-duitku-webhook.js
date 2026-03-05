require('dotenv').config();
const crypto = require('crypto');

const DUITKU_API_KEY = process.env.DUITKU_API_KEY;
const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE;

// Format: MD5(merchantCode + amount + merchantOrderId + apiKey)
const generateCallbackSignature = (merchantCode, amount, merchantOrderId, apiKey) => {
    const stringToHash = `${merchantCode}${amount}${merchantOrderId}${apiKey}`;
    return crypto.createHash('md5').update(stringToHash).digest('hex');
};

const runSimulatedWebhook = async (orderId, amount) => {
    console.log(`\n🧪 MENSIMULASIKAN WEBHOOK DUITKU UNTUK ORDER: ${orderId}`);

    const signature = generateCallbackSignature(DUITKU_MERCHANT_CODE, amount, orderId, DUITKU_API_KEY);
    console.log(`🔑 Generated Signature: ${signature}`);

    const payload = {
        merchantCode: DUITKU_MERCHANT_CODE,
        amount: amount.toString(),
        merchantOrderId: orderId.toString(),
        productDetail: `Pembayaran QuackXel #${orderId}`,
        additionalParam: '',
        paymentMethod: 'SP', // ShopeePay
        resultCode: '00', // 00 = Success, 01 = Failed
        merchantUserId: 'customer_dev',
        reference: 'DS12345678TEST',
        signature: signature
    };

    try {
        console.log(`🚀 Mengirim POST /api/payment/callback ke https://api.quacxel.my.id ...\n`);
        const res = await fetch('https://api.quacxel.my.id/api/payment/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        console.log(`📥 Respon Backend:`);
        console.log(`Status: ${res.status}`);
        console.log(`Body:`, text);

        if (res.ok) {
            console.log(`\n✅ Webhook sukses diterima Backend KASIR!`);
            console.log(`Cek KASIR lu, pesanannya pasti udah lunas (Pindah ke Tab Lunas otomatis / Notif ijo nyala).`);
        } else {
            console.log(`\n❌ Error memproses webhook di Backend.`);
        }

    } catch (e) {
        console.error('❌ Error Fetch Koyeb Server:', e.message);
        console.log('Pastikan SERVER_MEJA (Koyeb) lu lagi jalan dan nggak sleep!');
    }
};

// Ambil Argument dari Terminal
const args = process.argv.slice(2);
const orderId = args[0] || 'QRIS-TEST-MATH-2';
const amount = args[1] ? parseInt(args[1]) : 15150;

if (!args[0]) {
    console.log("💡 Tips: Eksekusi script ini memakai nomor order & nominal aslinya");
    console.log("👉 Contoh: node test-duitku-webhook.js TRX-20230101-ABCD 15000\n");
}

runSimulatedWebhook(orderId, amount);
