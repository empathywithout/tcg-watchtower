// api/product-image.js
// Fetches TCGplayer sealed product images by searching their catalog.
// Used as fallback for auto-generated pages that don't have hardcoded image URLs.
// GET /api/product-image?q=Pokemon+Scarlet+Violet+Booster+Box

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function findTCGPlayerProductId(query) {
  // Use TCGCSV's product search — it mirrors TCGplayer's catalog including sealed products
  // Search across all Pokemon groups for sealed products matching our query
  const words = query.toLowerCase().replace(/pokemon\s*/i, '').trim();
  
  // Try TCGplayer's own search API (no auth needed for public search)
  const url = `https://api.tcgplayer.com/catalog/search?q=${encodeURIComponent(query)}&productLineName=pokemon&productTypeName=Sealed+Products&limit=5`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TCGplayer search: ${res.status}`);
  const data = await res.json();
  const results = data.results || [];
  if (!results.length) throw new Error('no results');
  return results[0].productId;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q || q.trim().length < 3) return res.status(400).json({ error: 'Missing ?q=' });

  const cacheKey = q.toLowerCase().trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(cached.buffer);
  }

  try {
    const productId = await findTCGPlayerProductId(q);
    const imgUrl = `https://product-images.tcgplayer.com/fit-in/437x437/${productId}.jpg`;

    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) throw new Error(`image fetch: ${imgRes.status}`);

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (!contentType.startsWith('image/') || buffer.length < 1000) throw new Error('bad image');

    cache.set(cacheKey, { buffer, contentType, ts: Date.now() });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error(`product-image "${q}":`, err.message);
    const transparent = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(transparent);
  }
}
