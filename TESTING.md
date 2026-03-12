# Testing Guide

Complete guide for testing the TCG Watchtower Automation Engine.

## 🧪 Testing Overview

Before deploying to production, thoroughly test:
1. Discord connection and monitoring
2. Twitter posting functionality
3. Reddit posting functionality
4. Website API integration
5. Duplicate detection
6. Rate limiting
7. Error handling

## 📝 Pre-Testing Checklist

- [ ] All API credentials configured in `.env`
- [ ] Discord bot invited to test server
- [ ] Test Discord channels created
- [ ] Twitter account ready for test posts
- [ ] Reddit test subreddit available (or use r/test)
- [ ] Website API endpoint ready (if testing)

## 🔧 Local Testing Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Test Environment

Create `.env` file:

```env
# Use test credentials, not production!
DISCORD_TOKEN=your_test_bot_token
MONITORED_CHANNELS=your_test_channel_id

# Twitter test account
TWITTER_API_KEY=test_key
TWITTER_API_SECRET=test_secret
TWITTER_ACCESS_TOKEN=test_token
TWITTER_ACCESS_SECRET=test_secret

# Reddit test account
REDDIT_CLIENT_ID=test_id
REDDIT_CLIENT_SECRET=test_secret
REDDIT_USERNAME=test_username
REDDIT_PASSWORD=test_password
SUBREDDITS=test

# Enable debug logging
DEBUG=true

# Shorter intervals for testing
MIN_TWEET_INTERVAL=5
MIN_REDDIT_INTERVAL=5
DUPLICATE_TIMEOUT=2
```

### 3. Start the Bot

```bash
npm start
```

Expected output:
```
============================================================
TCG WATCHTOWER AUTOMATION ENGINE
============================================================
[INFO] Validating configuration...
[SUCCESS] Configuration validated
[INFO] Configuration:
  Discord Channels: 1
  Twitter: ENABLED
  Reddit: ENABLED
...
[SUCCESS] Discord bot logged in as YourBot#1234
[INFO] Bot is ready and listening for messages
```

## 🧪 Test Cases

### Test 1: Basic Discord Message Detection

**Objective:** Verify bot receives and logs Discord messages

**Steps:**
1. Post a message in the monitored channel
2. Check logs for message receipt

**Expected Log:**
```
[INFO] New message received {channelId: "...", author: "YourName#1234"}
```

**Pass Criteria:** ✅ Message logged within 1 second

---

### Test 2: Message Processing

**Objective:** Verify product information extraction

**Test Message:**
```
🚨 RESTOCK ALERT

Pokemon Scarlet & Violet Booster Box back in stock!

Retail: $129.99

Grab it here:
https://example.com/affiliate/product

#PokemonTCG #TCGDeals
```

**Expected Log:**
```
[INFO] Processing restock alert {
  product: "Pokemon Scarlet & Violet Booster Box back in stock!",
  price: "$129.99",
  hasLink: true,
  imageCount: 0
}
```

**Pass Criteria:** 
- ✅ Product name extracted correctly
- ✅ Price extracted correctly
- ✅ Link extracted correctly

---

### Test 3: Twitter Posting

**Objective:** Verify tweet posting and formatting

**Steps:**
1. Post test message in Discord
2. Check Twitter account for new tweet
3. Verify tweet format and content

**Expected Tweet:**
```
🚨 Pokemon Scarlet & Violet Booster Box back in stock!

$129.99

https://example.com/affiliate/product

#PokemonTCG #TCGDeals #TCGWatchtower
```

**Expected Log:**
```
[INFO] Posting to Twitter... {textLength: 145, images: 0}
[SUCCESS] Tweet posted successfully {tweetId: "..."}
```

**Pass Criteria:**
- ✅ Tweet posted within 30 seconds
- ✅ Content matches expected format
- ✅ Character count under 280
- ✅ Hashtags included

---

### Test 4: Reddit Posting

**Objective:** Verify Reddit post creation

**Steps:**
1. Post test message in Discord
2. Check subreddit for new post
3. Verify post title and body

**Expected Reddit Post:**

**Title:**
```
Pokemon Scarlet & Violet Booster Box back in stock! - Restock
```

**Body:**
```
**Price:** $129.99

**Link:** https://example.com/affiliate/product

---

*Track more restocks at [TCGWatchtower.com](https://tcgwatchtower.com)*
```

**Expected Log:**
```
[INFO] Posting to r/test... {title: "Pokemon Scarlet & Violet..."}
[SUCCESS] Posted to r/test {postId: "...", url: "..."}
```

**Pass Criteria:**
- ✅ Post created within 60 seconds
- ✅ Title formatted correctly
- ✅ Body contains price and link
- ✅ Post is visible on subreddit

---

### Test 5: Image Handling

**Objective:** Verify images are attached to posts

**Steps:**
1. Post message with image in Discord
2. Verify Twitter post includes image
3. Verify Reddit post includes image

**Expected Log:**
```
[INFO] Downloading image for Twitter {url: "https://..."}
[SUCCESS] Image uploaded to Twitter {mediaId: "..."}
```

**Pass Criteria:**
- ✅ Image downloaded successfully
- ✅ Image attached to Twitter post
- ✅ Image attached to Reddit post

---

### Test 6: Duplicate Detection

**Objective:** Verify duplicate messages are ignored

**Steps:**
1. Post a test message
2. Wait for distribution to complete
3. Post the exact same message again
4. Verify it's detected as duplicate

**Expected Log (second message):**
```
[WARNING] Duplicate message detected {hash: "abc12345", ageMinutes: "0.05"}
[WARNING] Duplicate message ignored
```

**Pass Criteria:**
- ✅ Duplicate detected
- ✅ No second Twitter post
- ✅ No second Reddit post

---

### Test 7: Rate Limiting

**Objective:** Verify rate limiting works correctly

**Steps:**
1. Post 3 different test messages rapidly
2. Verify they're queued and posted with delays

**Expected Log:**
```
[INFO] Tweet added to queue {queueSize: 1}
[INFO] Tweet added to queue {queueSize: 2}
[INFO] Tweet added to queue {queueSize: 3}
[INFO] Rate limit: waiting 5000ms before next tweet
...
[SUCCESS] Tweet posted successfully
[INFO] Rate limit: waiting 5000ms before next tweet
...
```

**Pass Criteria:**
- ✅ Messages queued correctly
- ✅ Rate limit delays applied
- ✅ All messages posted eventually

---

### Test 8: Error Handling - Invalid Message

**Objective:** Verify bot handles invalid messages gracefully

**Test Message:**
```
Hello, this is just a regular message with no product info.
```

**Expected Log:**
```
[WARNING] Invalid product info, skipping distribution
```

**Pass Criteria:**
- ✅ No error thrown
- ✅ No posts created
- ✅ Bot continues running

---

### Test 9: Error Handling - Invalid Credentials

**Objective:** Verify bot handles API errors gracefully

**Steps:**
1. Temporarily set invalid Twitter credentials
2. Restart bot
3. Post test message

**Expected Log:**
```
[ERROR] Twitter credentials INVALID {error: "..."}
[WARNING] Twitter posting is disabled or not initialized
```

**Pass Criteria:**
- ✅ Bot starts despite invalid credentials
- ✅ Error logged clearly
- ✅ Bot continues to monitor Discord

---

### Test 10: Website API Integration

**Objective:** Verify website API receives data

**Steps:**
1. Set up test API endpoint (or use RequestBin)
2. Configure WEBSITE_API_URL
3. Post test message
4. Verify API receives POST request

**Expected Payload:**
```json
{
  "product_name": "Pokemon Scarlet & Violet Booster Box back in stock!",
  "price": "$129.99",
  "affiliate_link": "https://example.com/affiliate/product",
  "image_url": null,
  "timestamp": "2025-03-07T10:30:00.000Z",
  "source_message_id": "...",
  "source_channel_id": "...",
  "raw_content": "..."
}
```

**Pass Criteria:**
- ✅ API receives POST request
- ✅ Payload matches expected format
- ✅ All fields present

---

### Test 11: Health Check Endpoint

**Objective:** Verify health check works

**Steps:**
```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-03-07T10:30:00.000Z",
  "uptime": 123.456,
  "discord": {
    "ready": true,
    "username": "YourBot#1234",
    "monitoredChannels": 1
  },
  "twitter": {
    "enabled": true,
    "initialized": true,
    "queueSize": 0
  },
  ...
}
```

**Pass Criteria:**
- ✅ Endpoint returns 200 OK
- ✅ Status shows healthy
- ✅ All components report correctly

---

### Test 12: Long Message Truncation

**Objective:** Verify long messages are truncated properly

**Test Message:**
```
🚨 RESTOCK ALERT

This is an extremely long product name that goes on and on and on and includes way too much detail about the product including every single feature and specification that makes it incredibly long and probably won't fit in a tweet!

Retail: $999.99

https://example.com/link

#Tag1 #Tag2 #Tag3 #Tag4 #Tag5 #Tag6 #Tag7 #Tag8 #Tag9 #Tag10
```

**Pass Criteria:**
- ✅ Tweet stays under 280 characters
- ✅ Product name truncated with "..."
- ✅ Link preserved
- ✅ At least some hashtags included

---

## 🐛 Common Issues and Solutions

### Bot doesn't start

**Check:**
```bash
# Verify Node.js version
node --version  # Should be 18+

# Check for syntax errors
npm install

# Verify .env file exists
cat .env
```

### Bot doesn't receive messages

**Check:**
- Discord bot has "Message Content Intent" enabled
- Bot is in the server
- Channel ID is correct
- Bot has permission to read the channel

### Twitter posts fail

**Check:**
- Credentials are correct (copy-paste carefully)
- Account has API access enabled
- App permissions include "Read and Write"
- Account is not rate limited

### Reddit posts fail

**Check:**
- Account has enough karma (>10)
- Subreddit allows posts
- Username/password are correct
- App type is "script"

## 📊 Performance Testing

### Memory Usage

Monitor memory over time:

```bash
# In another terminal
watch -n 5 'ps aux | grep node'
```

**Expected:** 100-200MB RAM

### CPU Usage

**Expected:** <5% CPU when idle, spikes during processing

### Response Time

Measure end-to-end latency:

1. Post message in Discord
2. Note timestamp
3. Check when Twitter post appears
4. Calculate difference

**Expected:** <30 seconds from Discord to all platforms

## ✅ Pre-Deployment Checklist

Before deploying to Railway:

- [ ] All test cases passing
- [ ] No errors in logs
- [ ] Twitter credentials verified
- [ ] Reddit credentials verified
- [ ] Duplicate detection working
- [ ] Rate limiting working
- [ ] Health check endpoint responding
- [ ] Memory usage acceptable
- [ ] Error handling working
- [ ] Production credentials ready
- [ ] `.env.example` updated
- [ ] Documentation reviewed

## 🚀 Testing on Railway

After deploying to Railway:

1. **Check deployment logs**
   ```
   Railway Dashboard > Logs
   ```

2. **Verify bot started**
   Look for: `[INFO] Bot is ready and listening for messages`

3. **Test health endpoint**
   ```bash
   curl https://your-app.railway.app/health
   ```

4. **Post test message**
   - Monitor Railway logs in real-time
   - Verify distribution to all platforms

5. **Monitor for 24 hours**
   - Check for memory leaks
   - Verify stable operation
   - Review error logs

## 📝 Test Results Template

Use this template to document test results:

```markdown
# Test Results - [Date]

## Environment
- Node.js version: 18.x
- Discord.js version: 14.14.1
- Test duration: 2 hours

## Test Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| Discord Detection | ✅ Pass | Messages received instantly |
| Message Processing | ✅ Pass | All fields extracted correctly |
| Twitter Posting | ✅ Pass | Posted within 10s |
| Reddit Posting | ✅ Pass | Posted within 20s |
| Image Handling | ✅ Pass | Images attached successfully |
| Duplicate Detection | ✅ Pass | Duplicates blocked |
| Rate Limiting | ✅ Pass | Delays applied correctly |
| Error Handling | ✅ Pass | No crashes |

## Issues Found
- None

## Performance Metrics
- Average response time: 12s
- Memory usage: 150MB
- CPU usage: 2-3%

## Recommendations
- Ready for production deployment
```

---

**Testing complete? Deploy to Railway! 🚀**
