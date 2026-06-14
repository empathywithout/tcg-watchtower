// api/admin/track.js
// Called on portfolio page load to record DAU/WAU/MAU
// No auth required — just increments counters

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvIncr(key) {
  await fetch(`${KV_URL}/incr/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}
async function kvSetEx(key, value, ttl) {
  await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
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

    await kvIncr('stats:total_logins');

    const today = new Date().toISOString().slice(0,10);
    const week  = Math.floor(Date.now() / (7 * 86400000));
    const month = new Date().toISOString().slice(0,7);

    const [seenToday, seenWeek, seenMonth] = await Promise.all([
      kvExists(`stats:dau_user:${userId}:${today}`),
      kvExists(`stats:wau_user:${userId}:${week}`),
      kvExists(`stats:mau_user:${userId}:${month}`),
    ]);

    await Promise.all([
      !seenToday && kvSetEx(`stats:dau_user:${userId}:${today}`, '1', 86400).then(() => kvIncr('stats:dau')),
      !seenWeek  && kvSetEx(`stats:wau_user:${userId}:${week}`,  '1', 604800).then(() => kvIncr('stats:wau')),
      !seenMonth && kvSetEx(`stats:mau_user:${userId}:${month}`, '1', 2592000).then(() => kvIncr('stats:mau')),
    ].filter(Boolean));

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false }); // silent fail
  }
}
