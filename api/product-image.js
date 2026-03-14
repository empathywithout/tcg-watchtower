// api/product-image.js
// Fetches clean sealed product images from eBay, proxied through our domain.
// Filters for NEW condition items and scores by title relevance to get stock photos.
// GET /api/product-image?q=Pokemon+Scarlet+Violet+Booster+Box

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getEbayToken() {
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('eBay credentials not configured');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay auth: ${res.status}`);
  return (await res.json()).access_token;
}

async function findProductImage(query) {
  const token = await getEbayToken();

  // Search sealed TCG products (183468), NEW condition only, sorted by Best Match
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search`
    + `?q=${encodeURIComponent(query)}`
    + `&limit=20`
    + `&filter=conditions:NEW,categoryIds:183468`
    + `&sort=bestMatch`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay search: ${res.status}`);

  const items = (await res.json()).itemSummaries || [];
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Score each item: more query words in title = better match
  // Also prefer items with thumbnailImages (usually stock photos from catalog)
  const scored = items
    .map(item => {
      const title = (item.title || '').toLowerCase();
      const wordScore = words.filter(w => title.includes(w)).length;
      const hasThumb = !!(item.thumbnailImages?.[0]?.imageUrl);
      const imgUrl = item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl;
      return { wordScore, hasThumb, imgUrl };
    })
    .filter(x => x.imgUrl)
    .sort((a, b) => {
      // Prefer thumbnail (stock photo) over regular image
      if (a.hasThumb !== b.hasThumb) return a.hasThumb ? -1 : 1;
      return b.wordScore - a.wordScore;
    });

  if (!scored.length) throw new Error('no results');
  return scored[0].imgUrl;
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
    const imgUrl = await findProductImage(q);
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) throw new Error(`proxy: ${imgRes.status}`);

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
