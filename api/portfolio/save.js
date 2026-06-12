// api/portfolio/save.js
import { verifySession } from '../auth/_verify.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const user = await verifySession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { cards, merge } = body;
    if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards must be array' });

    let finalCards = sanitize(cards);

    // merge=true: called on Discord login to merge localStorage into cloud
    if (merge) {
      const existing = await redisGetParsed(`portfolio:${user.id}`);
      const cloud = existing?.cards || [];
      // Merge: cloud wins on conflicts (same setId+localId), local adds new entries
      const cloudKeys = new Set(cloud.map(c => `${c.setId}:${c.localId}`));
      const newLocal  = finalCards.filter(c => !cloudKeys.has(`${c.setId}:${c.localId}`));
      finalCards = [...cloud, ...newLocal];
    }

    await redisSet(`portfolio:${user.id}`, JSON.stringify({
      cards:     finalCards,
      updatedAt: Date.now(),
    }));

    res.status(200).json({ ok: true, count: finalCards.length });
  } catch (e) {
    console.error('Portfolio save error:', e);
    res.status(500).json({ error: 'Failed to save portfolio' });
  }
}

function sanitize(cards) {
  return cards.map(c => {
    const out = {
      setId:     String(c.setId     || ''),
      localId:   String(c.localId   || ''),
      name:      String(c.name      || ''),
      rarity:    String(c.rarity    || ''),
      image:     String(c.image     || ''),
      qty:       Math.max(1, parseInt(c.qty) || 1),
      condition: ['NM','LP','MP','HP','DMG'].includes(c.condition) ? c.condition : 'NM',
      addedAt:   c.addedAt || Date.now(),
    };
    if (c.graded && c.graded.company && c.graded.grade) {
      out.graded = {
        company: String(c.graded.company),
        grade:   String(c.graded.grade),
      };
    }
    return out;
  });
}

// Fetch + parse the stored portfolio JSON
async function redisGetParsed(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Redis GET failed: ${res.status}`);
  const { result } = await res.json();
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

// Upstash REST API: POST body IS the value (raw string), not wrapped in JSON
async function redisSet(key, value) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: value, // raw JSON string — Upstash stores this directly
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${res.status}`);
}
