const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const config = await prisma.systemConfig.upsert({
            where: { key: 'GLOBAL_PAYMENT_GATEWAY' },
            update: { value: 'midtrans' },
            create: {
                key: 'GLOBAL_PAYMENT_GATEWAY',
                value: 'midtrans'
            }
        });
        console.log("✅ GLOBAL_PAYMENT_GATEWAY successfully set to 'midtrans'");
        console.log("Config:", config);
    } catch (error) {
        console.error("❌ Error updating config:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
