const User = require('../models/User');
const Server = require('../models/Server');
const Transaction = require('../models/Transaction');
const serverManager = require('../services/serverManager');
const { addCoins, deductCoins, getSystemStats } = require('../utils/coins');
const { sendAdminNotification } = require('../utils/email');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/admin-controller.log' })
  ]
});

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { referralCode: { $regex: search, $options: 'i' } }
      ];
    }
    
    const users = await User.find(query)
      .select('-password')
      .populate('servers', 'name status')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await User.countDocuments(query);
    
    res.status(200).json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get all users failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get single user
// @route   GET /api/admin/users/:id
// @access  Private/Admin
exports.getUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id)
      .select('-password')
      .populate('servers')
      .populate('referrals', 'name email coins')
      .populate('referredBy', 'name email');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get user's transactions
    const transactions = await Transaction.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.status(200).json({
      success: true,
      user,
      transactions
    });
  } catch (error) {
    logger.error('Get user failed', {
      error: error.message,
      userId: req.params.id,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, coins, isAdmin, emailVerified } = req.body;
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Prevent modifying admin's own admin status
    if (id === req.user.id && isAdmin === false) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove your own admin privileges'
      });
    }
    
    // Update fields
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (coins !== undefined) user.coins = coins;
    if (isAdmin !== undefined) user.isAdmin = isAdmin;
    if (emailVerified !== undefined) user.emailVerified = emailVerified;
    
    await user.save();
    
    logger.info('User updated by admin', {
      adminId: req.user.id,
      userId: id,
      updates: req.body
    });
    
    // Send notification
    await sendAdminNotification(
      'User Updated',
      `Admin ${req.user.email} updated user ${user.email}`
    );
    
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Update user failed', {
      error: error.message,
      userId: req.params.id,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Delete user's servers first
    for (const serverId of user.servers) {
      await serverManager.deleteServer(serverId);
    }
    
    // Delete user
    await User.findByIdAndDelete(id);
    
    // Delete user's transactions
    await Transaction.deleteMany({ userId: id });
    
    logger.info('User deleted by admin', {
      adminId: req.user.id,
      userId: id,
      userEmail: user.email
    });
    
    // Send notification
    await sendAdminNotification(
      'User Deleted',
      `Admin ${req.user.email} deleted user ${user.email}`
    );
    
    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    logger.error('Delete user failed', {
      error: error.message,
      userId: req.params.id,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Add coins to user
// @route   POST /api/admin/coins/add
// @access  Private/Admin
exports.addCoins = async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const result = await addCoins(
      userId,
      amount,
      'admin_added',
      description || `Admin ${req.user.email} added coins`,
      `admin-add-${Date.now()}`
    );
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    logger.info('Coins added by admin', {
      adminId: req.user.id,
      userId,
      amount,
      description
    });
    
    // Send notification
    await sendAdminNotification(
      'Coins Added',
      `Admin ${req.user.email} added ${amount} coins to ${user.email}`
    );
    
    res.status(200).json({
      success: true,
      oldCoins: result.oldCoins,
      newCoins: result.newCoins,
      transactionId: result.transactionId
    });
  } catch (error) {
    logger.error('Add coins failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Remove coins from user
// @route   POST /api/admin/coins/remove
// @access  Private/Admin
exports.removeCoins = async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const result = await deductCoins(
      userId,
      amount,
      'admin_removed',
      description || `Admin ${req.user.email} removed coins`,
      `admin-remove-${Date.now()}`
    );
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    logger.info('Coins removed by admin', {
      adminId: req.user.id,
      userId,
      amount,
      description
    });
    
    // Send notification
    await sendAdminNotification(
      'Coins Removed',
      `Admin ${req.user.email} removed ${amount} coins from ${user.email}`
    );
    
    res.status(200).json({
      success: true,
      oldCoins: result.oldCoins,
      newCoins: result.newCoins,
      transactionId: result.transactionId
    });
  } catch (error) {
    logger.error('Remove coins failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get all servers
// @route   GET /api/admin/servers
// @access  Private/Admin
exports.getAllServers = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = '' } = req.query;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }
    
    const servers = await Server.find(query)
      .populate('userId', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Server.countDocuments(query);
    
    // Get detailed status for each server
    const serversWithStatus = await Promise.all(
      servers.map(async (server) => {
        const status = await serverManager.getServerStatus(server._id);
        return {
          ...server.toObject(),
          detailedStatus: status.success ? status : null
        };
      })
    );
    
    res.status(200).json({
      success: true,
      servers: serversWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get all servers failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get single server (admin)
// @route   GET /api/admin/servers/:id
// @access  Private/Admin
exports.getServer = async (req, res) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findById(id)
      .populate('userId', 'name email coins');
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    const status = await serverManager.getServerStatus(id);
    const logs = await serverManager.getServerLogs(id, 100);
    
    res.status(200).json({
      success: true,
      server: {
        ...server.toObject(),
        detailedStatus: status.success ? status : null,
        logs: logs.success ? logs.logs : []
      }
    });
  } catch (error) {
    logger.error('Get server failed', {
      error: error.message,
      serverId: req.params.id,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Perform server action
// @route   POST /api/admin/servers/:id/action
// @access  Private/Admin
exports.serverAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    
    const server = await Server.findById(id);
    
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found'
      });
    }
    
    let result;
    
    switch (action) {
      case 'start':
        result = await serverManager.startServer(id);
        break;
      case 'stop':
        result = await serverManager.stopServer(id);
        break;
      case 'restart':
        result = await serverManager.restartServer(id);
        break;
      case 'delete':
        result = await serverManager.deleteServer(id);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action'
        });
    }
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
    logger.info('Server action performed by admin', {
      adminId: req.user.id,
      serverId: id,
      action,
      result: result
    });
    
    // Send notification for critical actions
    if (action === 'delete') {
      await sendAdminNotification(
        'Server Deleted',
        `Admin ${req.user.email} deleted server ${server.name} (${id})`
      );
    }
    
    res.status(200).json({
      success: true,
      action,
      result
    });
  } catch (error) {
    logger.error('Server action failed', {
      error: error.message,
      serverId: req.params.id,
      adminId: req.user.id,
      action: req.body.action
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get system statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getSystemStats = async (req, res) => {
  try {
    const stats = await getSystemStats();
    
    if (!stats.success) {
      return res.status(500).json({
        success: false,
        error: stats.error
      });
    }
    
    // Get active servers
    const activeServers = await serverManager.getActiveServers();
    
    res.status(200).json({
      success: true,
      stats: {
        ...stats.stats,
        activeServers: activeServers.length
      },
      recentTransactions: stats.recentTransactions,
      activeServersList: activeServers
    });
  } catch (error) {
    logger.error('Get system stats failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Private/Admin
exports.getAllTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 50, type = '' } = req.query;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = {};
    if (type) {
      query.type = type;
    }
    
    const transactions = await Transaction.find(query)
      .populate('userId', 'name email')
      .populate('relatedUser', 'name email')
      .populate('relatedServer', 'name')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Transaction.countDocuments(query);
    
    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Get all transactions failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get system logs
// @route   GET /api/admin/logs
// @access  Private/Admin
exports.getSystemLogs = async (req, res) => {
  try {
    const { logFile = 'combined', lines = 100 } = req.query;
    
    const logFiles = {
      combined: 'logs/combined.log',
      error: 'logs/error.log',
      auth: 'logs/auth.log',
      server: 'logs/server-controller.log',
      admin: 'logs/admin-controller.log',
      bot: 'logs/bot-launcher.log'
    };
    
    const filePath = logFiles[logFile] || 'logs/combined.log';
    
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Log file not found'
      });
    }
    
    // Read last N lines
    const content = await fs.readFile(filePath, 'utf-8');
    const linesArray = content.split('\n').filter(line => line.trim());
    const lastLines = linesArray.slice(-parseInt(lines));
    
    res.status(200).json({
      success: true,
      logFile,
      lines: parseInt(lines),
      totalLines: linesArray.length,
      logs: lastLines
    });
  } catch (error) {
    logger.error('Get system logs failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Cleanup system
// @route   POST /api/admin/maintenance/cleanup
// @access  Private/Admin
exports.cleanupSystem = async (req, res) => {
  try {
    // Clean up old bot files
    const botsPath = process.env.BOT_BASE_PATH || path.join(__dirname, '../../bots');
    
    try {
      const files = await fs.readdir(botsPath);
      for (const file of files) {
        const filePath = path.join(botsPath, file);
        const stat = await fs.stat(filePath);
        
        // Delete directories older than 7 days
        if (stat.isDirectory()) {
          const ageInDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
          if (ageInDays > 7) {
            await fs.rm(filePath, { recursive: true, force: true });
            logger.info(`Cleaned up old bot directory: ${file}`);
          }
        }
      }
    } catch (error) {
      // Directory might not exist
    }
    
    logger.info('System cleanup performed by admin', {
      adminId: req.user.id
    });
    
    // Send notification
    await sendAdminNotification(
      'System Cleanup',
      `Admin ${req.user.email} performed system cleanup`
    );
    
    res.status(200).json({
      success: true,
      message: 'System cleanup completed'
    });
  } catch (error) {
    logger.error('System cleanup failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Restart system
// @route   POST /api/admin/maintenance/restart
// @access  Private/Admin
exports.restartSystem = async (req, res) => {
  try {
    // Stop all running servers
    await serverManager.systemCleanup();
    
    logger.info('System restart initiated by admin', {
      adminId: req.user.id
    });
    
    // Send notification
    await sendAdminNotification(
      'System Restart',
      `Admin ${req.user.email} initiated system restart`
    );
    
    res.status(200).json({
      success: true,
      message: 'System restart initiated. Servers will need to be manually started.'
    });
  } catch (error) {
    logger.error('System restart failed', {
      error: error.message,
      adminId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};
