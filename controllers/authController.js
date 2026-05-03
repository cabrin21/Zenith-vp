const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { handleReferralBonus } = require('../utils/coins');
const { generateReferralLink } = require('../utils/validation');
const winston = require('winston');
const jwt = require('jsonwebtoken');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/auth-controller.log' })
  ]
});

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { email, password, name, phone, referralCode } = req.body;
    
    logger.info('Registration attempt', { email, name, referralCode });
    
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }
    
    // Create user
    const user = await User.create({
      email,
      password,
      name,
      phone,
      referredBy: null
    });
    
    // Generate verification token
    const verificationToken = user.generateVerificationToken();
    await user.save();
    
    // Send verification email
    const verificationUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${verificationToken}`;
    await sendVerificationEmail(user, verificationUrl);
    
    // Handle referral bonus if referral code provided
    if (referralCode) {
      try {
        await handleReferralBonus(user._id, referralCode);
        logger.info('Referral bonus processed', {
          newUserId: user._id,
          referralCode
        });
      } catch (referralError) {
        logger.warn('Referral bonus failed', {
          error: referralError.message,
          userId: user._id,
          referralCode
        });
        // Don't fail registration if referral fails
      }
    }
    
    // Create token
    const token = user.getSignedJwtToken();
    
    logger.info('User registered successfully', {
      userId: user._id,
      email: user.email
    });
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        coins: user.coins,
        emailVerified: user.emailVerified,
        referralCode: user.referralCode
      },
      message: 'Registration successful. Please check your email for verification.'
    });
  } catch (error) {
    logger.error('Registration failed', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during registration'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    logger.info('Login attempt', { email });
    
    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
    }
    
    // Check for user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      logger.warn('Login failed - user not found', { email });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Check if password matches
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      logger.warn('Login failed - incorrect password', { email });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Check if email is verified
    if (!user.emailVerified) {
      logger.warn('Login failed - email not verified', { email });
      return res.status(403).json({
        success: false,
        error: 'Please verify your email address first'
      });
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Create token
    const token = user.getSignedJwtToken();
    
    logger.info('Login successful', {
      userId: user._id,
      email: user.email
    });
    
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        coins: user.coins,
        isAdmin: user.isAdmin,
        referralCode: user.referralCode
      }
    });
  } catch (error) {
    logger.error('Login failed', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error during login'
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('servers', 'name status port createdAt');
    
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Get profile failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    
    const user = await User.findById(req.user.id);
    
    if (name) user.name = name;
    if (phone) user.phone = phone;
    
    await user.save();
    
    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        coins: user.coins
      }
    });
  } catch (error) {
    logger.error('Update profile failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.redirect(`${process.env.CLIENT_URL}/verify-email?error=Invalid token`);
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findOne({
      _id: decoded.id,
      verificationToken: token,
      verificationTokenExpire: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.redirect(`${process.env.CLIENT_URL}/verify-email?error=Invalid or expired verification token`);
    }
    
    // Update user
    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    await user.save();
    
    logger.info('Email verified successfully', {
      userId: user._id,
      email: user.email
    });
    
    // Redirect to success page
    return res.redirect(`${process.env.CLIENT_URL}/verify-email?success=true`);
  } catch (error) {
    logger.error('Email verification failed', {
      error: error.message,
      token: req.params.token
    });
    
    return res.redirect(`${process.env.CLIENT_URL}/verify-email?error=Verification failed`);
  }
};

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Public
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: 'Email already verified'
      });
    }
    
    // Generate new verification token
    const verificationToken = user.generateVerificationToken();
    await user.save();
    
    // Send verification email
    const verificationUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${verificationToken}`;
    await sendVerificationEmail(user, verificationUrl);
    
    logger.info('Verification email resent', {
      userId: user._id,
      email: user.email
    });
    
    res.status(200).json({
      success: true,
      message: 'Verification email sent'
    });
  } catch (error) {
    logger.error('Resend verification failed', {
      error: error.message,
      email: req.body.email
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await User.findOne({ email });
    
    if (!user) {
      // Don't reveal if user exists for security
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link'
      });
    }
    
    // Get reset token
    const resetToken = user.getResetPasswordToken();
    await user.save();
    
    // Create reset URL
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    
    // Send email
    await sendPasswordResetEmail(user, resetUrl);
    
    logger.info('Password reset email sent', {
      userId: user._id,
      email: user.email
    });
    
    res.status(200).json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    logger.error('Forgot password failed', {
      error: error.message,
      email: req.body.email
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findOne({
      _id: decoded.id,
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+password');
    
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token'
      });
    }
    
    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
    
    logger.info('Password reset successful', {
      userId: user._id,
      email: user.email
    });
    
    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    logger.error('Reset password failed', {
      error: error.message,
      token: req.params.token
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get user referrals
// @route   GET /api/auth/referrals
// @access  Private
exports.getReferrals = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('referrals', 'name email coins createdAt')
      .populate('referredBy', 'name email');
    
    const referralLink = generateReferralLink(user.referralCode);
    
    res.status(200).json({
      success: true,
      referralCode: user.referralCode,
      referralLink,
      referredBy: user.referredBy,
      referrals: user.referrals,
      totalReferrals: user.referrals.length
    });
  } catch (error) {
    logger.error('Get referrals failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};

// @desc    Get referral statistics
// @route   GET /api/auth/referral-stats
// @access  Private
exports.getReferralStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Get transaction history for referral bonuses
    const referralTransactions = await Transaction.find({
      userId: req.user.id,
      type: 'referral'
    }).sort({ createdAt: -1 });
    
    // Calculate total referral earnings
    const totalReferralEarnings = referralTransactions.reduce((sum, transaction) => {
      return sum + transaction.amount;
    }, 0);
    
    res.status(200).json({
      success: true,
      stats: {
        totalReferrals: user.referrals.length,
        totalEarned: totalReferralEarnings,
        referralBonus: parseInt(process.env.REFERRAL_COINS) || 1
      },
      recentReferrals: referralTransactions.slice(0, 10)
    });
  } catch (error) {
    logger.error('Get referral stats failed', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};
