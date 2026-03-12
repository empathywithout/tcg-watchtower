const snoowrap = require('snoowrap');
const logger = require('./logger');
const { config } = require('./config');

class RedditPoster {
  constructor() {
    this.client = null;
    this.lastPostTime = 0;
    this.queue = [];
    this.isProcessing = false;
    this.initialize();
  }

  /**
   * Initialize Reddit client
   */
  initialize() {
    if (!config.features.enableReddit) {
      logger.info('Reddit posting is disabled');
      return;
    }

    try {
      this.client = new snoowrap({
        userAgent: config.reddit.userAgent,
        clientId: config.reddit.clientId,
        clientSecret: config.reddit.clientSecret,
        username: config.reddit.username,
        password: config.reddit.password,
      });

      // Configure snoowrap
      this.client.config({ 
        requestDelay: 1000,
        warnings: false,
        continueAfterRatelimitError: true,
      });

      logger.success('Reddit client initialized');
    } catch (error) {
      logger.error('Failed to initialize Reddit client', { error: error.message });
    }
  }

  /**
   * Add post to queue
   */
  async queuePost(title, body, imageUrl = null) {
    if (!config.features.enableReddit || !this.client) {
      logger.warning('Reddit posting is disabled or not initialized');
      return { success: false, reason: 'disabled' };
    }

    return new Promise((resolve) => {
      this.queue.push({ title, body, imageUrl, resolve });
      logger.info('Reddit post added to queue', { queueSize: this.queue.length });
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process post queue with rate limiting
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      // Check rate limit only if we've posted before
      if (this.lastPostTime > 0) {
        const timeSinceLastPost = Date.now() - this.lastPostTime;
        if (timeSinceLastPost < config.rateLimits.redditInterval) {
          const waitTime = config.rateLimits.redditInterval - timeSinceLastPost;
          logger.debug(`Rate limit: waiting ${waitTime}ms before next Reddit post`);
          await this.sleep(waitTime);
        }
      }

      const { title, body, imageUrl, resolve } = this.queue.shift();
      const result = await this.postToSubreddits(title, body, imageUrl);
      resolve(result);
      
      this.lastPostTime = Date.now();
    }

    this.isProcessing = false;
  }

  /**
   * Post to all configured subreddits
   */
  async postToSubreddits(title, body, imageUrl = null) {
    // Post to all subreddits in parallel for speed
    const postPromises = config.reddit.subreddits.map(subreddit => 
      this.postToSubreddit(subreddit, title, body, imageUrl)
    );

    const results = await Promise.allSettled(postPromises);
    
    // Map results with subreddit names
    const finalResults = results.map((result, index) => {
      const subreddit = config.reddit.subreddits[index];
      if (result.status === 'fulfilled') {
        return { subreddit, ...result.value };
      } else {
        return { 
          subreddit, 
          success: false, 
          error: result.reason?.message || 'Unknown error' 
        };
      }
    });

    const successCount = finalResults.filter(r => r.success).length;
    logger.info(`Posted to ${successCount}/${finalResults.length} subreddits`);

    return {
      success: successCount > 0,
      results: finalResults,
      successCount,
      totalCount: finalResults.length,
    };
  }

  /**
   * Post to a single subreddit
   */
  async postToSubreddit(subredditName, title, body, imageUrl = null) {
    try {
      logger.debug(`Posting to r/${subredditName}...`);

      let submission;

      if (imageUrl) {
        // Post as link with image
        submission = await this.client
          .getSubreddit(subredditName)
          .submitLink({
            title: title,
            url: imageUrl,
          });

        // Add body as a comment
        if (body) {
          await submission.reply(body);
        }
      } else {
        // Post as text post
        submission = await this.client
          .getSubreddit(subredditName)
          .submitSelfpost({
            title: title,
            text: body,
          });
      }

      logger.success(`Posted to r/${subredditName}`, { postId: submission.id });

      return {
        success: true,
        postId: submission.id,
        url: `https://reddit.com${submission.permalink}`,
      };

    } catch (error) {
      // Handle rate limiting
      if (error.message && error.message.includes('RATELIMIT')) {
        logger.error(`Rate limited on r/${subredditName}`);
        return {
          success: false,
          error: 'Rate limited',
          retry: true,
        };
      }

      logger.error(`Failed to post to r/${subredditName}`, { error: error.message });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verify Reddit credentials
   */
  async verifyCredentials() {
    if (!this.client) {
      return { valid: false, error: 'Client not initialized' };
    }

    try {
      const me = await this.client.getMe();
      logger.success('Reddit credentials verified', { username: me.name });
      return { valid: true, user: { username: me.name, id: me.id } };
    } catch (error) {
      logger.error('Reddit credentials invalid', { error: error.message });
      return { valid: false, error: error.message };
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      enabled: config.features.enableReddit,
      initialized: !!this.client,
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      lastPostTime: this.lastPostTime,
      subreddits: config.reddit.subreddits,
    };
  }
}

module.exports = new RedditPoster();
