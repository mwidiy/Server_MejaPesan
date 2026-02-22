const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    try {
        console.log("🧹 Starting Cleanup of 'WaitingPayment' Orders...");

        const deleted = await prisma.order.deleteMany({
            where: {
                status: 'WaitingPayment',
                paymentStatus: { not: 'Paid' } // Safety check
            }
        });

        console.log(`✅ Deleted ${deleted.count} orders with status 'WaitingPayment'.`);

    } catch (e) {
        console.error("❌ Error cleaning up:", e);
    } finally {
        await prisma.$disconnect();
    }
}

cleanup();
