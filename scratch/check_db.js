const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDB() {
    try {
        const columns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Order'`;
        console.log('Columns in Order table after sync:', columns);
        
        const products = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'Product'`;
        console.log('Columns in Product table after sync:', products);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkDB();
