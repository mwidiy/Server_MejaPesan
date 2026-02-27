const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testFetchLatest() {
    try {
        const latestOrder = await prisma.order.findFirst({
            orderBy: { createdAt: 'desc' },
            include: { store: true, items: true, table: true }
        });

        if (!latestOrder) {
            console.log("No orders in DB");
            return;
        }
        console.log("Found Latest Order:", latestOrder.transactionCode);

        // Now let's try calling exactly what getOrderByTransactionCode does
        const code = latestOrder.transactionCode;

        const order = await prisma.order.findUnique({
            where: { transactionCode: code },
            include: {
                items: { include: { product: true } },
                table: { include: { location: true } },
                store: { select: { whatsappNumber: true } }
            }
        });

        if (!order) {
            console.log("Order By Code Not Found!");
            return;
        }

        const queueWhere = {
            createdAt: {
                lt: order.createdAt,
                gte: new Date(new Date().setHours(0, 0, 0, 0))
            },
            status: 'Pending'
        };

        if (order.storeId) {
            queueWhere.storeId = order.storeId;
        }

        const ordersQueue = await prisma.order.findMany({
            where: queueWhere,
            include: { items: { include: { product: true } } }
        });

        const queuePosition = ordersQueue.length + 1;

        let totalMinutesAhead = 0;
        for (const qOrder of ordersQueue) {
            let orderPrep = 5;
            if (qOrder.items && qOrder.items.length > 0) {
                orderPrep = Math.max(...qOrder.items.map(i => i.product.prepTime || 5));
            }
            totalMinutesAhead += orderPrep;
        }

        let myPrep = 5;
        if (order.items && order.items.length > 0) {
            myPrep = Math.max(...order.items.map(i => i.product.prepTime || 5));
        }

        const baseTime = new Date(order.createdAt);
        const predictedTime = new Date(baseTime.getTime() + (totalMinutesAhead + myPrep) * 60000);

        const utcMillis = predictedTime.getTime();
        const wibMillis = utcMillis + (7 * 60 * 60 * 1000);
        const wibDate = new Date(wibMillis);

        const hours = String(wibDate.getUTCHours()).padStart(2, '0');
        const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
        const clockTime = `${hours}:${minutes}`;

        console.log("RESPONSE SUCCESS:");
        console.log({
            transactionCode: order.transactionCode,
            status: order.status,
            queuePosition,
            ordersAhead: ordersQueue.length,
            predictedServiceTime: clockTime
        });

    } catch (err) {
        console.error("CRASH IN LOGIC:", err);
    } finally {
        prisma.$disconnect();
    }
}
testFetchLatest();
