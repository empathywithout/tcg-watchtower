// api/admin/track.js
// Called on portfolio page load to record activity metrics
// Lightweight — just increments Redis counters

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvIncr(key) {
  await fetch(`${KV_URL}/incr/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvSetEx(key, value, ttlSeconds) {
  await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttlSeconds}/${encodeURIComponent(value)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvExists(key) {
  const res = await fetch(`${KV_URL}/exists/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const { result } = await res.json();
  return result === 1;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body   = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const userId = body?.userId || 'anonymous';

    // Total logins
    await kvIncr('stats:total_logins');

    // DAU — unique users today (TTL 24h)
    const dauKey = `stats:dau_user:${userId}:${new Date().toISOString().slice(0,10)}`;
    const seenToday = await kvExists(dauKey);
    if (!seenToday) {
      await kvSetEx(dauKey, '1', 86400);
      await kvIncr('stats:dau');
    }

    // WAU — unique users this week (TTL 7d)
    const week = Math.floor(Date.now() / (7 * 86400000));
    const wauKey = `stats:wau_user:${userId}:${week}`;
    const seenThisWeek = await kvExists(wauKey);
    if (!seenThisWeek) {
      await kvSetEx(wauKey, '1', 604800);
      await kvIncr('stats:wau');
    }

    // MAU — unique users this month (TTL 30d)
    const month = new Date().toISOString().slice(0,7);
    const mauKey = `stats:mau_user:${userId}:${month}`;
    const seenThisMonth = await kvExists(mauKey);
    if (!seenThisMonth) {
      await kvSetEx(mauKey, '1', 2592000);
      await kvIncr('stats:mau');
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[admin/track]', e);
    return res.status(200).json({ ok: false }); // silent fail — don't break portfolio
  }
}
