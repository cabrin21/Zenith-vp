const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate } = require('../utils/validation');
const { 
  registerValidation, 
  loginValidation, 
  emailValidation,
  resetPasswordValidation 
} = require('../utils/validation');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/register', validate(registerValidation), authController.register);
router.post('/login', validate(loginValidation), authController.login);
router.post('/forgot-password', validate(emailValidation), authController.forgotPassword);
router.put('/reset-password/:token', validate(resetPasswordValidation), authController.resetPassword);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/resend-verification', validate(emailValidation), authController.resendVerification);

// Protected routes
router.get('/profile', protect, authController.getProfile);
router.put('/profile', protect, authController.updateProfile);
router.get('/referrals', protect, authController.getReferrals);
router.get('/referral-stats', protect, authController.getReferralStats);

module.exports = router;
