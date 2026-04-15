const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Fetching users and stores...");
    const users = await prisma.user.findMany({ include: { store: true } });
    for (const u of users) {
        console.log(`User ID: ${u.id}, Name: ${u.name}, Store: ${u.store ? u.store.name : 'NONE'}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
