# Quick Start Guide

Get your TCG Watchtower Automation Engine running in 10 minutes.

## ⚡ 5-Minute Local Setup

### 1. Install & Configure (2 minutes)

```bash
# Clone and setup
cd tcg-watchtower-automation
npm install
cp .env.example .env
```

### 2. Add Essential Credentials (2 minutes)

Edit `.env` and add AT MINIMUM:

```env
DISCORD_TOKEN=your_bot_token
MONITORED_CHANNELS=your_channel_id
```

**Optional but recommended:**
```env
# Twitter
TWITTER_API_KEY=your_key
TWITTER_API_SECRET=your_secret
TWITTER_ACCESS_TOKEN=your_token
TWITTER_ACCESS_SECRET=your_secret

# Reddit  
REDDIT_CLIENT_ID=your_id
REDDIT_CLIENT_SECRET=your_secret
REDDIT_USERNAME=your_username
REDDIT_PASSWORD=your_password
SUBREDDITS=test
```

### 3. Start Bot (1 minute)

```bash
npm start
```

You should see:
```
[SUCCESS] Discord bot logged in as YourBot#1234
[INFO] Bot is ready and listening for messages
```

### 4. Test It! (30 seconds)

Post this in your Discord channel:

```
🚨 RESTOCK ALERT

Test Product is back!

$99.99

https://example.com
```

Check logs - should see distribution to enabled platforms!

---

## 🚀 5-Minute Railway Deployment

### 1. Push to GitHub (2 minutes)

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/tcg-watchtower.git
git push -u origin main
```

### 2. Deploy on Railway (2 minutes)

1. Go to [railway.app](https://railway.app)
2. Click "New Project" > "Deploy from GitHub"
3. Select your repository
4. Add environment variables (copy from `.env`)
5. Click "Deploy"

### 3. Verify (1 minute)

Check Railway logs:
```
[SUCCESS] Discord bot logged in
[INFO] Bot is ready
```

Done! 🎉

---

## 🔑 Getting API Credentials Fast

### Discord (2 minutes)

1. [discord.com/developers/applications](https://discord.com/developers/applications)
2. New Application > Bot > Create Bot
3. Copy token
4. Enable "Message Content Intent"
5. OAuth2 > URL Generator > bot + "Read Messages"
6. Invite to server

**Get Channel ID:**
- Right-click channel > Copy ID (need Developer Mode on)

### Twitter (5 minutes)

1. [developer.twitter.com](https://developer.twitter.com)
2. Create App
3. Keys and Tokens > Generate
4. Copy all 4 credentials
5. Set permissions to "Read and Write"

### Reddit (3 minutes)

1. [reddit.com/prefs/apps](https://reddit.com/prefs/apps)
2. Create App > script
3. Copy client ID (under name) and secret
4. Use your Reddit username/password

---

## 📋 Minimal Configuration

**Absolute minimum to run:**

```env
DISCORD_TOKEN=xxx
MONITORED_CHANNELS=xxx
ENABLE_TWITTER=false
ENABLE_REDDIT=false
```

This will:
- ✅ Monitor Discord
- ✅ Process messages
- ✅ Log everything
- ❌ Not post to Twitter/Reddit

Great for testing!

**Recommended for production:**

```env
DISCORD_TOKEN=xxx
MONITORED_CHANNELS=xxx

TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_SECRET=xxx
ENABLE_TWITTER=true

REDDIT_CLIENT_ID=xxx
REDDIT_CLIENT_SECRET=xxx
REDDIT_USERNAME=xxx
REDDIT_PASSWORD=xxx
SUBREDDITS=your_subreddit
ENABLE_REDDIT=true

MIN_TWEET_INTERVAL=3
MIN_REDDIT_INTERVAL=3
DUPLICATE_TIMEOUT=10
```

---

## ✅ Quick Verification

After starting, verify everything works:

### 1. Check Health Endpoint
```bash
curl http://localhost:3000/health
```

Should return JSON with `"status": "healthy"`

### 2. Post Test Message

In Discord:
```
🚨 TEST

Test Product

$1.00

https://test.com
```

### 3. Check Results

**Logs should show:**
```
[INFO] New message received
[INFO] Processing restock alert
[SUCCESS] Distributed to Twitter
[SUCCESS] Distributed to Reddit
```

**Verify on platforms:**
- [ ] Tweet posted
- [ ] Reddit post created

---

## 🆘 Common Quick Fixes

### Bot doesn't start

```bash
# Check Node version (need 18+)
node --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### "Invalid token" error

- Double-check token in .env (no spaces, quotes, or newlines)
- Regenerate token in Discord portal

### Bot doesn't see messages

- Enable "Message Content Intent" in Discord
- Reinvite bot with proper permissions
- Verify channel ID is correct

### Twitter fails

- Verify all 4 credentials
- Check app has "Read and Write" permissions
- Generate new tokens if needed

### Railway deployment stuck

- Check environment variables are set
- View deployment logs for errors
- Ensure .env is NOT committed to git

---

## 📚 Next Steps

Once running:

1. **Read [README.md](README.md)** - Full feature overview
2. **Review [TESTING.md](TESTING.md)** - Test all features
3. **Check [DEPLOYMENT.md](DEPLOYMENT.md)** - Production tips
4. **See [API_DOCUMENTATION.md](API_DOCUMENTATION.md)** - Website integration

---

## 💡 Pro Tips

**For development:**
```env
DEBUG=true
MIN_TWEET_INTERVAL=5
MIN_REDDIT_INTERVAL=5
DUPLICATE_TIMEOUT=2
```

**For production:**
```env
DEBUG=false
MIN_TWEET_INTERVAL=20
MIN_REDDIT_INTERVAL=30
DUPLICATE_TIMEOUT=10
```

**Monitor in real-time:**
```bash
# Local
tail -f logs/bot.log

# Railway
railway logs --follow
```

---

That's it! Your automation engine is ready to distribute TCG restock alerts. 🎉
