const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const winston = require('winston');
const Server = require('../models/Server');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bot-launcher.log' })
  ]
});

class BotLauncher {
  constructor(serverId) {
    this.serverId = serverId;
    this.botProcess = null;
    this.basePath = process.env.BOT_BASE_PATH || path.join(__dirname, '../../bots');
    this.serverPath = path.join(this.basePath, serverId);
  }
  
  // Create server directory
  async createServerDirectory() {
    try {
      await fs.mkdir(this.serverPath, { recursive: true });
      logger.info(`Created server directory: ${this.serverPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create server directory: ${error.message}`);
      return false;
    }
  }
  
  // Download bot files from GitHub
  async downloadBotFiles() {
    try {
      const zipUrl = process.env.BOT_ZIP_URL || 'your bot zip';
      logger.info(`Downloading bot files from: ${zipUrl}`);
      
      const response = await axios({
        method: 'GET',
        url: zipUrl,
        responseType: 'arraybuffer'
      });
      
      const zipPath = path.join(this.serverPath, 'bot.zip');
      await fs.writeFile(zipPath, response.data);
      
      // Extract zip file
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(this.serverPath, true);
      
      // Find and rename extracted folder
      const files = await fs.readdir(this.serverPath);
      const extractedFolder = files.find(file => file.startsWith('N-') || file === 'N');
      
      if (extractedFolder) {
        const oldPath = path.join(this.serverPath, extractedFolder);
        const newPath = path.join(this.serverPath, 'bot');
        
        // Move all files to bot directory
        const extractedFiles = await fs.readdir(oldPath);
        for (const file of extractedFiles) {
          const source = path.join(oldPath, file);
          const dest = path.join(newPath, file);
          await fs.rename(source, dest);
        }
        
        // Remove old directory
        await fs.rmdir(oldPath);
      }
      
      // Remove zip file
      await fs.unlink(zipPath);
      
      logger.info('Bot files downloaded and extracted successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to download bot files: ${error.message}`);
      return false;
    }
  }
  
  // Create .env file with environment variables
  async createEnvFile(environment) {
    try {
      const envContent = Object.entries(environment)
        .map(([key, value]) => `${key}=${typeof value === 'boolean' ? value : `"${value}"`}`)
        .join('\n');
      
      const envPath = path.join(this.serverPath, 'bot', '.env');
      await fs.writeFile(envPath, envContent);
      
      logger.info('.env file created successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to create .env file: ${error.message}`);
      return false;
    }
  }
  
  // Create package.json if missing
  async createPackageJson() {
    try {
      const packageJsonPath = path.join(this.serverPath, 'bot', 'package.json');
      
      // Check if package.json exists
      try {
        await fs.access(packageJsonPath);
        logger.info('package.json already exists');
        return true;
      } catch {
        // Create default package.json
        const packageJson = {
          name: `inconnu-xd-${this.serverId}`,
          version: "1.0.0",
          main: "index.js",
          type: "module",
          scripts: {
            start: "node index.js",
            dev: "nodemon index.js"
          },
          dependencies: {
            "@whiskeysockets/baileys": "^6.5.0",
            "express": "^4.18.2",
            "pino": "^8.15.0",
            "node-cache": "^5.1.2",
            "chalk": "^4.1.2",
            "axios": "^1.5.0",
            "dotenv": "^16.3.1",
            "megajs": "^1.0.0"
          }
        };
        
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        logger.info('package.json created successfully');
        return true;
      }
    } catch (error) {
      logger.error(`Failed to create package.json: ${error.message}`);
      return false;
    }
  }
  
  // Install dependencies
  async installDependencies() {
    return new Promise((resolve, reject) => {
      logger.info('Installing dependencies...');
      
      const npmProcess = spawn('npm', ['install'], {
        cwd: path.join(this.serverPath, 'bot'),
        stdio: 'pipe',
        shell: true
      });
      
      let output = '';
      let errorOutput = '';
      
      npmProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      npmProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      npmProcess.on('close', (code) => {
        if (code === 0) {
          logger.info('Dependencies installed successfully');
          resolve(true);
        } else {
          logger.error(`Failed to install dependencies. Code: ${code}, Error: ${errorOutput}`);
          reject(new Error(`npm install failed with code ${code}: ${errorOutput}`));
        }
      });
      
      npmProcess.on('error', (error) => {
        logger.error(`Failed to start npm process: ${error.message}`);
        reject(error);
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        npmProcess.kill();
        reject(new Error('Dependency installation timeout'));
      }, 5 * 60 * 1000);
    });
  }
  
  // Start the bot
  async startBot() {
    try {
      const server = await Server.findById(this.serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      // Update server status
      server.status = 'starting';
      server.lastStarted = new Date();
      await server.addLog('info', 'Starting bot process...');
      await server.save();
      
      // Start the bot process
      this.botProcess = spawn('node', ['index.js'], {
        cwd: path.join(this.serverPath, 'bot'),
        env: {
          ...process.env,
          ...server.environment,
          PORT: server.port || 3000
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Store process ID
      server.processId = this.botProcess.pid.toString();
      await server.save();
      
      // Handle process output
      this.botProcess.stdout.on('data', async (data) => {
        const output = data.toString().trim();
        logger.info(`Bot ${this.serverId} stdout: ${output}`);
        
        // Check for successful startup
        if (output.includes('INCONNU-XD is now online') || output.includes('✅')) {
          server.status = 'running';
          await server.addLog('success', 'Bot started successfully');
          await server.save();
        }
        
        // Add to server logs
        await server.addLog('info', output);
      });
      
      this.botProcess.stderr.on('data', async (data) => {
        const error = data.toString().trim();
        logger.error(`Bot ${this.serverId} stderr: ${error}`);
        await server.addLog('error', error);
      });
      
      // Handle process exit
      this.botProcess.on('close', async (code) => {
        logger.info(`Bot ${this.serverId} exited with code ${code}`);
        
        server.status = 'stopped';
        server.lastStopped = new Date();
        
        // Calculate uptime
        if (server.lastStarted) {
          const uptime = new Date() - server.lastStarted;
          server.totalUptime += uptime;
        }
        
        await server.addLog('info', `Bot process exited with code ${code}`);
        await server.save();
        
        this.botProcess = null;
      });
      
      this.botProcess.on('error', async (error) => {
        logger.error(`Bot ${this.serverId} process error: ${error.message}`);
        
        server.status = 'error';
        await server.addLog('error', `Process error: ${error.message}`);
        await server.save();
      });
      
      // Wait for bot to start (timeout after 30 seconds)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Bot startup timeout'));
        }, 30000);
        
        // Check every second if bot is running
        const interval = setInterval(async () => {
          if (server.status === 'running') {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 1000);
      });
      
      logger.info(`Bot ${this.serverId} started successfully`);
      return { success: true, processId: this.botProcess.pid };
    } catch (error) {
      logger.error(`Failed to start bot ${this.serverId}: ${error.message}`);
      
      // Update server status
      const server = await Server.findById(this.serverId);
      if (server) {
        server.status = 'error';
        await server.addLog('error', `Startup failed: ${error.message}`);
        await server.save();
      }
      
      return { success: false, error: error.message };
    }
  }
  
  // Stop the bot
  async stopBot() {
    try {
      const server = await Server.findById(this.serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      server.status = 'stopping';
      await server.addLog('info', 'Stopping bot process...');
      await server.save();
      
      if (this.botProcess) {
        // Gracefully stop the process
        this.botProcess.kill('SIGTERM');
        
        // Wait for process to exit
        await new Promise((resolve) => {
          setTimeout(resolve, 5000);
        });
        
        // Force kill if still running
        if (!this.botProcess.killed) {
          this.botProcess.kill('SIGKILL');
        }
        
        this.botProcess = null;
      }
      
      server.status = 'stopped';
      server.lastStopped = new Date();
      
      // Calculate uptime
      if (server.lastStarted) {
        const uptime = new Date() - server.lastStarted;
        server.totalUptime += uptime;
      }
      
      await server.addLog('info', 'Bot stopped successfully');
      await server.save();
      
      logger.info(`Bot ${this.serverId} stopped successfully`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to stop bot ${this.serverId}: ${error.message}`);
      
      // Update server status
      const server = await Server.findById(this.serverId);
      if (server) {
        server.status = 'error';
        await server.addLog('error', `Stop failed: ${error.message}`);
        await server.save();
      }
      
      return { success: false, error: error.message };
    }
  }
  
  // Restart the bot
  async restartBot() {
    try {
      await this.stopBot();
      // Wait a bit before starting again
      await new Promise(resolve => setTimeout(resolve, 2000));
      return await this.startBot();
    } catch (error) {
      logger.error(`Failed to restart bot ${this.serverId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // Get bot status
  async getBotStatus() {
    try {
      const server = await Server.findById(this.serverId);
      if (!server) {
        throw new Error('Server not found');
      }
      
      const isRunning = this.botProcess && !this.botProcess.killed;
      
      return {
        success: true,
        status: server.status,
        isRunning,
        processId: server.processId,
        lastStarted: server.lastStarted,
        lastStopped: server.lastStopped,
        totalUptime: server.totalUptime,
        logs: server.logs.slice(-50) // Last 50 logs
      };
    } catch (error) {
      logger.error(`Failed to get bot status ${this.serverId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // Get real-time logs
  async getRealtimeLogs(socket) {
    if (!this.botProcess) {
      return;
    }
    
    this.botProcess.stdout.on('data', (data) => {
      socket.emit('log', {
        serverId: this.serverId,
        type: 'stdout',
        message: data.toString().trim(),
        timestamp: new Date()
      });
    });
    
    this.botProcess.stderr.on('data', (data) => {
      socket.emit('log', {
        serverId: this.serverId,
        type: 'stderr',
        message: data.toString().trim(),
        timestamp: new Date()
      });
    });
  }
  
  // Clean up server files
  async cleanup() {
    try {
      if (this.botProcess) {
        await this.stopBot();
      }
      
      // Remove server directory
      await fs.rm(this.serverPath, { recursive: true, force: true });
      
      logger.info(`Cleaned up server directory: ${this.serverPath}`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to cleanup server ${this.serverId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = BotLauncher;
  
