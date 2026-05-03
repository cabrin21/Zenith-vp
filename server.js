const express = require('express');
const path = require("path");
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const winston = require('winston');
const socketio = require('socket.io');
const http = require('http');

// environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/server');
const adminRoutes = require('./routes/admin');

// Import middleware
const { errorHandler } = require('./middleware/error');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'https://inconnu-hosting-frontend.onrender.com',
    credentials: true
  }
});

// Winston logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Global error logging
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all requests
app.use(limiter);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());

// CORS configuration
const corsOptions = {
  origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : ['https://inconnu-hosting-frontend.onrender.com'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/admin', adminRoutes);


// Error handling middleware
app.use(errorHandler);

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('New client connected:', socket.id);
  
  socket.on('join-server', (serverId) => {
    socket.join(`server-${serverId}`);
    logger.info(`Client ${socket.id} joined server ${serverId}`);
  });
  
  socket.on('server-status', (data) => {
    io.to(`server-${data.serverId}`).emit('status-update', data);
  });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// Make io accessible to routes
app.set('socketio', io);

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
})
.then(() => {
  logger.info('MongoDB connected successfully');
  
  // Start server
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
  });
})
.catch((error) => {
  logger.error('MongoDB connection error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      logger.info('MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = { app, server, io };
