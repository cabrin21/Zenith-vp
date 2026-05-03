const User = require('../models/User');
const Transaction = require('../models/Transaction');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/coins.log' })
  ]
});

// Add coins to user
exports.addCoins = async (userId, amount, type, description, reference = null) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const oldCoins = user.coins;
    user.coins += amount;
    await user.save();
    
    // Create transaction record
    const transaction = await Transaction.create({
      userId,
      type,
      amount,
      description,
      reference: reference || uuidv4(),
      status: 'completed'
    });
    
    logger.info('Coins added successfully', {
      userId,
      oldCoins,
      newCoins: user.coins,
      amount,
      type,
      transactionId: transaction._id
    });
    
    return {
      success: true,
      oldCoins,
      newCoins: user.coins,
      transactionId: transaction._id
    };
  } catch (error) {
    logger.error('Failed to add coins', {
      userId,
      amount,
      type,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Deduct coins from user
exports.deductCoins = async (userId, amount, type, description, reference = null) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    if (user.coins < amount) {
      throw new Error('Insufficient coins');
    }
    
    const oldCoins = user.coins;
    user.coins -= amount;
    await user.save();
    
    // Create transaction record (negative amount for deduction)
    const transaction = await Transaction.create({
      userId,
      type,
      amount: -amount,
      description,
      reference: reference || uuidv4(),
      status: 'completed'
    });
    
    logger.info('Coins deducted successfully', {
      userId,
      oldCoins,
      newCoins: user.coins,
      amount,
      type,
      transactionId: transaction._id
    });
    
    return {
      success: true,
      oldCoins,
      newCoins: user.coins,
      transactionId: transaction._id
    };
  } catch (error) {
    logger.error('Failed to deduct coins', {
      userId,
      amount,
      type,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Handle referral bonus
exports.handleReferralBonus = async (newUserId, referralCode) => {
  try {
    if (!referralCode) {
      return { success: true, message: 'No referral code provided' };
    }
    
    // Find referrer
    const referrer = await User.findOne({ referralCode });
    if (!referrer) {
      return { success: false, error: 'Invalid referral code' };
    }
    
    // Check if new user is not the same as referrer
    if (referrer._id.toString() === newUserId.toString()) {
      return { success: false, error: 'Cannot refer yourself' };
    }
    
    const referralBonus = parseInt(process.env.REFERRAL_COINS) || 1;
    
    // Add coins to referrer
    const result = await this.addCoins(
      referrer._id,
      referralBonus,
      'referral',
      `Referral bonus for user ${newUserId}`,
      `referral-${newUserId}-${Date.now()}`
    );
    
    if (result.success) {
      // Add new user to referrer's referrals list
      referrer.referrals.push(newUserId);
      await referrer.save();
      
      // Update new user's referredBy field
      await User.findByIdAndUpdate(newUserId, {
        referredBy: referrer._id
      });
      
      logger.info('Referral bonus processed successfully', {
        referrerId: referrer._id,
        newUserId,
        bonusAmount: referralBonus
      });
    }
    
    return result;
  } catch (error) {
    logger.error('Failed to process referral bonus', {
      newUserId,
      referralCode,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Get user's transaction history
exports.getTransactionHistory = async (userId, page = 1, limit = 20) => {
  try {
    const skip = (page - 1) * limit;
    
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('relatedUser', 'name email')
      .populate('relatedServer', 'name');
    
    const total = await Transaction.countDocuments({ userId });
    
    return {
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    logger.error('Failed to get transaction history', {
      userId,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Get coins leaderboard
exports.getCoinsLeaderboard = async (limit = 10) => {
  try {
    const leaderboard = await User.find({ emailVerified: true })
      .select('name email coins referralCode servers createdAt')
      .sort({ coins: -1 })
      .limit(limit);
    
    return {
      success: true,
      leaderboard,
      timestamp: new Date()
    };
  } catch (error) {
    logger.error('Failed to get leaderboard', {
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Check if user can create server (has enough coins)
exports.canCreateServer = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    const serverCost = parseInt(process.env.SERVER_CREATION_COINS) || 10;
    const canCreate = user.coins >= serverCost;
    
    return {
      success: true,
      canCreate,
      userCoins: user.coins,
      requiredCoins: serverCost,
      difference: user.coins - serverCost
    };
  } catch (error) {
    logger.error('Failed to check server creation eligibility', {
      userId,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Get system statistics
exports.getSystemStats = async () => {
  try {
    const totalUsers = await User.countDocuments({ emailVerified: true });
    const totalServers = await require('../models/Server').countDocuments();
    const totalCoins = await User.aggregate([
      { $match: { emailVerified: true } },
      { $group: { _id: null, total: { $sum: '$coins' } } }
    ]);
    
    const totalTransactions = await Transaction.countDocuments();
    const recentTransactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'name email');
    
    return {
      success: true,
      stats: {
        totalUsers,
        totalServers,
        totalCoins: totalCoins[0]?.total || 0,
        totalTransactions,
        serverCreationCost: parseInt(process.env.SERVER_CREATION_COINS) || 10,
        referralBonus: parseInt(process.env.REFERRAL_COINS) || 1
      },
      recentTransactions
    };
  } catch (error) {
    logger.error('Failed to get system stats', {
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
};
  
