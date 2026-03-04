const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const SECRET_KEY = process.env.WITHDRAWAL_SECRET_KEY || 'default_secret_key';
const WEBHOOK_URL = process.env.PAKASIR_WEBHOOK_URL || 'http://localhost:3000';

const calculateBalance = async (storeId, prismaClient = prisma) => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const coldIncomeAgg = await prismaClient.order.aggregate({
        _sum: { totalAmount: true },
        where: { storeId: storeId, paymentMethod: 'qris', paymentStatus: { equals: 'Paid', mode: 'insensitive' }, status: { not: 'Cancelled' }, createdAt: { lte: yesterday } }
    });
    const coldIncome = coldIncomeAgg._sum.totalAmount || 0;

    const totalWithdrawalAgg = await prismaClient.withdrawal.aggregate({
        _sum: { amount: true },
        where: { storeId: storeId, status: { in: ['Pending', 'Approved'] } }
    });
    const totalWithdrawn = totalWithdrawalAgg._sum.amount || 0;

    const availableBalance = coldIncome - totalWithdrawn;
    return { available: availableBalance > 0 ? availableBalance : 0, totalWithdrawn, coldIncome };
};

async function createManualWithdrawal() {
    const storeId = 2;
    const amount = 50000;
    const method = 'Bank Transfer';
    const store = await prisma.store.findUnique({ where: { id: storeId } });

    console.log("Starting Transaction...");
    try {
        const withdrawal = await prisma.$transaction(async (tx) => {
            const balances = await calculateBalance(storeId, tx);
            if (amount > balances.available) throw new Error("Saldo Saldo Cair tidak mencukupi (Cek Saldo Tertahan)");

            let targetBankName = store.bankName;
            let targetAccountNumber = store.bankNumber;
            let targetAccountName = store.bankHolder;

            const newWithdrawal = await tx.withdrawal.create({
                data: {
                    storeId,
                    amount: parseInt(amount),
                    method: "Bank Transfer",
                    status: "Pending",
                    bankName: targetBankName,
                    accountNumber: targetAccountNumber,
                    accountName: targetAccountName
                }
            });

            const postBalances = await calculateBalance(storeId, tx);
            const strictAvailable = (postBalances.available === 0 && (postBalances.totalWithdrawn > 0))
                ? await tx.order.aggregate({ _sum: { totalAmount: true }, where: { storeId: storeId, paymentMethod: 'qris', paymentStatus: { equals: 'Paid', mode: 'insensitive' }, status: { not: 'Cancelled' }, createdAt: { lte: new Date(new Date().getTime() - 24 * 60 * 60 * 1000) } } }).then(res => (res._sum.totalAmount || 0)) - postBalances.totalWithdrawn
                : postBalances.available;

            if (strictAvailable < 0) throw new Error("TRANSACTION_FAILED: Race condition detected. Saldo minus.");

            return newWithdrawal;
        });

        console.log("Transaction Success:", withdrawal);

        // Telegram Phase
        console.log("Sending Telegram...");
        const tokenApprove = crypto.createHmac('sha256', SECRET_KEY).update(`${withdrawal.id}approve`).digest('hex');
        const tokenReject = crypto.createHmac('sha256', SECRET_KEY).update(`${withdrawal.id}reject`).digest('hex');

        const linkApprove = `${WEBHOOK_URL}/api/withdraw/process?id=${withdrawal.id}&action=approve&token=${tokenApprove}`;
        const linkReject = `${WEBHOOK_URL}/api/withdraw/process?id=${withdrawal.id}&action=reject&token=${tokenReject}`;

        const message = `
<b>🔔 NEW WITHDRAWAL!</b>
Method: ${withdrawal.method}
User: ${withdrawal.accountName}
Bank/E-Wallet: ${withdrawal.bankName} - ${withdrawal.accountNumber}
Jumlah: Rp ${new Intl.NumberFormat('id-ID').format(withdrawal.amount)}

👇 <b>KLIK UNTUK PROSES:</b>
<a href="${linkApprove}">✅ ACC SEKARANG</a>
<a href="${linkReject}">❌ TOLAK</a>
        `;

        const { sendTelegramNotification } = require('./utils/telegramBot');
        sendTelegramNotification(message);

    } catch (e) {
        console.error("FATAL ERROR:", e);
    }
}

createManualWithdrawal().finally(() => prisma.$disconnect());
