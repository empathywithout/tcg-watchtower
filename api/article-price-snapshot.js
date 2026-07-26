// api/article-price-snapshot.js
// Stores and retrieves daily price snapshots for article trend tracking.
//
// GET  /api/article-price-snapshot?groupId=24688
//   Returns yesterday's snapshot: { snapshot: { "116": 310.00, ... }, date: "2026-07-25" }
//   Returns null snapshot if none exists yet.
//
// POST /api/article-price-snapshot?groupId=24688
//   Body: { prices: { "116": 307.00, ... } }
//   Writes today's prices to Redis with 25h TTL so yesterday's is always available.
//   Returns { ok: true, date: "2026-07-26" }

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL_SEC  = 25 * 60 * 60; // 25 hours — ensures yesterday always exists

function todayKey(groupId) {
  const d = new Date().toISOString().slice(0, 10); // "2026-07-26"
  return `article-prices:${groupId}:${d}`;
}

function yesterdayKey(groupId) {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `article-prices:${groupId}:${d}`;
}

async function redisGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

async function redisSetEx(key, value, ttl) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(JSON.stringify(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { groupId } = req.query;
  if (!groupId || !/^\d+$/.test(groupId)) {
    return res.status(400).json({ error: 'Missing or invalid ?groupId=' });
  }

  if (req.method === 'GET') {
    // Return yesterday's snapshot for trend comparison
    const snapshot = await redisGet(yesterdayKey(groupId));
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return res.status(200).json({ snapshot: snapshot || null, date });
  }

  if (req.method === 'POST') {
    // Store today's prices — called after live prices are fetched
    let body = req.body;
    if (!body && req.headers['content-type']?.includes('application/json')) {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const { prices } = body || {};
    if (!prices || typeof prices !== 'object') {
      return res.status(400).json({ error: 'Missing prices object in body' });
    }
    const date = new Date().toISOString().slice(0, 10);
    await redisSetEx(todayKey(groupId), prices, TTL_SEC);
    return res.status(200).json({ ok: true, date });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
