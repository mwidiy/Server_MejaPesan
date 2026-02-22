const PDFDocument = require('pdfkit-table');
const fs = require('fs');

const exportOrdersPdf = async (req, res) => {
    try {
        const { status, type, search } = req.query; // Accept filters

        let whereClause = {};

        // 1. Status Filter
        if (status && status !== 'All') {
            // Support comma-separated
            const statuses = status.split(',');
            if (statuses.length > 1) {
                whereClause.status = { in: statuses };
            } else {
                whereClause.status = status;
            }
        }

        // 2. Type Filter
        if (type && type !== 'All') {
            whereClause.orderType = type;
        }

        // 3. Search Filter (Global)
        if (search) {
            whereClause.OR = [
                { transactionCode: { contains: search } },
                { customerName: { contains: search } },
                { items: { some: { product: { name: { contains: search } } } } }
            ];
        }

        const orders = await prisma.order.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            include: { items: { include: { product: true } } }
        });

        // Create PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4' });

        // Stream Response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Laporan_Riwayat.pdf');
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('Laporan Riwayat Pesanan', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Table
        const table = {
            title: "Daftar Transaksi",
            subtitle: `Total Transaksi: ${orders.length}`,
            headers: ["No", "Kode", "Waktu", "Status", "Tipe", "Total"],
            rows: orders.map((o, index) => [
                index + 1,
                o.transactionCode || o.id,
                new Date(o.createdAt).toLocaleString('id-ID'),
                o.status,
                o.orderType || '-',
                `Rp ${o.totalAmount.toLocaleString('id-ID')}`
            ]),
        };

        await doc.table(table, {
            width: 500,
        });

        doc.end();

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Gagal membuat PDF');
    }
};

module.exports = {
    // ... existing exports
    exportOrdersPdf
};
