// api/portfolio/get.js
import { verifySession } from '../auth/_verify.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifySession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const data = await redisGet(`portfolio:${user.id}`);
    res.status(200).json(data ? JSON.parse(data) : { cards: [] });
  } catch (e) {
    console.error('Portfolio get error:', e);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
}

async function redisGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Redis GET failed: ${res.status}`);
  const { result } = await res.json();
  return result ?? null;
}
