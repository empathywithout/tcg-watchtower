const logger = require('./logger');
const { config, validateConfig } = require('./config');
const discordListener = require('./discordListener');
const twitterPoster = require('./twitterPoster');
const redditPoster = require('./redditPoster');
const websitePoster = require('./websitePoster');
const duplicateDetector = require('./duplicateDetector');
const healthCheckServer = require('./healthCheck');

/**
 * TCG Watchtower Automation Engine
 * Main application entry point
 */

class Application {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Initialize and start the application
   */
  async start() {
    try {
      logger.info('='.repeat(60));
      logger.info('TCG WATCHTOWER AUTOMATION ENGINE');
      logger.info('='.repeat(60));
      
      // Validate configuration
      logger.info('Validating configuration...');
      const configErrors = validateConfig();
      
      if (configErrors.length > 0) {
        logger.error('Configuration validation failed:');
        configErrors.forEach(error => logger.error(`  - ${error}`));
        process.exit(1);
      }
      
      logger.success('Configuration validated');

      // Display configuration
      this.displayConfiguration();

      // Verify platform credentials
      await this.verifyCredentials();

      // Initialize Discord listener
      logger.info('Starting Discord listener...');
      await discordListener.initialize();

      this.isRunning = true;
      logger.success('Application started successfully');
      logger.info('Monitoring for restock alerts...');
      
      // Display status every 30 minutes
      this.startStatusReport();

    } catch (error) {
      logger.error('Failed to start application', { 
        error: error.message, 
        stack: error.stack 
      });
      process.exit(1);
    }
  }

  /**
   * Display current configuration
   */
  displayConfiguration() {
    logger.info('Configuration:');
    logger.info(`  Discord Channels: ${config.discord.monitoredChannels.length}`);
    logger.info(`  Twitter: ${config.features.enableTwitter ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`  Reddit: ${config.features.enableReddit ? 'ENABLED' : 'DISABLED'} ${config.features.enableReddit ? `(${config.reddit.subreddits.length} subreddits)` : ''}`);
    logger.info(`  Website API: ${config.features.enableWebsite ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`  Duplicate Protection: ${config.duplicateTimeout / 60000} minutes`);
    logger.info(`  Twitter Rate Limit: ${config.rateLimits.twitterInterval / 1000} seconds`);
    logger.info(`  Reddit Rate Limit: ${config.rateLimits.redditInterval / 1000} seconds`);
  }

  /**
   * Verify platform credentials
   */
  async verifyCredentials() {
    logger.info('Verifying platform credentials...');

    const verifications = [];

    // Twitter
    if (config.features.enableTwitter) {
      const twitterResult = await twitterPoster.verifyCredentials();
      verifications.push({
        platform: 'Twitter',
        valid: twitterResult.valid,
        error: twitterResult.error,
        user: twitterResult.user?.username,
      });
    }

    // Reddit
    if (config.features.enableReddit) {
      const redditResult = await redditPoster.verifyCredentials();
      verifications.push({
        platform: 'Reddit',
        valid: redditResult.valid,
        error: redditResult.error,
        user: redditResult.user?.username,
      });
    }

    // Log results
    verifications.forEach(v => {
      if (v.valid) {
        logger.success(`${v.platform} credentials verified (${v.user})`);
      } else {
        logger.error(`${v.platform} credentials INVALID`, { error: v.error });
      }
    });

    // Check if any required platform failed
    const invalidCount = verifications.filter(v => !v.valid).length;
    if (invalidCount > 0) {
      logger.warning(`${invalidCount} platform(s) have invalid credentials`);
    }
  }

  /**
   * Display periodic status reports
   */
  startStatusReport() {
    setInterval(() => {
      logger.info('=== STATUS REPORT ===');
      
      // Discord status
      const discordStatus = discordListener.getStatus();
      logger.info(`Discord: ${discordStatus.ready ? 'READY' : 'NOT READY'} (${discordStatus.username})`);
      
      // Twitter status
      const twitterStatus = twitterPoster.getStatus();
      if (twitterStatus.enabled) {
        logger.info(`Twitter: Queue=${twitterStatus.queueSize}, Processing=${twitterStatus.isProcessing}`);
      }
      
      // Reddit status
      const redditStatus = redditPoster.getStatus();
      if (redditStatus.enabled) {
        logger.info(`Reddit: Queue=${redditStatus.queueSize}, Processing=${redditStatus.isProcessing}`);
      }
      
      // Duplicate detector stats
      const cacheStats = duplicateDetector.getStats();
      logger.info(`Duplicate Cache: ${cacheStats.cacheSize} entries`);
      
      logger.info('===================');
    }, 30 * 60 * 1000); // Every 30 minutes
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Initiating graceful shutdown...');
    this.isRunning = false;

    try {
      await discordListener.shutdown();
      logger.success('Application shut down successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }
}

// Create application instance
const app = new Application();

// Handle process signals
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  app.shutdown();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  app.shutdown();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

// Start the application
app.start();
