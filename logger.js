const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.logFile = path.join(this.logDir, 'bot.log');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      logMessage += ` ${JSON.stringify(data)}`;
    }
    
    return logMessage;
  }

  writeLog(level, message, data = null) {
    const formattedMessage = this.formatMessage(level, message, data);
    
    // Console output
    console.log(formattedMessage);
    
    // File output - async to not block
    if (level !== 'DEBUG') { // Skip debug logs in file for performance
      setImmediate(() => {
        try {
          fs.appendFileSync(this.logFile, formattedMessage + '\n');
        } catch (error) {
          console.error('Failed to write to log file:', error.message);
        }
      });
    }
  }

  info(message, data = null) {
    this.writeLog('INFO', message, data);
  }

  success(message, data = null) {
    this.writeLog('SUCCESS', message, data);
  }

  warning(message, data = null) {
    this.writeLog('WARNING', message, data);
  }

  error(message, data = null) {
    this.writeLog('ERROR', message, data);
  }

  debug(message, data = null) {
    if (process.env.DEBUG === 'true') {
      this.writeLog('DEBUG', message, data);
    }
  }
}

module.exports = new Logger();
