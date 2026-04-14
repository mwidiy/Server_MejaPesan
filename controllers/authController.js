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
                            name: (name?.split(' ')[0]?.substring(0, 4) || 'REST').toUpperCase(),
                            logo: picture
                        }
                    }
                },
                include: { store: true }
            });
        } else if (!user.store) {
            // EXISTING USER BUT NO STORE (ZOMBIE USER FIX) 🧟‍♂️ -> 🦸‍♂️
            console.log(`⚠️ User ${email} found but has no Store. Creating default store...`);
            const initials = (user.name?.split(' ')[0]?.substring(0, 4) || 'REST').toUpperCase();
            const newStore = await prisma.store.create({
                data: {
                    name: initials, 
                    ownerId: user.id,
                    logo: picture
                }
            });
            // Refresh user object to include the new store
            user = await prisma.user.findUnique({
                where: { id: user.id },
                include: { store: true }
            });
        } else {
            // EXISTING USER WITH STORE -> CHECK FOR DEFAULT CLEANUP
            const currentName = user.store.name;
            const googleName = user.name || "";
            
            // AGGRESSIVE DEFAULT DETECTION: Is it the user's name? Does it end in "Store"? Does it have "'s"?
            const isDefaultPattern = 
                currentName === googleName || 
                currentName.toLowerCase().endsWith("store") || 
                currentName.includes("'s") ||
                currentName.includes("'S");
            
            if (isDefaultPattern || currentName.length > 10) {
                // RESET TO 4-CHAR INITIALS if it looks like a default name, OR HARD-TRUNCATE if it's just long custom
                const newName = isDefaultPattern 
                    ? (googleName.split(' ')[0]?.substring(0, 4) || 'REST').toUpperCase()
                    : currentName.substring(0, 10);
                
                if (newName !== currentName) {
                    console.log(`🧹 Aggressive Auto-fix for ${email}: "${currentName}" -> "${newName}"`);
                    await prisma.store.update({
                        where: { id: user.store.id },
                        data: { name: newName }
                    });
                    user.store.name = newName;
                }
            }
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

const saveFcmToken = async (req, res) => {
    const { userId, fcmToken } = req.body;

    if (!userId || !fcmToken) {
        return res.status(400).json({ message: "userId and fcmToken are required" });
    }

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(userId) },
            data: { fcmToken }
        });

        console.log(`✅ [FCM TOKEN] Saved for user ${userId}: ${fcmToken.substring(0, 20)}...`);
        res.json({ success: true, message: "FCM Token saved successfully", fcmToken: user.fcmToken });
    } catch (error) {
        console.error("Save FCM Token Error:", error);
        res.status(500).json({ message: `Failed to save FCM Token: ${error.message}` });
    }
};

module.exports = { googleLogin, saveFcmToken };
