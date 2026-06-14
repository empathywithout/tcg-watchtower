// api/admin/stats.js
import { verifySession } from '../auth/_verify.js';

const OWNER_ID = '397593147397636099';
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(path, opts = {}) {
  const res = await fetch(`${KV_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${KV_TOKEN}`, ...(opts.headers||{}) },
  });
  if (!res.ok) throw new Error(`KV ${res.status} ${path}`);
  return res.json();
}

async function kvGet(key) {
  const { result } = await kv(`/get/${encodeURIComponent(key)}`);
  return result ?? null;
}

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

  const user = await verifySession(req);
  if (!user || user.id !== OWNER_ID) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const now      = Date.now();
    const day7ago  = now - 7  * 24 * 60 * 60 * 1000;
    const day30ago = now - 30 * 24 * 60 * 60 * 1000;

    // Scan ALL portfolio keys — Discord (digits) and Google (g_...)
    const allKeys  = await kvScan('portfolio:*');
    // Exclude sub-keys that aren't user portfolios
    const userKeys = allKeys.filter(k => /^portfolio:(\d+|g_[a-zA-Z0-9_]+)$/.test(k));

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

    const totalUsers  = portfolios.length;
    const active7d    = portfolios.filter(p => p.updatedAt >= day7ago).length;
    const active30d   = portfolios.filter(p => p.updatedAt >= day30ago).length;
    const withCards   = portfolios.filter(p => (p.cards||[]).length > 0).length;

    const totalCards  = portfolios.reduce((s, p) => s + (p.cards||[]).reduce((a, c) => a + (c.qty||1), 0), 0);
    const avgCards    = totalUsers > 0 ? (totalCards / totalUsers).toFixed(1) : 0;

    // Top sets
    const setCounts = {};
    portfolios.forEach(p => {
      (p.cards||[]).forEach(c => {
        if (c.setId) setCounts[c.setId] = (setCounts[c.setId]||0) + (c.qty||1);
      });
    });
    const topSets = Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([setId, count]) => ({ setId, count }));

    // Auth breakdown
    const discordUsers = portfolios.filter(p => /^\d+$/.test(p.userId)).length;
    const googleUsers  = portfolios.filter(p => p.userId.startsWith('g_')).length;

    // Activity — use date-scoped keys that auto-reset each period
    const now2  = new Date();
    const today = now2.toISOString().slice(0,10);
    const week  = `${now2.getFullYear()}-W${String(Math.ceil((now2.getDate() + new Date(now2.getFullYear(), now2.getMonth(), 1).getDay()) / 7)).padStart(2,'0')}`;
    const month = now2.toISOString().slice(0,7);
    const [dau, wau, mau] = await Promise.all([
      kvGet(`stats:dau:${today}`).then(v => parseInt(v||0)),
      kvGet(`stats:wau:${week}`).then(v => parseInt(v||0)),
      kvGet(`stats:mau:${month}`).then(v => parseInt(v||0)),
    ]);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      users: { total: totalUsers, active7d, active30d, withCards, empty: totalUsers - withCards, discord: discordUsers, google: googleUsers },
      engagement: { totalCards, avgCardsPerUser: parseFloat(avgCards), dau, wau, mau },
      topSets,
    });

  } catch (e) {
    console.error('[admin/stats]', e);
    return res.status(500).json({ error: e.message });
  }
}
