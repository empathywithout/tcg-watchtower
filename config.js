require('dotenv').config();

const config = {
  // Discord Configuration
  discord: {
    token: process.env.DISCORD_TOKEN,
    monitoredChannels: process.env.MONITORED_CHANNELS 
      ? process.env.MONITORED_CHANNELS.split(',').map(id => id.trim())
      : [],
    allowedBots: process.env.ALLOWED_BOTS
      ? process.env.ALLOWED_BOTS.split(',').map(name => name.trim())
      : ['TCG Watchtower Monitors'],
    pokemonCenterChannelId: process.env.POKEMON_CENTER_CHANNEL_ID || null,
  },

  // Twitter Configuration
  twitter: {
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  },

  // Reddit Configuration
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
    userAgent: process.env.REDDIT_USER_AGENT || 'TCGWatchtower/1.0.0',
    subreddits: process.env.SUBREDDITS 
      ? process.env.SUBREDDITS.split(',').map(sub => sub.trim())
      : [],
  },

  // Website API Configuration
  website: {
    apiUrl: process.env.WEBSITE_API_URL || null,
    apiKey: process.env.WEBSITE_API_KEY || null,
  },

  // Rate Limiting
  rateLimits: {
    twitterInterval: parseInt(process.env.MIN_TWEET_INTERVAL || '3') * 1000,
    redditInterval: parseInt(process.env.MIN_REDDIT_INTERVAL || '3') * 1000,
  },

  // Duplicate Protection
  // suppressWindow: hard block — same product+retailer+channel won't post within this period (default 15 min)
  suppressWindow: parseInt(process.env.SUPPRESS_WINDOW_MINUTES || '15') * 60 * 1000,
  // restockWindow: after suppressWindow expires, if alerts keep coming we post with a "still restocking" note
  //   Set to 0 to disable the "still restocking" posts entirely.
  restockWindow: parseInt(process.env.RESTOCK_WINDOW_MINUTES || '120') * 60 * 1000,

  // Optional Features
  features: {
    enableTwitter: process.env.ENABLE_TWITTER !== 'false',
    enableReddit: process.env.ENABLE_REDDIT !== 'false',
    enableWebsite: process.env.ENABLE_WEBSITE === 'true',
  },

  // Hashtags
  defaultHashtags: process.env.DEFAULT_HASHTAGS 
    ? process.env.DEFAULT_HASHTAGS.split(',').map(tag => tag.trim())
    : ['#TCGDeals', '#TCGWatchtower'],
};

// Validation
const validateConfig = () => {
  const errors = [];

  if (!config.discord.token) {
    errors.push('DISCORD_TOKEN is required');
  }

  if (config.discord.monitoredChannels.length === 0) {
    errors.push('MONITORED_CHANNELS is required (comma-separated channel IDs)');
  }

  if (config.features.enableTwitter) {
    if (!config.twitter.appKey || !config.twitter.appSecret || 
        !config.twitter.accessToken || !config.twitter.accessSecret) {
      errors.push('Twitter credentials are incomplete (API_KEY, API_SECRET, ACCESS_TOKEN, ACCESS_SECRET)');
    }
  }

  if (config.features.enableReddit) {
    if (!config.reddit.clientId || !config.reddit.clientSecret || 
        !config.reddit.username || !config.reddit.password) {
      errors.push('Reddit credentials are incomplete (CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD)');
    }
    if (config.reddit.subreddits.length === 0) {
      errors.push('SUBREDDITS is required when Reddit is enabled');
    }
  }

  if (config.features.enableWebsite && !config.website.apiUrl) {
    errors.push('WEBSITE_API_URL is required when website posting is enabled');
  }

  return errors;
};

module.exports = { config, validateConfig };
