const http = require('http');
const logger = require('./logger');
const discordListener = require('./discordListener');
const twitterPoster = require('./twitterPoster');
const redditPoster = require('./redditPoster');
const duplicateDetector = require('./duplicateDetector');

/**
 * Simple health check endpoint for monitoring
 * Railway can use this to verify the service is running
 */

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    // Gather status from all components
    const discordStatus = discordListener.getStatus();
    const twitterStatus = twitterPoster.getStatus();
    const redditStatus = redditPoster.getStatus();
    const cacheStats = duplicateDetector.getStats();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      discord: {
        ready: discordStatus.ready,
        username: discordStatus.username,
        monitoredChannels: discordStatus.monitoredChannels,
      },
      twitter: {
        enabled: twitterStatus.enabled,
        initialized: twitterStatus.initialized,
        queueSize: twitterStatus.queueSize,
      },
      reddit: {
        enabled: redditStatus.enabled,
        initialized: redditStatus.initialized,
        queueSize: redditStatus.queueSize,
        subreddits: redditStatus.subreddits?.length || 0,
      },
      cache: {
        size: cacheStats.cacheSize,
        timeoutMinutes: cacheStats.timeoutMinutes,
      },
      memory: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  } else if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Start health check server
server.listen(PORT, () => {
  logger.info(`Health check server running on port ${PORT}`);
  logger.info(`Access at: http://localhost:${PORT}/health`);
});

// Export for use in main application
module.exports = server;
