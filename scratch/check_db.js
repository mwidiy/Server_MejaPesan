
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
    try {
        const stores = await prisma.store.findMany({
            include: { owner: true },
            take: 5
        });
        console.log("--- LATEST STORES ---");
        stores.forEach(s => {
            console.log(`Store ID: ${s.id}, Name: "${s.name}", Owner: "${s.owner.name}", Email: "${s.owner.email}"`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
