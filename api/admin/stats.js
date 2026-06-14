// api/admin/stats.js
// Portfolio admin stats — protected by ADMIN_SECRET env var

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

async function kv(path, opts = {}) {
  const res = await fetch(`${KV_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain', ...(opts.headers||{}) },
  });
  if (!res.ok) throw new Error(`KV ${res.status} ${path}`);
  return res.json();
}

async function kvGet(key) {
  const { result } = await kv(`/get/${encodeURIComponent(key)}`);
  return result ?? null;
}

async function kvSet(key, value) {
  await kv(`/set/${encodeURIComponent(key)}`, { method: 'POST', body: String(value) });
}

async function kvIncr(key) {
  const { result } = await kv(`/incr/${encodeURIComponent(key)}`);
  return result;
}

// Scan keys matching a pattern (Upstash supports SCAN via REST)
async function kvScan(match, count = 100) {
  let cursor = 0;
  const keys = [];
  do {
    const { result } = await kv(`/scan/${cursor}?match=${encodeURIComponent(match)}&count=${count}`);
    cursor = parseInt(result[0]);
    keys.push(...(result[1] || []));
  } while (cursor !== 0);
  return keys;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: check secret in header or query
  const secret = req.headers['x-admin-secret'] || req.query.secret || '';
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = Date.now();
    const day7ago  = now - 7  * 24 * 60 * 60 * 1000;
    const day30ago = now - 30 * 24 * 60 * 60 * 1000;

    // ── 1. Scan all portfolio keys ─────────────────────────────────────
    const portfolioKeys = await kvScan('portfolio:*');
    // Filter out meta keys
    const userKeys = portfolioKeys.filter(k => /^portfolio:[0-9]+$/.test(k));

    // ── 2. Fetch all portfolios in parallel (batched) ──────────────────
    const BATCH = 20;
    const portfolios = [];
    for (let i = 0; i < userKeys.length; i += BATCH) {
      const batch = userKeys.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async k => {
        try {
          const raw = await kvGet(k);
          if (!raw) return null;
          const p = JSON.parse(raw);
          return { userId: k.replace('portfolio:', ''), ...p };
        } catch { return null; }
      }));
      portfolios.push(...results.filter(Boolean));
    }

    // ── 3. Compute metrics ─────────────────────────────────────────────
    const totalUsers    = portfolios.length;
    const newUsers7d    = portfolios.filter(p => p.updatedAt >= day7ago).length;
    const newUsers30d   = portfolios.filter(p => p.updatedAt >= day30ago).length;

    // Cards stats
    const cardCounts    = portfolios.map(p => (p.cards || []).reduce((s, c) => s + (c.qty||1), 0));
    const totalCards    = cardCounts.reduce((s, n) => s + n, 0);
    const avgCards      = totalUsers > 0 ? (totalCards / totalUsers).toFixed(1) : 0;
    const nonEmpty      = portfolios.filter(p => (p.cards||[]).length > 0).length;

    // Top sets
    const setCounts = {};
    portfolios.forEach(p => {
      (p.cards || []).forEach(c => {
        if (c.setId) setCounts[c.setId] = (setCounts[c.setId] || 0) + (c.qty||1);
      });
    });
    const topSets = Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([setId, count]) => ({ setId, count }));

    // Activity counters (tracked separately via /api/admin/track)
    const [dau, wau, mau, totalLogins] = await Promise.all([
      kvGet('stats:dau').then(v => parseInt(v||0)),
      kvGet('stats:wau').then(v => parseInt(v||0)),
      kvGet('stats:mau').then(v => parseInt(v||0)),
      kvGet('stats:total_logins').then(v => parseInt(v||0)),
    ]);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      users: {
        total:      totalUsers,
        new7d:      newUsers7d,
        new30d:     newUsers30d,
        withCards:  nonEmpty,
        empty:      totalUsers - nonEmpty,
      },
      engagement: {
        totalCards,
        avgCardsPerUser:    parseFloat(avgCards),
        dau,
        wau,
        mau,
        totalLogins,
      },
      topSets,
    });

  } catch (e) {
    console.error('[admin/stats]', e);
    return res.status(500).json({ error: e.message });
  }
}
