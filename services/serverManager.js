const net = require('net');
const winston = require('winston');
const Server = require('../models/Server');
const BotLauncher = require('./botLauncher');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/server-manager.log' })
  ]
});

class ServerManager {
  constructor() {
    this.activeServers = new Map(); // Map of serverId -> BotLauncher instance
    this.portPool = new Set();
    this.minPort = 3001;
    this.maxPort = 4000;
    this.initializePortPool();
  }
  
  // Initialize port pool
  initializePortPool() {
    for (let port = this.minPort; port <= this.maxPort; port++) {
      this.portPool.add(port);
    }
  }
  
  // Get available port
  async getAvailablePort() {
    for (const port of this.portPool) {
      if (await this.isPortAvailable(port)) {
        this.portPool.delete(port);
        return port;
      }
    }
    throw new Error('No available ports');
  }
  
  // Check if port is available
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(true);
        }
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port, '127.0.0.1');
    });
  }
  
  // Release port back to pool
  releasePort(port) {
    if (port >= this.minPort && port <= this.maxPort) {
      this.portPool.add(port);
    }
  }
  
  // Create new server
  async createServer(userId, serverData) {
    try {
      logger.info(`Creating new server for user ${userId}`);
      
      // Get available port
      const port = await this.getAvailablePort();
      
      // Create server in database
      const server = await Server.create({
        userId,
        name: serverData.name,
        port,
        environment: serverData.environment,
        status: 'stopped'
      });
      
      logger.info(`Server created: ${server._id} on port ${port}`);
      
      return {
        success: true,
        server,
        message: 'Server created successfully'
      };
    } catch (error) {
      logger.error(`Failed to create server: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Get server launcher instance
  getServerLauncher(serverId) {
    if (!this.activeServers.has(serverId)) {
      this.activeServers.set(serverId, new BotLauncher(serverId));
    }
    return this.activeServers.get(serverId);
  }
  
  // Start server
  async startServer(serverId) {
    try {
      const server = await Server.findById(serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      const launcher = this.getServerLauncher(serverId);
      
      // Setup server directory and files
      await launcher.createServerDirectory();
      await launcher.downloadBotFiles();
      await launcher.createEnvFile(server.environment);
      await launcher.createPackageJson();
      await launcher.installDependencies();
      
      // Start the bot
      const result = await launcher.startBot();
      
      if (result.success) {
        logger.info(`Server ${serverId} started successfully`);
        return {
          success: true,
          processId: result.processId,
          port: server.port
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      logger.error(`Failed to start server ${serverId}: ${error.message}`);
      
      // Clean up on failure
      await this.cleanupServer(serverId);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Stop server
  async stopServer(serverId) {
    try {
      const launcher = this.getServerLauncher(serverId);
      const result = await launcher.stopBot();
      
      if (result.success) {
        logger.info(`Server ${serverId} stopped successfully`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to stop server ${serverId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Restart server
  async restartServer(serverId) {
    try {
      const launcher = this.getServerLauncher(serverId);
      const result = await launcher.restartBot();
      
      if (result.success) {
        logger.info(`Server ${serverId} restarted successfully`);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to restart server ${serverId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Delete server
  async deleteServer(serverId) {
    try {
      const server = await Server.findById(serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      // Stop server if running
      if (server.status === 'running') {
        await this.stopServer(serverId);
      }
      
      // Clean up files
      const launcher = this.getServerLauncher(serverId);
      await launcher.cleanup();
      
      // Release port
      this.releasePort(server.port);
      
      // Remove from active servers
      this.activeServers.delete(serverId);
      
      // Delete from database
      await Server.findByIdAndDelete(serverId);
      
      logger.info(`Server ${serverId} deleted successfully`);
      
      return {
        success: true,
        message: 'Server deleted successfully'
      };
    } catch (error) {
      logger.error(`Failed to delete server ${serverId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Get server status
  async getServerStatus(serverId) {
    try {
      const launcher = this.getServerLauncher(serverId);
      return await launcher.getBotStatus();
    } catch (error) {
      logger.error(`Failed to get server status ${serverId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Get server logs
  async getServerLogs(serverId, limit = 100) {
    try {
      const server = await Server.findById(serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      return {
        success: true,
        logs: server.logs.slice(-limit),
        total: server.logs.length
      };
    } catch (error) {
      logger.error(`Failed to get server logs ${serverId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Cleanup server resources
  async cleanupServer(serverId) {
    try {
      const launcher = this.getServerLauncher(serverId);
      await launcher.cleanup();
      this.activeServers.delete(serverId);
      
      logger.info(`Cleaned up server ${serverId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to cleanup server ${serverId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // Get all user servers
  async getUserServers(userId) {
    try {
      const servers = await Server.find({ userId }).sort({ createdAt: -1 });
      
      // Get status for each server
      const serversWithStatus = await Promise.all(
        servers.map(async (server) => {
          const status = await this.getServerStatus(server._id);
          return {
            ...server.toObject(),
            detailedStatus: status
          };
        })
      );
      
      return {
        success: true,
        servers: serversWithStatus
      };
    } catch (error) {
      logger.error(`Failed to get user servers: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Get all active servers
  async getActiveServers() {
    const active = [];
    
    for (const [serverId, launcher] of this.activeServers.entries()) {
      const status = await launcher.getBotStatus();
      if (status.success && status.isRunning) {
        active.push({
          serverId,
          status: status.status,
          processId: status.processId
        });
      }
    }
    
    return active;
  }
  
  // System cleanup (called on shutdown)
  async systemCleanup() {
    logger.info('Performing system cleanup...');
    
    // Stop all running servers
    for (const [serverId, launcher] of this.activeServers.entries()) {
      try {
        await launcher.stopBot();
        logger.info(`Stopped server ${serverId} during cleanup`);
      } catch (error) {
        logger.error(`Failed to stop server ${serverId} during cleanup: ${error.message}`);
      }
    }
    
    // Clear active servers map
    this.activeServers.clear();
    
    logger.info('System cleanup completed');
  }
}

// Create singleton instance
const serverManager = new ServerManager();

// Handle process exit
process.on('SIGINT', async () => {
  await serverManager.systemCleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await serverManager.systemCleanup();
  process.exit(0);
});

module.exports = serverManager;
