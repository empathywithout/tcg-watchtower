// api/admin/bust-cache.js
// One-time cache bust for scrydex:cards:* keys — owner only

import { verifySession } from '../auth/_verify.js';

const OWNER_ID = '397593147397636099';
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvDel(key) {
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

async function kvScan(match) {
  let cursor = 0;
  const keys = [];
  do {
    const res = await fetch(`${KV_URL}/scan/${cursor}?match=${encodeURIComponent(match)}&count=100`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const { result } = await res.json();
    cursor = parseInt(result[0]);
    keys.push(...(result[1] || []));
  } while (cursor !== 0);
  return keys;
}

export default async function handler(req, res) {
  const user = await verifySession(req);
  if (!user || user.id !== OWNER_ID) return res.status(401).json({ error: 'Unauthorized' });

  const pattern = req.query.pattern || 'scrydex:cards:*';
  const keys = await kvScan(pattern);
  await Promise.all(keys.map(k => kvDel(k)));
  return res.status(200).json({ deleted: keys.length, keys });
}
