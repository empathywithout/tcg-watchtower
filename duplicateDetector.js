const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { config } = require('./config');

/**
 * Result shapes returned by checkAndRecord():
 *
 *   { action: 'post'    }  — Never seen before. Post normally.
 *   { action: 'suppress'}  — Same product+retailer+channel within suppressWindow. Drop silently.
 *   { action: 'restock' }  — Past suppressWindow but within restockWindow. Post with note.
 *
 * The key is: channelId + normalised product name + retailer (from embed footer).
 * Target vs Walmart = different keys = both always post independently.
 *
 * PERSISTENCE: Cache is saved to disk on every write so it survives bot restarts,
 * crashes, and redeploys. Without this, a restart during an active restock window
 * causes the bot to re-post the same product as if it were brand new.
 */

const CACHE_FILE = path.join(__dirname, '.duplicate-cache.json');

class DuplicateDetector {
  constructor() {
    this.cache = new Map();
    this.loadFromDisk();
    this.startCleanupInterval();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  loadFromDisk() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const entries = JSON.parse(raw);
        for (const [key, entry] of entries) {
          this.cache.set(key, entry);
        }
        logger.info(`Duplicate cache loaded from disk (${this.cache.size} entries)`);
        this._purgeExpired(); // Drop anything already past restockWindow
      } else {
        logger.debug('No duplicate cache file found — starting fresh');
      }
    } catch (err) {
      logger.warning('Could not load duplicate cache from disk — starting fresh', {
        error: err.message,
      });
      this.cache = new Map();
    }
  }

  saveToDisk() {
    try {
      const entries = Array.from(this.cache.entries());
      const tmp = CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(entries), 'utf8');
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      logger.warning('Could not save duplicate cache to disk', { error: err.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Key building
  // ---------------------------------------------------------------------------

  buildKey(channelId, productName, source) {
    const normName = (productName || '')
      .toLowerCase()
      .replace(/\[<@&\d+>\]/g, '')
      .replace(/\(ping id: \d+\)/gi, '')
      .replace(/@?\s*\$[\d.,]+/g, '')
      .replace(/item restocked|restock alert/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const normSource = (source || '').toLowerCase().trim();
    const raw = `${channelId}|${normName}|${normSource}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Core check
  // ---------------------------------------------------------------------------

  checkAndRecord(channelId, productName, source) {
    const key = this.buildKey(channelId, productName, source);
    const now = Date.now();

    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      const ageSinceLast  = now - entry.lastSeen;
      const ageSinceFirst = now - entry.firstSeen;

      if (ageSinceLast < config.suppressWindow) {
        logger.warning('Duplicate suppressed', {
          product: (productName || '').substring(0, 50),
          channel: channelId,
          ageSinceLastMinutes: (ageSinceLast / 60000).toFixed(1),
        });
        return { action: 'suppress' };
      }

      if (config.restockWindow > 0 && ageSinceFirst < config.restockWindow) {
        entry.lastSeen = now;
        entry.postCount += 1;
        this.saveToDisk();
        logger.info('Restock repeat — posting with still-restocking note', {
          product: (productName || '').substring(0, 50),
          postCount: entry.postCount,
        });
        return { action: 'restock' };
      }

      this.cache.delete(key);
    }

    this.cache.set(key, { firstSeen: now, lastSeen: now, postCount: 1 });
    this.saveToDisk();
    logger.debug('New product recorded', {
      product: (productName || '').substring(0, 50),
      channel: channelId,
      key: key.substring(0, 8),
    });
    return { action: 'post' };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  _purgeExpired() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.firstSeen > config.restockWindow) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  startCleanupInterval() {
    setInterval(() => {
      const cleaned = this._purgeExpired();
      if (cleaned > 0) {
        logger.debug(`Cleaned ${cleaned} expired entries from duplicate cache`);
        this.saveToDisk();
      }
    }, 60_000);
  }

  getStats() {
    return {
      cacheSize: this.cache.size,
      suppressWindowMinutes: config.suppressWindow / 60000,
      restockWindowMinutes: config.restockWindow / 60000,
      cacheFile: CACHE_FILE,
    };
  }
}

module.exports = new DuplicateDetector();
