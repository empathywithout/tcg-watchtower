const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('./logger');
const { config } = require('./config');
const messageProcessor = require('./messageProcessor');
const duplicateDetector = require('./duplicateDetector');
const twitterPoster = require('./twitterPoster');
const redditPoster = require('./redditPoster');
const websitePoster = require('./websitePoster');

class DiscordListener {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.processedMessageIds = new Set(); // Track claimed message IDs to prevent double-pickup
    this.fullyProcessedIds = new Set();   // Track fully distributed messages to prevent duplicate posts (Bug 2 fix)
  }

  /**
   * Initialize Discord client
   */
  async initialize() {
    logger.info('Initializing Discord client...');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Event handlers
    this.client.on('ready', () => this.onReady());
    this.client.on('messageCreate', (message) => this.onMessageWithDelay(message));
    this.client.on('messageUpdate', (oldMessage, newMessage) => this.onMessageUpdate(oldMessage, newMessage));
    this.client.on('error', (error) => this.onError(error));
    this.client.on('warn', (warning) => this.onWarning(warning));

    // Login
    try {
      await this.client.login(config.discord.token);
    } catch (error) {
      logger.error('Failed to login to Discord', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle ready event
   */
  onReady() {
    this.isReady = true;
    logger.success(`Discord bot logged in as ${this.client.user.tag}`);
    logger.info(`Monitoring ${config.discord.monitoredChannels.length} channel(s)`);
    logger.info('Bot is ready and listening for messages');
  }

  /**
   * Entry point for messageCreate.
   * - If the message already has an embed, process it immediately (no delay).
   * - If not, claim the ID and wait for messageUpdate to bring the embed.
   */
  async onMessageWithDelay(message) {
    // Ignore unmonitored channels before doing anything (Bug 3 fix)
    if (!config.discord.monitoredChannels.includes(message.channel.id)) return;

    // Claim ID immediately to block any duplicate paths
    if (this.processedMessageIds.has(message.id)) {
      logger.debug('Message already claimed, skipping', { messageId: message.id });
      return;
    }
    this.processedMessageIds.add(message.id);
    setTimeout(() => this.processedMessageIds.delete(message.id), 10 * 60 * 1000);

    if (message.embeds && message.embeds.length > 0) {
      // Embed already present — process immediately, no delay needed
      logger.debug('Embed present on messageCreate, processing immediately');
      await this.onMessage(message, true);
    } else {
      // No embed yet — messageUpdate will fire once Discord attaches it
      logger.debug('No embed on messageCreate, waiting for messageUpdate', { messageId: message.id });
    }
  }

  /**
   * Handle message updates.
   * Fires when Discord attaches an embed to a message after the fact.
   * Since we claimed the ID in onMessageWithDelay, we use a separate
   * pendingEmbedIds set to know we should process this update.
   */
  async onMessageUpdate(oldMessage, newMessage) {
    // Bug 2 fix: skip if already fully processed to prevent duplicate posts
    if (this.fullyProcessedIds.has(newMessage.id)) return;

    const hadEmbeds = oldMessage.embeds && oldMessage.embeds.length > 0;
    const hasEmbeds = newMessage.embeds && newMessage.embeds.length > 0;

    // Only care about messages that just gained an embed for the first time
    if (!hadEmbeds && hasEmbeds) {
      // Check if we claimed this ID (i.e. it came through our monitored channel)
      if (this.processedMessageIds.has(newMessage.id)) {
        // We own this message — process it now that the embed has arrived
        logger.debug('Embed arrived via messageUpdate, processing now', { messageId: newMessage.id });
        await this.onMessage(newMessage, true);
      }
    }
  }

  /**
   * Handle new messages.
   * @param {boolean} alreadyClaimed - true if onMessageWithDelay already claimed the ID
   */
  async onMessage(message, alreadyClaimed = false) {
    try {
      // Bug 2 fix: use fullyProcessedIds as the authoritative guard — can never be bypassed
      if (this.fullyProcessedIds.has(message.id)) {
        logger.debug('Message already fully processed, skipping', { messageId: message.id });
        return;
      }

      // Also guard against unclaimed messages hitting this path directly
      if (!alreadyClaimed && this.processedMessageIds.has(message.id)) {
        logger.debug('Message already claimed, skipping', { messageId: message.id });
        return;
      }

      // DEBUG: Log every message received
      logger.debug('Discord message event fired', {
        channelId: message.channel.id,
        channelName: message.channel.name,
        author: message.author.tag,
        authorId: message.author.id,
        isBot: message.author.bot,
        hasEmbeds: message.embeds.length > 0,
        contentLength: message.content?.length || 0,
      });

      // Allow messages from specific bots (like TCG Watchtower Monitors), ignore all others
      if (message.author.bot) {
        const allowedBots = config.discord.allowedBots;
        
        const isAllowedBot = allowedBots.some(allowed => 
          message.author.tag.includes(allowed) || 
          message.author.username.includes(allowed)
        );
        
        if (!isAllowedBot) {
          logger.debug('Ignoring bot message (not in allowed list)', {
            bot: message.author.tag,
            allowedBots: allowedBots
          });
          return;
        } else {
          logger.debug('Allowing message from whitelisted bot', {
            bot: message.author.tag
          });
        }
      }

      // Check if message is from a monitored channel
      if (!config.discord.monitoredChannels.includes(message.channel.id)) {
        logger.debug('Channel not monitored', {
          channelId: message.channel.id,
          monitoredChannels: config.discord.monitoredChannels,
        });
        return;
      }

      logger.info('Message received', {
        channel: message.channel.name,
        author: message.author.tag,
      });

      // If not already claimed by onMessageWithDelay, claim now (e.g. messageUpdate path)
      if (!alreadyClaimed) {
        this.processedMessageIds.add(message.id);
        setTimeout(() => this.processedMessageIds.delete(message.id), 10 * 60 * 1000);
      }

      // Process the message
      await this.processMessage(message);

    } catch (error) {
      logger.error('Error processing message', { error: error.message });
    }
  }

  /**
   * Process and distribute message
   */
  async processMessage(message) {
    // Extract product information
    const productInfo = messageProcessor.extractProductInfo(message);

    // Check if this is a Pokemon Center queue alert
    const isQueueAlert = messageProcessor.isPokemonCenterQueueAlert(message, productInfo);

    if (isQueueAlert) {
      logger.info('Pokemon Center queue alert detected!');
      productInfo.isPokemonCenterQueue = true;
      productInfo.productName = 'Pokemon Center Queue Live'; // Set a product name for validation
    }

    // Validate product info
    if (!messageProcessor.isValidProductInfo(productInfo)) {
      logger.warning('Invalid product info - skipped');
      return;
    }

    // Duplicate / restock check — keyed on channel + product name + retailer (source footer).
    // Same product at different retailers = different key = both post normally.
    // Same product + same retailer + same channel within suppressWindow = silently dropped.
    // Same product after suppressWindow but within restockWindow = posts with "still restocking" note.
    let dupeAction = 'post';
    if (!isQueueAlert) {
      const { action } = duplicateDetector.checkAndRecord(
        message.channel.id,
        productInfo.productName,
        productInfo.source || ''
      );
      dupeAction = action;

      if (dupeAction === 'suppress') {
        logger.info('Duplicate suppressed — skipping post', {
          product: productInfo.productName?.substring(0, 50) || 'N/A',
        });
        return;
      }
    }

    if (isQueueAlert) {
      logger.info('Processing Pokemon Center queue alert');
    } else {
      logger.info(`Processing restock [${dupeAction}]`, {
        product: productInfo.productName?.substring(0, 30) || 'N/A',
        price: productInfo.price,
      });
    }

    // Prepare distribution tasks - all execute in parallel
    const tasks = [];

    // Twitter
    if (config.features.enableTwitter) {
      let tweetText;
      let imageUrls = [];

      if (isQueueAlert) {
        // Special tweet for queue alerts
        tweetText = messageProcessor.formatPokemonCenterQueueAlert();
      } else {
        // Normal product tweet
        tweetText = messageProcessor.formatForTwitter(productInfo, dupeAction === 'restock');
        imageUrls = productInfo.images.map(img => img.url);
      }

      tasks.push(
        twitterPoster.queueTweet(tweetText, imageUrls)
          .then(result => ({ platform: 'Twitter', ...result }))
      );
    }

    // Reddit
    if (config.features.enableReddit) {
      let title, body;

      if (isQueueAlert) {
        // Special Reddit post for queue alerts
        title = '🚨 Pokemon Center Queue is LIVE!';
        body = `The Pokemon Center waiting room/security queue is now active!\n\n**Get ready to purchase!**\n\n**Link:** https://www.pokemoncenter.com\n\n---\n\n*Track more restocks at [TCGWatchtower.com](https://tcgwatchtower.com)*`;
      } else {
        // Normal product post
        const formatted = messageProcessor.formatForReddit(productInfo);
        title = formatted.title;
        body = formatted.body;
      }

      const imageUrl = !isQueueAlert && productInfo.images.length > 0 ? productInfo.images[0].url : null;
      
      tasks.push(
        redditPoster.queuePost(title, body, imageUrl)
          .then(result => ({ platform: 'Reddit', ...result }))
      );
    }

    // Website API (skip for queue alerts unless you want to track them)
    if (config.features.enableWebsite && !isQueueAlert) {
      const websiteData = messageProcessor.formatForWebsite(
        productInfo,
        message.id,
        message.channel.id
      );
      tasks.push(
        websitePoster.postRestock(websiteData)
          .then(result => ({ platform: 'Website', ...result }))
      );
    }

    // Execute all distribution tasks in parallel
    if (tasks.length === 0) {
      logger.warning('No platforms enabled');
      return;
    }

    const startTime = Date.now();
    const results = await Promise.allSettled(tasks);
    const elapsed = Date.now() - startTime;

    // Count successes
    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value.success
    ).length;

    logger.success(`Distributed: ${successCount}/${results.length} platforms (${elapsed}ms)`);

    // Mark as fully processed so messageUpdate can never re-trigger this message (Bug 2 fix)
    this.fullyProcessedIds.add(message.id);
    setTimeout(() => this.fullyProcessedIds.delete(message.id), 10 * 60 * 1000);

    // Log failures only
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && !result.value.success) {
        logger.error(`${result.value.platform} failed`, { error: result.value.error });
      } else if (result.status === 'rejected') {
        logger.error(`Task ${index} failed`, { error: result.reason });
      }
    });
  }

  /**
   * Handle Discord errors
   */
  onError(error) {
    logger.error('Discord client error', { error: error.message, stack: error.stack });
  }

  /**
   * Handle Discord warnings
   */
  onWarning(warning) {
    logger.warning('Discord client warning', { warning });
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down Discord client...');
    if (this.client) {
      await this.client.destroy();
    }
    logger.info('Discord client shut down');
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      ready: this.isReady,
      username: this.client?.user?.tag,
      monitoredChannels: config.discord.monitoredChannels.length,
    };
  }
}

module.exports = new DiscordListener();
