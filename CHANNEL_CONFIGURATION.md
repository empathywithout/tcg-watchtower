# Channel Configuration Guide

Complete guide for configuring which Discord channels your bot monitors.

---

## 📺 Channel Configuration via Railway Variables

All channel configuration is done through **Railway Environment Variables** - no code changes needed!

---

## 🔧 Required Variables

### 1. MONITORED_CHANNELS

**What it does:** List of Discord channel IDs the bot monitors for restock alerts.

**Format:** Comma-separated channel IDs (no spaces, no quotes)

**Example:**
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1464252881992679424
```

**How to get channel IDs:**
1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click the channel name
3. Click "Copy Channel ID"
4. Paste the ID into the variable

---

## 🎯 Your Current Channels

Based on your Discord server, here are your restock channels:

| Channel Name | Channel ID | Purpose |
|--------------|-----------|---------|
| 🎯│target | `1392194562960789524` | Target restocks |
| 🛒│amazon | `1392194487123709992` | Amazon restocks |
| 🪄│magic-the-gathering | `1464252881992679424` | MTG restocks |
| 📦│tcg-gear | `1406466931724128389` | TCG accessories |
| 🏪│pokemon-center | `1392194609169305641` | Pokemon Center (queue alerts) |

---

## ⚙️ Setting Up in Railway

### Step 1: Add MONITORED_CHANNELS

**In Railway Dashboard:**

1. Go to your service
2. Click **"Variables"** tab
3. Find `MONITORED_CHANNELS` (or click "New Variable")
4. Set value to:

```
1392194562960789524,1392194487123709992,1464252881992679424,1406466931724128389,1392194609169305641
```

**This monitors all 5 channels!**

---

### Step 2: Add POKEMON_CENTER_CHANNEL_ID (Optional)

**What it does:** Enables special queue alerts for Pokemon Center

**In Railway Dashboard:**

1. Click "New Variable"
2. Variable name: `POKEMON_CENTER_CHANNEL_ID`
3. Value: `1392194609169305641`
4. Save

**This enables special "Queue is Live!" tweets when security/queue messages appear.**

---

## 🎛️ Configuration Examples

### Monitor All Channels
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1464252881992679424,1406466931724128389,1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```

**Result:** All restock alerts + Pokemon Center queue alerts

---

### Monitor Only Target & Amazon
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992
```

**Result:** Only posts Target and Amazon restocks

---

### Monitor Only Pokemon Center
```
MONITORED_CHANNELS=1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```

**Result:** Only Pokemon Center products + queue alerts

---

### Monitor Everything Except MTG
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1406466931724128389,1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```

**Result:** All channels except Magic the Gathering

---

## 🚨 Pokemon Center Queue Alerts

### How It Works:

**When `POKEMON_CENTER_CHANNEL_ID` is set:**

1. **Queue keywords detected** (queue, security, waiting room)
2. **Special tweet posts:**
   ```
   🚨 POKEMON CENTER QUEUE IS LIVE!
   
   The Pokemon Center waiting room/security queue is now active!
   
   Get ready to purchase!
   
   🔗 https://www.pokemoncenter.com
   
   #PokemonCenter #TCGDeals #Queue
   ```

3. **Normal products still post** with regular format

**Without `POKEMON_CENTER_CHANNEL_ID`:**
- Pokemon Center channel still monitored
- Products post normally
- Queue messages are ignored (no special alert)

---

## 🔄 Adding New Channels

### Step 1: Get Channel ID

1. In Discord, right-click the new channel
2. Copy Channel ID
3. Example: `9999999999999999999`

### Step 2: Update Railway Variable

**Current value:**
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992
```

**Add new channel:**
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,9999999999999999999
```

### Step 3: Save

Bot automatically restarts and monitors the new channel!

---

## ❌ Removing Channels

### Remove a Channel:

**Current:**
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1464252881992679424
```

**Remove MTG channel (middle one):**
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992
```

Just delete the channel ID and its comma!

---

## ✅ Validation Checklist

After updating channels, verify:

- [ ] Channel IDs are 18-19 digits long
- [ ] IDs are separated by commas (no spaces)
- [ ] No quotes around IDs
- [ ] No spaces in the variable value
- [ ] Bot restarted after changes
- [ ] Test message posts in each monitored channel

---

## 🧪 Testing

### Test Each Channel:

1. Post a test message in the channel
2. Check Railway logs:
   ```
   [INFO] Message received {channel: "🎯│target", author: "..."}
   [INFO] Processing restock
   ```

3. If you see "Channel not monitored":
   ```
   [DEBUG] Channel not monitored {channelId: "1234...", monitoredChannels: [...]}
   ```
   → Channel ID doesn't match, check your variable!

---

## 🔍 Troubleshooting

### Bot isn't detecting messages in a channel:

**Check 1: Is channel in MONITORED_CHANNELS?**
```bash
# Copy the channel ID from Discord
# Search for it in your MONITORED_CHANNELS variable
# If not there, add it
```

**Check 2: Is the ID correct?**
```bash
# IDs should be 18-19 digits
# Example: 1392194562960789524 ✅
# Example: 139219456296 ❌ (too short)
```

**Check 3: Are there extra spaces?**
```bash
# Wrong: 1234, 5678, 9012
# Right: 1234,5678,9012
```

**Check 4: Did bot restart?**
```bash
# Railway auto-restarts when you update variables
# Check logs for "Application started successfully"
```

---

## 📊 Common Configurations

### Scenario 1: Pokemon TCG Only
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```
Target + Amazon + Pokemon Center

---

### Scenario 2: All Trading Card Games
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1464252881992679424,1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```
Target + Amazon + MTG + Pokemon Center

---

### Scenario 3: Everything
```
MONITORED_CHANNELS=1392194562960789524,1392194487123709992,1464252881992679424,1406466931724128389,1392194609169305641
POKEMON_CENTER_CHANNEL_ID=1392194609169305641
```
All channels monitored

---

## 🎯 Quick Reference

**Copy-paste ready configurations:**

### All 5 Channels (Recommended):
```
Variable: MONITORED_CHANNELS
Value: 1392194562960789524,1392194487123709992,1464252881992679424,1406466931724128389,1392194609169305641

Variable: POKEMON_CENTER_CHANNEL_ID
Value: 1392194609169305641
```

### Just Pokemon Channels:
```
Variable: MONITORED_CHANNELS
Value: 1392194562960789524,1392194487123709992,1392194609169305641

Variable: POKEMON_CENTER_CHANNEL_ID
Value: 1392194609169305641
```

---

## 💡 Pro Tips

1. **Start with one channel** to test, then add more
2. **Use DEBUG=true** to see which channels receive messages
3. **Monitor logs** after adding channels to verify detection
4. **Keep a backup** of your channel list somewhere safe
5. **Document** which channel ID corresponds to which channel name

---

## 🔐 Security Note

Channel IDs are **not sensitive** - they're just identifiers. It's safe to:
- Share them in documentation
- Store them in variables
- Include them in GitHub (they're public anyway)

What you should **NOT** share:
- Discord bot token
- Twitter API keys
- Reddit credentials

---

**Need to add or remove channels? Just update the Railway variable and you're done!** ✅
