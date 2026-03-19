const admin = require('firebase-admin');

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin Initialized Successfully ✅');
    } else {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT is missing in environment variables. FCM functions will fail.');
    }
} catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error);
}

module.exports = admin;
