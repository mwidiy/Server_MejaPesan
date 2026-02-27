const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testController() {
    const code = 'TRX-20260227-VF3U';
    const order = await prisma.order.findUnique({
        where: { transactionCode: code },
        include: {
            items: { include: { product: true } },
            table: { include: { location: true } },
            store: { select: { whatsappNumber: true } }
        }
    });

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

    const formatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    const clockTime = formatter.format(predictedTime).replace('.', ':');
    console.log({ clockTime, queuePosition });
}

testController().catch(console.error).finally(() => prisma.$disconnect());
