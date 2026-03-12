# TCG Watchtower Automation Engine

Automatically distribute TCG restock alerts from Discord to Twitter, Reddit, and your website API.

## 🚀 Features

- **Discord Monitoring**: Listen to multiple Discord channels for restock alerts
- **Multi-Platform Distribution**: Automatically post to Twitter, Reddit, and website APIs
- **Smart Message Processing**: Extract product names, prices, links, and images
- **Duplicate Prevention**: Avoid posting the same alert multiple times
- **Rate Limiting**: Intelligent queuing system to respect platform limits
- **Image Support**: Automatically attach images to posts
- **Comprehensive Logging**: Track all activities and errors
- **Railway Ready**: Configured for one-click deployment

## 📋 Prerequisites

- Node.js 18+ 
- Discord Bot Token
- Twitter API credentials (API v2)
- Reddit API credentials
- (Optional) Website API endpoint

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/tcg-watchtower-automation.git
cd tcg-watchtower-automation
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token
MONITORED_CHANNELS=123456789012345678,987654321098765432

# Twitter
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_secret

# Reddit
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_username
REDDIT_PASSWORD=your_password
SUBREDDITS=pokemonrestocked,onepiecedeals

# Optional: Website API
WEBSITE_API_URL=https://tcgwatchtower.com/api/restock
ENABLE_WEBSITE=true
```

## 🔑 Getting API Credentials

### Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a New Application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" under Privileged Gateway Intents
6. Invite bot to your server with permissions: Read Messages, Send Messages

**Get Channel IDs:**
- Enable Developer Mode in Discord (User Settings > Advanced)
- Right-click on channel > Copy ID

### Twitter API

1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new App
3. Generate API keys and access tokens
4. Ensure you have "Read and Write" permissions

### Reddit API

1. Go to [Reddit App Preferences](https://www.reddit.com/prefs/apps)
2. Create an app (select "script")
3. Copy Client ID and Secret
4. Use your Reddit username and password

## 🚂 Railway Deployment

### Method 1: Deploy from GitHub

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/tcg-watchtower-automation.git
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [Railway.app](https://railway.app)
   - Click "New Project" > "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect the Node.js project

3. **Add Environment Variables**
   - In Railway dashboard, go to your project
   - Click "Variables" tab
   - Add all variables from `.env.example`

4. **Deploy**
   - Railway will automatically deploy
   - Check logs to verify the bot is running

### Method 2: Deploy with Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add environment variables
railway variables set DISCORD_TOKEN=your_token
railway variables set MONITORED_CHANNELS=channel_ids
# ... add all other variables

# Deploy
railway up
```

## 🏃 Local Development

```bash
# Start the bot
npm start

# With debug logging
DEBUG=true npm start
```

## 📊 Project Structure

```
tcg-watchtower-automation/
├── index.js                 # Main application entry
├── config.js                # Configuration management
├── logger.js                # Logging system
├── duplicateDetector.js     # Duplicate prevention
├── messageProcessor.js      # Message parsing
├── discordListener.js       # Discord integration
├── twitterPoster.js         # Twitter integration
├── redditPoster.js          # Reddit integration
├── websitePoster.js         # Website API integration
├── package.json             # Dependencies
├── .env.example             # Environment template
├── .gitignore               # Git ignore rules
└── logs/                    # Log files
    └── bot.log
```

## 🔧 Configuration Options

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DISCORD_TOKEN` | Discord bot token | Yes | - |
| `MONITORED_CHANNELS` | Comma-separated channel IDs | Yes | - |
| `TWITTER_API_KEY` | Twitter API key | If Twitter enabled | - |
| `TWITTER_API_SECRET` | Twitter API secret | If Twitter enabled | - |
| `TWITTER_ACCESS_TOKEN` | Twitter access token | If Twitter enabled | - |
| `TWITTER_ACCESS_SECRET` | Twitter access secret | If Twitter enabled | - |
| `REDDIT_CLIENT_ID` | Reddit client ID | If Reddit enabled | - |
| `REDDIT_CLIENT_SECRET` | Reddit client secret | If Reddit enabled | - |
| `REDDIT_USERNAME` | Reddit username | If Reddit enabled | - |
| `REDDIT_PASSWORD` | Reddit password | If Reddit enabled | - |
| `SUBREDDITS` | Comma-separated subreddit names | If Reddit enabled | - |
| `WEBSITE_API_URL` | Website API endpoint | If website enabled | - |
| `WEBSITE_API_KEY` | Website API key | No | - |
| `MIN_TWEET_INTERVAL` | Seconds between tweets | No | 3 |
| `MIN_REDDIT_INTERVAL` | Seconds between Reddit posts | No | 3 |
| `DUPLICATE_TIMEOUT` | Minutes to cache messages | No | 10 |
| `ENABLE_TWITTER` | Enable Twitter posting | No | true |
| `ENABLE_REDDIT` | Enable Reddit posting | No | true |
| `ENABLE_WEBSITE` | Enable website API | No | false |
| `DEFAULT_HASHTAGS` | Comma-separated hashtags | No | #TCGDeals,#TCGWatchtower |
| `DEBUG` | Enable debug logging | No | false |

## 📝 Message Format Examples

### Input (Discord Message)

```
🚨 RESTOCK ALERT

Pokemon Destined Rivals ETB is back in stock!

Retail: $49.99

Grab it here:
https://affiliate-link.com

#PokemonTCG #TCGDeals
```

### Output (Twitter)

```
🚨 Pokemon Destined Rivals ETB back in stock!

$49.99

https://affiliate-link.com

#PokemonTCG #TCGDeals #TCGWatchtower
```

### Output (Reddit)

**Title:** Pokemon Destined Rivals ETB - Restock

**Body:**
```
**Price:** $49.99

**Link:** https://affiliate-link.com

---

*Track more restocks at [TCGWatchtower.com](https://tcgwatchtower.com)*
```

## 🔍 Monitoring & Logs

Logs are stored in `logs/bot.log` and include:

- Discord messages received
- Platform posting success/failure
- Duplicate alerts prevented
- Rate limiting activities
- API errors

View logs in real-time on Railway:
```bash
railway logs
```

## ⚡ Performance

- **Response Time:** 2-5 seconds from Discord to all platforms
- **Parallel Distribution:** All platforms post simultaneously
- **First Message:** Instant (no rate limit delay)
- **Queue Processing:** Automatic with 3-second intervals
- **Image Uploads:** Parallel processing for maximum speed
- **Optimized Logging:** Non-blocking I/O for minimal overhead

## 🐛 Troubleshooting

### Bot not receiving messages
- Verify Discord bot has "Message Content Intent" enabled
- Check bot has access to the monitored channels
- Confirm channel IDs are correct

### Twitter posting fails
- Verify API credentials have Read & Write permissions
- Check rate limits (20 seconds between posts)
- Ensure tweets are under 280 characters

### Reddit posting fails
- Verify Reddit account has enough karma
- Check if subreddits allow bot posts
- Ensure rate limits (30 seconds between posts)

### Rate limit errors
- Increase `MIN_TWEET_INTERVAL` or `MIN_REDDIT_INTERVAL`
- Messages are queued automatically

## 📄 License

MIT License - feel free to use for commercial projects

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first.

## 📧 Support

For issues or questions:
- Open a GitHub issue
- Check the logs in `logs/bot.log`
- Review Railway deployment logs

---

Built with ❤️ for the TCG community
