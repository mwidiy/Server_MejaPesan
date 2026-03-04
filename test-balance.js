const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const calculateBalance = async (storeId, prismaClient = prisma) => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const coldIncomeAgg = await prismaClient.order.aggregate({
        _sum: { totalAmount: true },
        where: {
            storeId: storeId,
            paymentMethod: 'qris',
            paymentStatus: { equals: 'Paid', mode: 'insensitive' },
            status: { not: 'Cancelled' },
            createdAt: { lte: yesterday }
        }
    });
    const coldIncome = coldIncomeAgg._sum.totalAmount || 0;

    const totalWithdrawalAgg = await prismaClient.withdrawal.aggregate({
        _sum: { amount: true },
        where: {
            storeId: storeId,
            status: { in: ['Pending', 'Approved'] }
        }
    });
    const totalWithdrawn = totalWithdrawalAgg._sum.amount || 0;

    const availableBalance = coldIncome - totalWithdrawn;

    return {
        available: availableBalance > 0 ? availableBalance : 0,
        totalWithdrawn,
        coldIncome
    };
};

async function main() {
    const storeId = 2;
    const amount = 50000;
    const method = 'Bank Transfer';

    try {
        const withdrawal = await prisma.$transaction(async (tx) => {
            const balances = await calculateBalance(storeId, tx);
            console.log("Initial Balances:", balances);

            if (amount > balances.available) {
                throw new Error("Saldo Saldo Cair tidak mencukupi (Cek Saldo Tertahan)");
            }

            const store = await tx.store.findUnique({ where: { id: storeId } });
            console.log("Store Data:", { bankName: store.bankName, ewallet: store.ewalletType });

            let targetBankName, targetAccountNumber, targetAccountName, withdrawalMethod;

            if (method === "ShopeePay") {
                if (!store.ewalletNumber || !store.ewalletName) throw new Error("Data E-Wallet belum lengkap di profil");
                targetBankName = store.ewalletType || "E-Wallet"; targetAccountNumber = store.ewalletNumber; targetAccountName = store.ewalletName; withdrawalMethod = "E-Wallet";
            } else {
                if (!store.bankName || !store.bankNumber || !store.bankHolder) throw new Error("Data Bank belum lengkap di profil");
                targetBankName = store.bankName; targetAccountNumber = store.bankNumber; targetAccountName = store.bankHolder; withdrawalMethod = "Bank Transfer";
            }

            console.log("Creating specific withdrawal...");
            // Fake creating to just test validation logic, don't actually insert
            // Or we just calculate the strict validation

            const postBalances = await calculateBalance(storeId, tx);
            // Simulate the deduction
            postBalances.totalWithdrawn += amount;
            postBalances.available -= amount;
            console.log("Simulated Post Balances:", postBalances);

            const strictAvailable = (postBalances.available <= 0 && (postBalances.totalWithdrawn > 0))
                ? await tx.order.aggregate({ _sum: { totalAmount: true }, where: { storeId: storeId, paymentMethod: 'qris', paymentStatus: { equals: 'Paid', mode: 'insensitive' }, status: { not: 'Cancelled' }, createdAt: { lte: new Date(new Date().getTime() - 24 * 60 * 60 * 1000) } } }).then(res => (res._sum.totalAmount || 0)) - postBalances.totalWithdrawn
                : postBalances.available;

            console.log("Strict Available:", strictAvailable);

            if (strictAvailable < 0) {
                throw new Error("TRANSACTION_FAILED: Race condition detected. Saldo minus.");
            }

            return "Simulation Passed";
        });
        console.log(withdrawal);
    } catch (e) {
        console.error("ERROR CAUGHT:");
        console.error(e.message);
    }
}

main().finally(() => prisma.$disconnect());
