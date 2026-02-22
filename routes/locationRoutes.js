const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

const { verifyToken } = require('../middleware/authMiddleware');

// Define routes
router.get('/', verifyToken, locationController.getAllLocations);
router.post('/', verifyToken, locationController.createLocation);
router.put('/:id', verifyToken, locationController.updateLocation);
router.delete('/:id', verifyToken, locationController.deleteLocation);

module.exports = router;
