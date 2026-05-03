const { body, validationResult } = require('express-validator');
const User = require('../models/User');

// Validation middleware
exports.validate = (validations) => {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    // Format errors
    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg
    }));
    
    return res.status(400).json({
      success: false,
      errors: formattedErrors
    });
  };
};

// User registration validation
exports.registerValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
    .custom(async (email) => {
      const user = await User.findOne({ email });
      if (user) {
        throw new Error('Email already registered');
      }
      return true;
    }),
  
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  
  body('referralCode')
    .optional()
    .trim()
    .custom(async (code, { req }) => {
      if (code) {
        const referrer = await User.findOne({ referralCode: code });
        if (!referrer) {
          throw new Error('Invalid referral code');
        }
        if (referrer._id.toString() === req.body.userId) {
          throw new Error('Cannot use your own referral code');
        }
      }
      return true;
    })
];

// Login validation
exports.loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Server creation validation
exports.serverValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Server name is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('Server name must be between 3 and 50 characters'),
  
  body('environment.SESSION_ID')
    .notEmpty()
    .withMessage('SESSION_ID is required')
    .matches(/^INCONNU~XD~/)
    .withMessage('Invalid SESSION_ID format. Must start with INCONNU~XD~'),
  
  body('environment.OWNER_NUMBER')
    .notEmpty()
    .withMessage('OWNER_NUMBER is required')
    .matches(/^\d+$/)
    .withMessage('OWNER_NUMBER must contain only numbers'),
  
  body('environment.PREFIX')
    .optional()
    .isString()
    .withMessage('PREFIX must be a string'),
  
  body('environment.MODE')
    .optional()
    .isIn(['public', 'private'])
    .withMessage('MODE must be either "public" or "private"'),
  
  body('environment.AUTO_STATUS_SEEN')
    .optional()
    .isBoolean()
    .withMessage('AUTO_STATUS_SEEN must be a boolean'),
  
  body('environment.AUTO_BIO')
    .optional()
    .isBoolean()
    .withMessage('AUTO_BIO must be a boolean'),
  
  body('environment.AUTO_READ')
    .optional()
    .isBoolean()
    .withMessage('AUTO_READ must be a boolean'),
  
  body('environment.AUTO_RECORDING')
    .optional()
    .isBoolean()
    .withMessage('AUTO_RECORDING must be a boolean'),
  
  body('environment.AUTO_REACT')
    .optional()
    .isBoolean()
    .withMessage('AUTO_REACT must be a boolean'),
  
  body('environment.ANTILINK')
    .optional()
    .isBoolean()
    .withMessage('ANTILINK must be a boolean'),
  
  body('environment.REJECT_CALL')
    .optional()
    .isBoolean()
    .withMessage('REJECT_CALL must be a boolean'),
  
  body('environment.WELCOME')
    .optional()
    .isBoolean()
    .withMessage('WELCOME must be a boolean')
];

// Email validation
exports.emailValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
];

// Password reset validation
exports.resetPasswordValidation = [
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];

// Admin add coins validation
exports.addCoinsValidation = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID'),
  
  body('amount')
    .isInt({ min: 1 })
    .withMessage('Amount must be a positive integer'),
  
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string')
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

// Environment variable sanitization
exports.sanitizeEnvVars = (env) => {
  const sanitized = {};
  const allowedVars = [
    'SESSION_ID', 'PREFIX', 'OWNER_NUMBER', 'SUDO_NUMBER', 'OWNER_NAME',
    'AUTO_STATUS_SEEN', 'AUTO_BIO', 'AUTO_STATUS_REACT', 'AUTO_READ',
    'AUTO_RECORDING', 'AUTO_REACT', 'STATUS_READ_MSG', 'ANTILINK',
    'REJECT_CALL', 'NOT_ALLOW', 'MODE', 'WELCOME'
  ];
  
  allowedVars.forEach(key => {
    if (env[key] !== undefined) {
      sanitized[key] = env[key];
    }
  });
  
  return sanitized;
};

// Check if user has enough coins
exports.hasEnoughCoins = (user, requiredCoins) => {
  return user.coins >= requiredCoins;
};

// Generate referral link
exports.generateReferralLink = (referralCode) => {
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  return `${baseUrl}/register?ref=${referralCode}`;
};
