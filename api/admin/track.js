// api/admin/track.js
// Called on portfolio page load to record activity.
// DAU/WAU/MAU use date-scoped keys so they auto-expire and reflect current period.

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvIncr(key, ttl) {
  // Increment; if first time this key exists, also set TTL
  await fetch(`${KV_URL}/incr/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (ttl) {
    await fetch(`${KV_URL}/expire/${encodeURIComponent(key)}/${ttl}`, {
      method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  }
}

async function kvSetEx(key, value, ttl) {
  await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
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
    const userId = body?.userId;
    if (!userId || userId === 'anonymous') return res.status(200).json({ ok: true });

    const now   = new Date();
    const today = now.toISOString().slice(0, 10);                          // 2026-06-14
    const week  = `${now.getFullYear()}-W${String(Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)).padStart(2,'0')}`;
    const month = now.toISOString().slice(0, 7);                           // 2026-06

    // Per-user dedup keys with auto-expiry
    const dauUserKey = `stats:dau_user:${today}:${userId}`;
    const wauUserKey = `stats:wau_user:${week}:${userId}`;
    const mauUserKey = `stats:mau_user:${month}:${userId}`;

    const [seenDay, seenWeek, seenMonth] = await Promise.all([
      kvExists(dauUserKey),
      kvExists(wauUserKey),
      kvExists(mauUserKey),
    ]);

    // Date-scoped aggregate counters — auto-expire so they reset each period
    await Promise.all([
      !seenDay   && kvSetEx(dauUserKey, '1', 90000).then(() =>   // 25h TTL
        kvIncr(`stats:dau:${today}`, 90000)),
      !seenWeek  && kvSetEx(wauUserKey, '1', 691200).then(() =>  // 8d TTL
        kvIncr(`stats:wau:${week}`, 691200)),
      !seenMonth && kvSetEx(mauUserKey, '1', 2678400).then(() => // 31d TTL
        kvIncr(`stats:mau:${month}`, 2678400)),
    ].filter(Boolean));

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
