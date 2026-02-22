const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// NOTE: CLIENT_ID must match what is used on Android
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "526373562764-kfrduc1arsle2i491kj2idp3pf78ii9e.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

const googleLogin = async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ message: "ID Token required" });
    }

    try {
        // 1. Verify Google Token
        // In dev/test without real ID token, we might skip verification or mock it.
        // For production, always verify.
        let payload;
        try {
            const ticket = await client.verifyIdToken({
                idToken,
                audience: CLIENT_ID,
            });
            payload = ticket.getPayload();
        } catch (e) {
            console.error("Google verify error:", e);
            // Fallback for emulator/testing if needed, or return error
            return res.status(401).json({ message: "Invalid Google Token" });
        }

        const { sub: googleId, email, name, picture } = payload;

        // 2. Find or Create User
        let user = await prisma.user.findUnique({
            where: { email },
            include: { store: true }
        });

        if (!user) {
            // New User -> Create User + New Store
            user = await prisma.user.create({
                data: {
                    email,
                    name,
                    googleId,
                    role: 'owner', // Default role
                    store: {
                        create: {
                            name: `${name}'s Store`, // Default store name
                            logo: picture
                        }
                    }
                },
                include: { store: true }
            });
        } else if (!user.store) {
            // EXISTING USER BUT NO STORE (ZOMBIE USER FIX) 🧟‍♂️ -> 🦸‍♂️
            console.log(`⚠️ User ${email} found but has no Store. Creating default store...`);
            const newStore = await prisma.store.create({
                data: {
                    name: `${user.name}'s Store`,
                    ownerId: user.id,
                    logo: picture
                }
            });
            // Refresh user object to include the new store
            user = await prisma.user.findUnique({
                where: { id: user.id },
                include: { store: true }
            });
        }

        // 3. Generate JWT
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                storeId: user.store?.id
            },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                store: user.store
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: `Login Failed: ${error.message}` });
    }
};

module.exports = { googleLogin };
