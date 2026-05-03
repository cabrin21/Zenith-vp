const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { validate } = require('../utils/validation');
const { addCoinsValidation } = require('../utils/validation');

// All admin routes require authentication and admin privileges
router.use(protect, requireAdmin);

// User management
router.get('/users', adminController.getAllUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Coins management
router.post('/coins/add', validate(addCoinsValidation), adminController.addCoins);
router.post('/coins/remove', validate(addCoinsValidation), adminController.removeCoins);

// Server management
router.get('/servers', adminController.getAllServers);
router.get('/servers/:id', adminController.getServer);
router.post('/servers/:id/action', adminController.serverAction);

// System management
router.get('/stats', adminController.getSystemStats);
router.get('/transactions', adminController.getAllTransactions);
router.get('/logs', adminController.getSystemLogs);

// Maintenance
router.post('/maintenance/cleanup', adminController.cleanupSystem);
router.post('/maintenance/restart', adminController.restartSystem);

module.exports = router;
