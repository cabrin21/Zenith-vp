const User = require('../models/User');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/admin.log' })
  ]
});

// Middleware to check if user is admin
exports.requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    // Check if user is admin
    if (!req.user.isAdmin) {
      logger.warn('Admin access attempted by non-admin user', {
        userId: req.user._id,
        email: req.user.email,
        ip: req.ip,
        endpoint: req.originalUrl
      });
      
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }
    
    logger.info('Admin access granted', {
      userId: req.user._id,
      email: req.user.email,
      endpoint: req.originalUrl
    });
    
    next();
  } catch (error) {
    logger.error('Admin middleware error', {
      error: error.message,
      userId: req.user?._id,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error in admin verification'
    });
  }
};

// Middleware to validate admin actions
exports.validateAdminAction = (action) => {
  return (req, res, next) => {
    const validActions = [
      'add_coins',
      'remove_coins',
      'create_server',
      'delete_server',
      'view_users',
      'edit_user',
      'view_logs',
      'system_restart'
    ];
    
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid admin action'
      });
    }
    
    req.adminAction = action;
    next();
  };
};
        
