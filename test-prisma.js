const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    const latestOrder = await prisma.order.findFirst({
        orderBy: { createdAt: 'desc' }
    });
    console.log("Latest Order:", latestOrder ? latestOrder.transactionCode : "None");
}
test().finally(() => prisma.$disconnect());
