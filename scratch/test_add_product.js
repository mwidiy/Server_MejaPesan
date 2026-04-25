// Test to simulate adding a menu to the database
require('dotenv').config();

async function testAddProduct() {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ log: ['query', 'error', 'warn'] });

    try {
        console.log('--- Checking connection to DB ---');
        // Let's see if we have a Store and Category to connect to
        const store = await prisma.store.findFirst();
        if (!store) {
            console.log('No store found');
            return;
        }

        console.log('Store found:', store.id);

        let category = await prisma.category.findFirst({ where: { storeId: store.id } });
        if (!category) {
            console.log('No category found, creating one...');
            category = await prisma.category.create({
                data: { name: 'Test Category', storeId: store.id }
            });
        }
        
        console.log('Category found/created:', category.id);

        // Simulated Request Data
        const reqBody = {
            name: "Test Menu",
            categoryId: category.id.toString(), // Simulate string from multipart/form-data
            price: "15000",                     // Simulate string from multipart/form-data
            description: "Enak banget",
        };
        const reqStoreId = store.id; // Simulate req.storeId (it might be string or int)

        console.log('\n--- Simulating createProduct ---');
        const newProduct = await prisma.product.create({
            data: {
                name: reqBody.name,
                category: { connect: { id: parseInt(reqBody.categoryId) } },
                price: Number(reqBody.price),
                description: reqBody.description,
                image: null,
                isActive: true,
                ar3dModel: null,
                isArActive: false,
                store: { connect: { id: reqStoreId } } 
            },
            include: {
                category: true
            }
        });

        console.log('✅ Success! Product created:');
        console.log(newProduct);

        // Cleanup
        await prisma.product.delete({ where: { id: newProduct.id } });
        console.log('✅ Cleaned up product');

    } catch (err) {
        console.log('❌ Error occurred:');
        console.log(err.message);
    } finally {
        await prisma.$disconnect();
    }
}

testAddProduct();
