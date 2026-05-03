const jwt = require('jsonwebtoken');
const User = require('../models/User');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/auth.log' })
  ]
});

// Protect routes - user must be authenticated
exports.protect = async (req, res, next) => {
  let token;
  
  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Check for token in cookies
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  
  // Make sure token exists
  if (!token) {
    logger.warn('Authentication failed - No token provided', {
      ip: req.ip,
      path: req.path
    });
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route. Please login.'
    });
  }
  
  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    req.user = await User.findById(decoded.id).select('-password');
    
    if (!req.user) {
      logger.warn('Authentication failed - User not found', {
        userId: decoded.id,
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Check if email is verified
    if (!req.user.emailVerified && req.path !== '/api/auth/verify-email') {
      logger.warn('Authentication failed - Email not verified', {
        userId: req.user._id,
        email: req.user.email
      });
      return res.status(403).json({
        success: false,
        error: 'Please verify your email address first'
      });
    }
    
    // Update last login
    req.user.lastLogin = new Date();
    await req.user.save();
    
    logger.info('Authentication successful', {
      userId: req.user._id,
      email: req.user.email,
      isAdmin: req.user.isAdmin
    });
    
    next();
  } catch (error) {
    logger.error('Authentication error', {
      error: error.message,
      token: token.substring(0, 20) + '...',
      ip: req.ip
    });
    
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role) && !req.user.isAdmin) {
      logger.warn('Authorization failed - Insufficient permissions', {
        userId: req.user._id,
        requiredRoles: roles,
        userRole: req.user.role,
        isAdmin: req.user.isAdmin
      });
      return res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

// Check if user is admin
exports.isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    logger.warn('Admin access denied', {
      userId: req.user._id,
      email: req.user.email,
      ip: req.ip
    });
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};
