const admin = require('firebase-admin');

try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('🔴 [FIREBASE] FATAL: FIREBASE_SERVICE_ACCOUNT env variable is MISSING! FCM will NOT work.');
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ [FIREBASE] Firebase Admin initialized successfully. Apps:', admin.apps.length);
  }
} catch (error) {
  console.error('🔴 [FIREBASE] Firebase Admin initialization FAILED:', error.message);
  console.error('🔴 [FIREBASE] FCM notifications will NOT work until this is fixed!');
}

module.exports = admin;

