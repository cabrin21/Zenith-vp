const mongoose = require('mongoose');

const ServerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please provide a server name'],
    trim: true,
    maxlength: [50, 'Server name cannot exceed 50 characters']
  },
  status: {
    type: String,
    enum: ['stopped', 'running', 'starting', 'stopping', 'error'],
    default: 'stopped'
  },
  port: {
    type: Number,
    unique: true
  },
  processId: {
    type: String
  },
  environment: {
    SESSION_ID: {
      type: String,
      required: [true, 'SESSION_ID is required']
    },
    PREFIX: {
      type: String,
      default: '.'
    },
    OWNER_NUMBER: {
      type: String,
      required: [true, 'OWNER_NUMBER is required']
    },
    SUDO_NUMBER: {
      type: String,
      default: ''
    },
    OWNER_NAME: {
      type: String,
      default: 'INCONNU BOY'
    },
    AUTO_STATUS_SEEN: {
      type: Boolean,
      default: true
    },
    AUTO_BIO: {
      type: Boolean,
      default: true
    },
    AUTO_STATUS_REACT: {
      type: Boolean,
      default: true
    },
    AUTO_READ: {
      type: Boolean,
      default: false
    },
    AUTO_RECORDING: {
      type: Boolean,
      default: false
    },
    AUTO_REACT: {
      type: Boolean,
      default: false
    },
    STATUS_READ_MSG: {
      type: String,
      default: 'Status Viewed by inconnu xd v2 bot'
    },
    ANTILINK: {
      type: Boolean,
      default: false
    },
    REJECT_CALL: {
      type: Boolean,
      default: false
    },
    NOT_ALLOW: {
      type: Boolean,
      default: true
    },
    MODE: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },
    WELCOME: {
      type: Boolean,
      default: false
    }
  },
  logs: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    level: {
      type: String,
      enum: ['info', 'error', 'warning', 'success']
    },
    message: String
  }],
  lastStarted: Date,
  lastStopped: Date,
  totalUptime: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp before saving
ServerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Add log method
ServerSchema.methods.addLog = function(level, message) {
  this.logs.push({
    timestamp: new Date(),
    level,
    message
  });
  
  // Keep only last 100 logs
  if (this.logs.length > 100) {
    this.logs = this.logs.slice(-100);
  }
  
  return this.save();
};

module.exports = mongoose.model('Server', ServerSchema);
