// api/product-image.js
// Proxies Amazon product images through our domain to avoid ad blocker blocking.
// GET /api/product-image?asin=B0BVK3Y82T
// Fetches the image from Amazon and streams it back — browser sees tcgwatchtower.com, not amazon-adsystem.com

const cache = new Map(); // asin → { buffer, contentType, ts }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — product images don't change

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { asin } = req.query;
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return res.status(400).json({ error: 'Missing or invalid ?asin= parameter' });
  }

  // Serve from cache
  const cached = cache.get(asin);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(cached.buffer);
  }

  try {
    // Amazon Associates image widget URL — redirects to actual product image
    const amazonUrl = `https://ws-na.amazon-adsystem.com/widgets/q?_encoding=UTF8&ASIN=${asin}&Format=_SL500_&ID=AsinImage&MarketPlace=US&ServiceVersion=20070822&WS=1&tag=cehutto01-20`;

    const imgRes = await fetch(amazonUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TCGWatchtower/1.0)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    if (!imgRes.ok) throw new Error(`Amazon image fetch failed: ${imgRes.status}`);

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    cache.set(asin, { buffer, contentType, ts: Date.now() });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);

  } catch (err) {
    // Return a transparent 1x1 PNG so the img element doesn't show broken
    const transparent1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(transparent1x1);
  }
}
