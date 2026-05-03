const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/validation');
const { serverValidation } = require('../utils/validation');

// All server routes require authentication
router.use(protect);

// Server management
router.post('/create', validate(serverValidation), serverController.createServer);
router.get('/', serverController.getUserServers);
router.get('/:id', serverController.getServer);
router.put('/:id', serverController.updateServer);
router.delete('/:id', serverController.deleteServer);

// Server actions
router.post('/:id/start', serverController.startServer);
router.post('/:id/stop', serverController.stopServer);
router.post('/:id/restart', serverController.restartServer);

// Server monitoring
router.get('/:id/status', serverController.getServerStatus);
router.get('/:id/logs', serverController.getServerLogs);

// Session management
router.get('/session/generate', serverController.generateSession);
router.post('/session/validate', serverController.validateSession);

module.exports = router;
