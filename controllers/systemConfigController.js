const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get the global gateway setting
exports.getGlobalGateway = async (req, res) => {
    try {
        let config = await prisma.systemConfig.findUnique({
            where: { key: 'GLOBAL_PAYMENT_GATEWAY' }
        });

        if (!config) {
            // Default to 'homemade' if not explicitly configured yet
            config = await prisma.systemConfig.create({
                data: {
                    key: 'GLOBAL_PAYMENT_GATEWAY',
                    value: 'homemade'
                }
            });
        }

        res.json({ success: true, gateway: config.value });
    } catch (error) {
        console.error("Error getting global gateway:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// Update the global gateway setting (Protected for Super Admin)
exports.setGlobalGateway = async (req, res) => {
    const { passkey, gateway } = req.body;

    // Simple super admin protection using env variable
    if (passkey !== process.env.SUPER_ADMIN_PASSKEY) {
        return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    if (!['homemade', 'midtrans'].includes(gateway)) {
        return res.status(400).json({ success: false, message: "Invalid gateway value" });
    }

    try {
        const config = await prisma.systemConfig.upsert({
            where: { key: 'GLOBAL_PAYMENT_GATEWAY' },
            update: { value: gateway },
            create: { key: 'GLOBAL_PAYMENT_GATEWAY', value: gateway }
        });

        res.json({ success: true, gateway: config.value, message: "Global Gateway updated successfully!" });
    } catch (error) {
        console.error("Error setting global gateway:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
