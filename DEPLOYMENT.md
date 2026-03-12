# Railway Deployment Guide

Complete step-by-step guide to deploy TCG Watchtower Automation Engine on Railway.

## 📋 Prerequisites Checklist

Before deploying, ensure you have:

- [ ] Discord bot token
- [ ] Discord channel IDs to monitor
- [ ] Twitter API credentials (if using Twitter)
- [ ] Reddit API credentials (if using Reddit)
- [ ] GitHub account
- [ ] Railway account (free tier available)

## 🚀 Deployment Steps

### Step 1: Prepare Your GitHub Repository

1. **Create a new repository on GitHub**
   - Go to https://github.com/new
   - Name it: `tcg-watchtower-automation`
   - Keep it private if you prefer
   - Don't initialize with README (we already have one)

2. **Push code to GitHub**
   ```bash
   cd tcg-watchtower-automation
   git init
   git add .
   git commit -m "Initial commit - TCG Watchtower Automation"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/tcg-watchtower-automation.git
   git push -u origin main
   ```

### Step 2: Create Railway Project

1. **Go to Railway**
   - Visit https://railway.app
   - Sign up or log in (can use GitHub account)

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize Railway to access your GitHub
   - Select `tcg-watchtower-automation` repository

3. **Railway Auto-Detection**
   - Railway will automatically detect it's a Node.js project
   - It will use the `start` script from package.json

### Step 3: Configure Environment Variables

1. **Open Variables Tab**
   - In Railway dashboard, click on your service
   - Click "Variables" tab
   - Click "New Variable"

2. **Add Required Variables**

   **Discord Configuration:**
   ```
   DISCORD_TOKEN = your_discord_bot_token_here
   MONITORED_CHANNELS = 123456789012345678,987654321098765432
   ```

   **Twitter Configuration (if enabled):**
   ```
   TWITTER_API_KEY = your_twitter_api_key
   TWITTER_API_SECRET = your_twitter_api_secret
   TWITTER_ACCESS_TOKEN = your_twitter_access_token
   TWITTER_ACCESS_SECRET = your_twitter_access_secret
   ENABLE_TWITTER = true
   ```

   **Reddit Configuration (if enabled):**
   ```
   REDDIT_CLIENT_ID = your_reddit_client_id
   REDDIT_CLIENT_SECRET = your_reddit_client_secret
   REDDIT_USERNAME = your_reddit_username
   REDDIT_PASSWORD = your_reddit_password
   SUBREDDITS = pokemonrestocked,onepiecedeals
   ENABLE_REDDIT = true
   ```

   **Optional Configuration:**
   ```
   MIN_TWEET_INTERVAL = 20
   MIN_REDDIT_INTERVAL = 30
   DUPLICATE_TIMEOUT = 10
   DEFAULT_HASHTAGS = #PokemonTCG,#TCGDeals,#TCGWatchtower
   DEBUG = false
   ```

   **Website API (if using):**
   ```
   WEBSITE_API_URL = https://tcgwatchtower.com/api/restock
   WEBSITE_API_KEY = your_api_key
   ENABLE_WEBSITE = true
   ```

3. **Save Variables**
   - Railway will automatically redeploy after adding variables

### Step 4: Deploy

1. **Trigger Deployment**
   - Railway automatically deploys when you push to GitHub
   - Or click "Deploy" in Railway dashboard

2. **Monitor Deployment**
   - Click "Deployments" tab
   - Watch the build logs
   - Deployment typically takes 1-2 minutes

3. **Check Logs**
   - Click "Logs" tab
   - You should see:
     ```
     ============================================================
     TCG WATCHTOWER AUTOMATION ENGINE
     ============================================================
     [INFO] Validating configuration...
     [SUCCESS] Configuration validated
     [SUCCESS] Twitter credentials verified
     [SUCCESS] Reddit credentials verified
     [SUCCESS] Discord bot logged in as YourBot#1234
     [INFO] Bot is ready and listening for messages
     ```

### Step 5: Verify Deployment

1. **Check Service Status**
   - In Railway dashboard, service should show "Active"
   - Green indicator means it's running

2. **Test the Bot**
   - Post a test message in one of your monitored Discord channels
   - Check Railway logs for processing activity
   - Verify posts appear on Twitter/Reddit

3. **Monitor Logs**
   - Use Railway's log viewer for real-time monitoring
   - Or use Railway CLI: `railway logs --follow`

## 🔧 Railway Configuration Options

### Memory & CPU

Railway automatically scales resources. For this bot:
- **Typical usage**: ~100-200MB RAM
- **CPU**: Minimal (event-driven)
- **Free tier**: Usually sufficient for moderate traffic

### Restart Policy

The bot is configured to automatically restart on failure:
- Max retries: 10
- Policy: ON_FAILURE

This is set in `railway.json`.

### Environment

- **Node.js version**: 18+ (automatically detected)
- **Build**: Nixpacks (Railway's default)
- **Start command**: `node index.js`

## 📊 Monitoring on Railway

### View Logs

**Method 1: Dashboard**
- Go to your project
- Click "Logs" tab
- View real-time logs

**Method 2: CLI**
```bash
railway login
railway link
railway logs
```

### Metrics

Railway provides:
- **CPU usage**
- **Memory usage**  
- **Network traffic**
- **Build times**

Access via "Metrics" tab in dashboard.

### Deployment History

- View past deployments
- Roll back to previous versions
- Compare deployment logs

## 🔄 Updating the Bot

### Update Code

1. **Make changes locally**
   ```bash
   # Edit files
   git add .
   git commit -m "Update: description of changes"
   git push
   ```

2. **Railway Auto-Deploy**
   - Railway detects the push
   - Automatically rebuilds and redeploys
   - Zero-downtime deployment

### Update Environment Variables

1. Go to Railway dashboard
2. Click "Variables" tab
3. Edit or add variables
4. Bot automatically restarts with new variables

## 🐛 Troubleshooting

### Deployment Fails

**Check Build Logs:**
- Look for dependency installation errors
- Verify Node.js version compatibility

**Common fixes:**
```bash
# Clear Railway cache
railway run npm install

# Or trigger rebuild
git commit --allow-empty -m "Trigger rebuild"
git push
```

### Bot Not Starting

**Check Environment Variables:**
- Ensure all required variables are set
- Check for typos in variable names
- Verify credentials are correct

**View startup logs:**
- Railway dashboard > Logs
- Look for configuration validation errors

### Bot Crashes

**Check logs for errors:**
```bash
railway logs --tail 100
```

**Common issues:**
- Invalid Discord token
- Invalid API credentials
- Network connectivity issues
- Rate limiting

### Bot Not Posting

**Verify Credentials:**
- Test Twitter credentials separately
- Test Reddit credentials separately
- Check bot permissions in Discord

**Check Rate Limits:**
- Increase interval times in variables
- Check queue sizes in logs

### Out of Memory

If you exceed Railway's free tier memory:

**Optimize:**
- Reduce `DUPLICATE_TIMEOUT`
- Clear logs periodically
- Upgrade Railway plan if needed

## 💰 Railway Pricing

### Hobby Plan (Free)
- $5 free credit per month
- Plenty for this bot
- Automatic sleep after inactivity (can disable)

### Developer Plan ($5/month)
- $5 credit + pay-as-you-go
- No sleep
- Priority builds

### Team Plan ($20/month)
- Team collaboration
- Priority support

**Estimated cost for this bot:**
- Typically stays within free tier
- ~$0-2/month if very active

## 🔒 Security Best Practices

1. **Never commit .env file**
   - Already in .gitignore
   - Only use Railway variables

2. **Rotate API keys regularly**
   - Update in Railway variables
   - No code changes needed

3. **Keep repository private**
   - Protects your setup
   - Railway works with private repos

4. **Use Railway secrets**
   - All variables are encrypted
   - Not visible in logs

## 📚 Additional Resources

- **Railway Docs**: https://docs.railway.app
- **Discord.js Guide**: https://discordjs.guide
- **Twitter API Docs**: https://developer.twitter.com/en/docs
- **Reddit API Docs**: https://www.reddit.com/dev/api

## 🆘 Getting Help

### Railway Support
- Community Discord: https://discord.gg/railway
- Twitter: @Railway
- Email: team@railway.app

### Bot Issues
- Check logs first
- Review configuration
- Test credentials individually
- Open GitHub issue

---

## ✅ Deployment Checklist

Before going live, verify:

- [ ] All environment variables are set correctly
- [ ] Discord bot is in your server with proper permissions
- [ ] Twitter credentials verified (check logs)
- [ ] Reddit credentials verified (check logs)
- [ ] Test message posted successfully
- [ ] Logs show no errors
- [ ] Duplicate detection working
- [ ] Rate limiting configured appropriately
- [ ] Monitoring set up

**You're ready to go! 🚀**
