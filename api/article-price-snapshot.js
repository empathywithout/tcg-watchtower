// api/article-price-snapshot.js
// Stores and retrieves price snapshots for article trend tracking.
//
// Daily snapshots expire after 25h (yesterday comparison).
// Weekly snapshots are permanent — stored indefinitely for long-term trend analysis.
//
// GET  /api/article-price-snapshot?groupId=24688
//   Returns:
//   {
//     yesterday: { "116": 310.00, ... } | null,
//     weeks: {
//       "2026-W30": { "116": 320.00, ... },
//       "2026-W28": { "116": 355.00, ... },
//       ...
//     },
//     weekCount: 4
//   }
//
// POST /api/article-price-snapshot?groupId=24688
//   Body: { prices: { "116": 307.00, ... } }
//   Writes daily snapshot (25h TTL) + weekly snapshot (permanent, only if none exists this week).
//   Returns { ok: true, date, week, wroteWeekly }

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const DAILY_TTL_SEC  = 25 * 60 * 60;      // 25 hours
const WEEKLY_TTL_SEC = 365 * 24 * 60 * 60; // 1 year

// ISO week string e.g. "2026-W30"
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

function todayKey(groupId) {
  const d = new Date().toISOString().slice(0, 10);
  return `article-prices:${groupId}:day:${d}`;
}
function yesterdayKey(groupId) {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `article-prices:${groupId}:day:${d}`;
}
function weekKey(groupId, week) {
  return `article-prices:${groupId}:week:${week}`;
}
// Index key — list of weeks we have stored, comma-separated
function weekIndexKey(groupId) {
  return `article-prices:${groupId}:week-index`;
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
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const res = await fetch(
      `${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } }
    );
    return res.ok;
  } catch { return false; }
}

// Set without TTL (permanent)
async function redisSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const res = await fetch(
      `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
      { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` } }
    );
    return res.ok;
  } catch { return false; }
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
    // Fetch yesterday + all weekly snapshots in parallel
    const indexRaw = await redisGet(weekIndexKey(groupId));
    const weekList = Array.isArray(indexRaw) ? indexRaw : [];

    const [yesterday, ...weekSnapshots] = await Promise.all([
      redisGet(yesterdayKey(groupId)),
      ...weekList.map(w => redisGet(weekKey(groupId, w)))
    ]);

    // Build weeks map { "2026-W30": { prices }, ... }
    const weeks = {};
    weekList.forEach((w, i) => {
      if (weekSnapshots[i]) weeks[w] = weekSnapshots[i];
    });

    return res.status(200).json({
      yesterday: yesterday || null,
      weeks,
      weekCount: weekList.length
    });
  }

  if (req.method === 'POST') {
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
    const week = isoWeek();

    // Always write daily snapshot
    await redisSetEx(todayKey(groupId), prices, DAILY_TTL_SEC);

    // Write weekly snapshot only if this week doesn't exist yet
    let wroteWeekly = false;
    const existingWeek = await redisGet(weekKey(groupId, week));
    if (!existingWeek) {
      await redisSet(weekKey(groupId, week), prices);
      // Update the week index
      const indexRaw = await redisGet(weekIndexKey(groupId));
      const weekList = Array.isArray(indexRaw) ? indexRaw : [];
      if (!weekList.includes(week)) {
        weekList.unshift(week); // newest first
        // Keep max 52 weeks
        const trimmed = weekList.slice(0, 52);
        await redisSet(weekIndexKey(groupId), trimmed);
      }
      wroteWeekly = true;
    }

    return res.status(200).json({ ok: true, date, week, wroteWeekly });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
