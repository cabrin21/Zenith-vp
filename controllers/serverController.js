const Server = require('../models/Server');
const User = require('../models/User');
const serverManager = require('../services/serverManager');
const sessionManager = require('../services/sessionManager');
const { deductCoins } = require('../utils/coins');
const { sanitizeEnvVars } = require('../utils/validation');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/server-controller.log' })
  ]
});

// @desc    Create new server
// @route   POST /api/servers/create
// @access  Private
exports.createServer = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, environment } = req.body;
    
    logger.info('Server creation attempt', {
      userId,
      name,
      hasSession: !!environment?.SESSION_ID
    });
    
    // Check if user has enough coins
    const serverCost = parseInt(process.env.SERVER_CREATION_COINS) || 10;
    const user = await User.findById(userId);
    
    if (user.coins < serverCost) {
      logger.warn('Insufficient coins for server creation', {
        userId,
        userCoins: user.coins,
        requiredCoins: serverCost
      });
      
      return res.status(400).json({
        success: false,
        error: `Insufficient coins. You need ${serverCost} coins to create a server. You have ${user.coins} coins.`
      });
    }
    
    // Validate session ID
    if (!environment.SESSION_ID) {
      return res.status(400).json({
        success: false,
        error: 'SESSION_ID is required'
      });
    }
    
    const sessionMgr = new sessionManager();
    const sessionValidation = sessionMgr.validateSessionId(environment.SESSION_ID);
    
    if (!sessionValidation.valid) {
      return res.status(400).json({
        success: false,
        error: sessionValidation.error
      });
    }
    
    // Sanitize environment variables
    const sanitizedEnv = sanitizeEnvVars(environment);
    
    // Deduct coins for server creation
    const deductionResult = await deductCoins(
      userId,
      serverCost,
      'server_creation',
      `Created server: ${name}`,
      `server-create-${Date.now()}`
    );
    
    if (!deductionResult.success) {
      throw new Error(deductionResult.error);
    }
    
    // Create server
    const serverData = {
      name,
      environment: sanitizedEnv
    };
    
    const result = await serverManager.createServer(userId, serverData);
    
    if (!result.success) {
      // Refund coins if server creation failed
      await User.findByIdAndUpdate(userId, {
        $inc: { coins: serverCost }
      });
      
      logger.error('Server creation failed, coins refunded', {
        userId,
        serverName: name,
        error: result.error
      });
      
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Add server to user's servers list
    user.servers.push(result.server._id);
    await user.save();
    
    logger.info('Server created successfully', {
      userId,
      serverId: result.server._id,
      serverName: name,
      coinsDeducted: serverCost,
      remainingCoins: user.coins - serverCost
    });
    
    res.status(201).json({
      success: true,
      server: result.server,
      coinsDeducted: serverCost,
      remainingCoins: user.coins - serverCost,
      message: 'Server created successfully'
    });
  } catch (error) {
    logger.error('Server creation failed', {
      error: error.message,
      stack: error.stack,
      userId: req.user.id,
      body: req.body
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during server creation'
    });
  }
};

// @desc    Get user's servers
// @route   GET /api/servers
// @access  Private
exports.getUserServers = async (req, res) => {
  try {
    const result = await serverManager.getUserServers(req.user.id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      servers: result.servers,
      count: result.servers.length
    });
  } catch (error) {
    logger.error('Get user servers failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get single server
// @route   GET /api/servers/:id
// @access  Private
exports.getServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this server'
      });
    }
    
    // Get detailed status
    const status = await serverManager.getServerStatus(id);
    
    res.status(200).json({
      success: true,
      server: {
        ...server.toObject(),
        detailedStatus: status.success ? status : null
      }
    });
  } catch (error) {
    logger.error('Get server failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Update server
// @route   PUT /api/servers/:id
// @access  Private
exports.updateServer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, environment } = req.body;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this server'
      });
    }
    
    // Can't update if server is running
    if (server.status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update server while it is running. Stop the server first.'
      });
    }
    
    // Update server
    if (name) server.name = name;
    if (environment) {
      const sanitizedEnv = sanitizeEnvVars(environment);
      server.environment = { ...server.environment, ...sanitizedEnv };
    }
    
    await server.save();
    
    logger.info('Server updated', {
      serverId: id,
      userId: req.user.id,
      updates: req.body
    });
    
    res.status(200).json({
      success: true,
      server
    });
  } catch (error) {
    logger.error('Update server failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Delete server
// @route   DELETE /api/servers/:id
// @access  Private
exports.deleteServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this server'
      });
    }
    
    // Delete server
    const result = await serverManager.deleteServer(id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Remove server from user's servers list
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { servers: id }
    });
    
    logger.info('Server deleted', {
      serverId: id,
      userId: req.user.id
    });
    
    res.status(200).json({
      success: true,
      message: 'Server deleted successfully'
    });
  } catch (error) {
    logger.error('Delete server failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Start server
// @route   POST /api/servers/:id/start
// @access  Private
exports.startServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to start this server'
      });
    }
    
    // Check if server is already running
    if (server.status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'Server is already running'
      });
    }
    
    // Start server
    const result = await serverManager.startServer(id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Get updated server info
    const updatedServer = await Server.findById(id);
    
    logger.info('Server started', {
      serverId: id,
      userId: req.user.id,
      processId: result.processId,
      port: result.port
    });
    
    res.status(200).json({
      success: true,
      message: 'Server started successfully',
      server: updatedServer,
      processId: result.processId,
      port: result.port
    });
  } catch (error) {
    logger.error('Start server failed', {
      error: error.message,
      stack: error.stack,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during startup'
    });
  }
};

// @desc    Stop server
// @route   POST /api/servers/:id/stop
// @access  Private
exports.stopServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to stop this server'
      });
    }
    
    // Check if server is already stopped
    if (server.status === 'stopped') {
      return res.status(400).json({
        success: false,
        error: 'Server is already stopped'
      });
    }
    
    // Stop server
    const result = await serverManager.stopServer(id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Get updated server info
    const updatedServer = await Server.findById(id);
    
    logger.info('Server stopped', {
      serverId: id,
      userId: req.user.id
    });
    
    res.status(200).json({
      success: true,
      message: 'Server stopped successfully',
      server: updatedServer
    });
  } catch (error) {
    logger.error('Stop server failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Restart server
// @route   POST /api/servers/:id/restart
// @access  Private
exports.restartServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to restart this server'
      });
    }
    
    // Restart server
    const result = await serverManager.restartServer(id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Get updated server info
    const updatedServer = await Server.findById(id);
    
    logger.info('Server restarted', {
      serverId: id,
      userId: req.user.id
    });
    
    res.status(200).json({
      success: true,
      message: 'Server restarted successfully',
      server: updatedServer
    });
  } catch (error) {
    logger.error('Restart server failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get server status
// @route   GET /api/servers/:id/status
// @access  Private
exports.getServerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this server'
      });
    }
    
    const result = await serverManager.getServerStatus(id);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      status: result
    });
  } catch (error) {
    logger.error('Get server status failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get server logs
// @route   GET /api/servers/:id/logs
// @access  Private
exports.getServerLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100 } = req.query;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    // Check if user owns the server
    if (server.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this server'
      });
    }
    
    const result = await serverManager.getServerLogs(id, parseInt(limit));
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      logs: result.logs,
      total: result.total
    });
  } catch (error) {
    logger.error('Get server logs failed', {
      error: error.message,
      serverId: req.params.id,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Generate new session
// @route   GET /api/servers/session/generate
// @access  Private
exports.generateSession = async (req, res) => {
  try {
    const sessionMgr = new sessionManager();
    const result = await sessionMgr.generateSession();
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    // Also get instructions
    const instructions = sessionMgr.getInstructions();
    
    res.status(200).json({
      success: true,
      session: result,
      instructions
    });
  } catch (error) {
    logger.error('Generate session failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during session generation'
    });
  }
};

// @desc    Validate session
// @route   POST /api/servers/session/validate
// @access  Private
exports.validateSession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }
    
    const sessionMgr = new sessionManager();
    const result = await sessionMgr.testSession(sessionId);
    
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    
    res.status(200).json({
      success: true,
      validation: result
    });
  } catch (error) {
    logger.error('Validate session failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during session validation'
    });
  }
};
