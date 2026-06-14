// api/scrydex-sets.js
// Returns all EN Pokémon TCG expansions from Scrydex for portfolio set picker
// Cached 24h in Redis — set lists don't change often

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const KV_URL          = process.env.KV_REST_API_URL;
const KV_TOKEN        = process.env.KV_REST_API_TOKEN;
const CACHE_KEY       = 'scrydex:expansions:en';
const CACHE_TTL       = 24 * 60 * 60; // 24h

async function redisGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ?? null;
  } catch { return null; }
}

async function redisSetEx(key, value, ttl) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check Redis cache
  const cached = await redisGet(CACHE_KEY);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(JSON.parse(cached));
  }

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  try {
    // Fetch all pages of expansions
    let allSets = [], page = 1;
    while (true) {
      const scrydexRes = await fetch(
        `${SCRYDEX_BASE}/expansions?page_size=100&page=${page}&select=id,name,series,release_date,language_code`,
        { headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID }, signal: AbortSignal.timeout(10000) }
      );
      if (!scrydexRes.ok) throw new Error(`Scrydex ${scrydexRes.status}`);
      const data = await scrydexRes.json();
      const rows = (data.data || []).filter(e => e.language_code === 'EN' && !e.id.startsWith('tcgp'));
      allSets = allSets.concat(rows);
      if ((data.data || []).length < 100) break;
      page++;
    }

    // Sort newest first
    allSets.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));

    const result = {
      sets: allSets.map(e => ({
        id:          e.id,
        name:        e.name,
        series:      e.series,
        releaseDate: e.release_date,
      })),
      total: allSets.length,
    };

    await redisSetEx(CACHE_KEY, JSON.stringify(result), CACHE_TTL);
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);
  } catch (e) {
    console.error('[scrydex-sets]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
