// Direct Prisma test: try to update a store with isCashActive
require('dotenv').config();

async function test() {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ log: ['query', 'error', 'warn'] });

    try {
        // First, find any store
        const store = await prisma.store.findFirst();
        if (!store) {
            console.log('No store found in database');
            return;
        }
        console.log('Found store:', store.id, store.name);
        console.log('Current isCashActive:', store.isCashActive);

        // Now try to update ONLY isCashActive
        console.log('\n--- Attempting prisma.store.update with { isCashActive: false } ---');
        const updated = await prisma.store.update({
            where: { id: store.id },
            data: { isCashActive: false }
        });
        console.log('✅ SUCCESS! Updated isCashActive to:', updated.isCashActive);

        // Restore it
        await prisma.store.update({
            where: { id: store.id },
            data: { isCashActive: true }
        });
        console.log('✅ Restored isCashActive to true');

    } catch (e) {
        console.log('❌ ERROR:', e.message);
        console.log('\nFull error:');
        console.log(e);
    } finally {
        await prisma.$disconnect();
    }
}

test();
