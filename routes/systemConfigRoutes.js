const express = require('express');
const router = express.Router();
const systemConfigController = require('../controllers/systemConfigController');

router.get('/gateway', systemConfigController.getGlobalGateway);
router.post('/gateway', systemConfigController.setGlobalGateway);

module.exports = router;
