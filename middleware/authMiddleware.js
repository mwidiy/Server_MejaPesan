const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'Akses ditolak. Token tidak ditemukan.' });
    }

    try {
        const secret = process.env.JWT_SECRET || 'rahasia_negara_api'; // Fallback for dev
        const decoded = jwt.verify(token, secret);

        req.user = decoded; // { id, email, role, storeId }

        // Convenience: Direct access to storeId
        req.storeId = decoded.storeId;

        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token tidak valid or expired.' });
    }
};

// Helper for Controller: Get Store ID from Token (Admin) OR Query (Public)
const identifyStore = (req) => {
    // 1. Priority: Query Param (Public PWA)
    if (req.query.storeId) {
        return parseInt(req.query.storeId);
    }

    // 2. Fallback: Bearer Token (Admin Android / Protected Routes)
    const token = req.header('Authorization')?.split(' ')[1];
    if (token) {
        try {
            const secret = process.env.JWT_SECRET || 'rahasia_negara_api';
            const decoded = jwt.verify(token, secret);
            return decoded.storeId;
        } catch (e) {
            return null;
        }
    }

    // 3. Last Resort: req.storeId (if verifyToken middleware ran)
    return req.storeId || null;
};

module.exports = { verifyToken, identifyStore };
