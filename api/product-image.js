// api/product-image.js
// Fetches a sealed product image from eBay Browse API and proxies it through our domain.
// Uses the product search query to find the first listing with an image.
// GET /api/product-image?q=Pokemon+Scarlet+Violet+Booster+Box
//
// Results are cached 24 hours — product images are stable.

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getEbayToken() {
  const clientId     = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('eBay credentials not configured');
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchEbayImage(query) {
  const token = await getEbayToken();
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10&filter=categoryIds:183468`; // 183468 = Sealed TCG Products
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eBay search failed: ${res.status}`);
  const data = await res.json();
  const items = data.itemSummaries || [];
  // Find first item with a thumbnail image
  for (const item of items) {
    if (item.thumbnailImages?.[0]?.imageUrl) return item.thumbnailImages[0].imageUrl;
    if (item.image?.imageUrl) return item.image.imageUrl;
  }
  throw new Error('no image found in eBay results');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q || q.trim().length < 3) {
    return res.status(400).json({ error: 'Missing or invalid ?q= parameter' });
  }

  const cacheKey = q.toLowerCase().trim();

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(cached.buffer);
  }

  try {
    const imageUrl = await fetchEbayImage(q);

    // Proxy the image bytes through our domain
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) throw new Error(`image proxy failed: ${imgRes.status}`);

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    if (!contentType.startsWith('image/') || buffer.length < 500) {
      throw new Error(`invalid image response (${contentType}, ${buffer.length} bytes)`);
    }

    cache.set(cacheKey, { buffer, contentType, ts: Date.now() });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error(`product-image error for "${q}":`, err.message);
    // 1x1 transparent PNG — onerror in HTML shows emoji fallback
    const transparent = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(transparent);
  }
}
