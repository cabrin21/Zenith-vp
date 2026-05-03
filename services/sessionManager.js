const axios = require('axios');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/session.log' })
  ]
});

class SessionManager {
  constructor() {
    this.sessionGeneratorUrl = process.env.SESSION_GENERATOR_URL || 'https://inconnu-tech-web-session-id.onrender.com/';
  }
  
  // Generate new session
  async generateSession() {
    try {
      logger.info('Generating new session...');
      
      // Call the session generator website
      const response = await axios.get(this.sessionGeneratorUrl, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Session generator returned status ${response.status}`);
      }
      
      // Parse the response to extract session information
      // This will depend on the structure of the session generator website
      const sessionData = this.parseSessionResponse(response.data);
      
      if (!sessionData || !sessionData.sessionId) {
        throw new Error('Failed to extract session ID from generator');
      }
      
      logger.info('Session generated successfully');
      return {
        success: true,
        sessionId: sessionData.sessionId,
        qrCode: sessionData.qrCode,
        instructions: sessionData.instructions
      };
    } catch (error) {
      logger.error(`Failed to generate session: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Parse session generator response
  parseSessionResponse(html) {
    try {
      // This is a simplified parser - you'll need to adjust based on the actual website structure
      
      // Look for session ID in the HTML
      const sessionIdMatch = html.match(/SESSION_ID="([^"]+)"/) || 
                            html.match(/session_id[:=]\s*["']([^"']+)["']/i) ||
                            html.match(/(INCONNU~XD~[a-zA-Z0-9#]+)/);
      
      // Look for QR code image
      const qrCodeMatch = html.match(/src=["']([^"']*qr[^"']*\.(?:png|jpg|jpeg|gif|svg))["']/i) ||
                         html.match(/data:image\/[^;]+;base64,[^"']+/i);
      
      // Look for instructions
      const instructionMatch = html.match(/<div[^>]*class=["']instructions["'][^>]*>([\s\S]*?)<\/div>/i) ||
                              html.match(/<p[^>]*class=["']guide["'][^>]*>([\s\S]*?)<\/p>/i);
      
      return {
        sessionId: sessionIdMatch ? sessionIdMatch[1] : null,
        qrCode: qrCodeMatch ? qrCodeMatch[1] : null,
        instructions: instructionMatch ? this.cleanHtml(instructionMatch[1]) : 'Scan the QR code with WhatsApp to generate session.'
      };
    } catch (error) {
      logger.error(`Failed to parse session response: ${error.message}`);
      return null;
    }
  }
  
  // Clean HTML tags from text
  cleanHtml(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  // Validate session ID format
  validateSessionId(sessionId) {
    if (!sessionId) {
      return { valid: false, error: 'Session ID is required' };
    }
    
    // Check if it matches INCONNU~XD~ format
    if (!sessionId.startsWith('INCONNU~XD~')) {
      return { valid: false, error: 'Invalid session format. Must start with INCONNU~XD~' };
    }
    
    // Check if it has the required parts
    const parts = sessionId.split('INCONNU~XD~')[1];
    if (!parts || !parts.includes('#')) {
      return { valid: false, error: 'Invalid session format. Must contain file ID and decryption key separated by #' };
    }
    
    return { valid: true };
  }
  
  // Get session generator instructions
  getInstructions() {
    return {
      title: 'How to Get Session ID',
      steps: [
        'Visit the session generator website',
        'Click on "Generate Session" button',
        'Scan the QR code with WhatsApp',
        'Wait for the session to be generated',
        'Copy the SESSION_ID starting with INCONNU~XD~',
        'Paste it in your server configuration'
      ],
      note: 'Make sure to keep your session ID secure and never share it with anyone.',
      generatorUrl: this.sessionGeneratorUrl
    };
  }
  
  // Test session validity
  async testSession(sessionId) {
    try {
      const validation = this.validateSessionId(sessionId);
      if (!validation.valid) {
        return validation;
      }
      
      // Attempt to create a simple test with the session
      // This is a basic test - actual validation happens when bot starts
      logger.info(`Testing session ID: ${sessionId.substring(0, 20)}...`);
      
      return {
        valid: true,
        message: 'Session ID format is valid',
        format: 'INCONNU~XD~ format detected',
        length: sessionId.length
      };
    } catch (error) {
      logger.error(`Session test failed: ${error.message}`);
      return {
        valid: false,
        error: error.message
      };
    }
  }
}

module.exports = SessionManager;
