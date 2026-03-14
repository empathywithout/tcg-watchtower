// api/product-image.js — proxies Amazon product images through our domain
// GET /api/product-image?asin=B0BVK3Y82T

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { asin, debug } = req.query;
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return res.status(400).json({ error: 'Missing or invalid ?asin= parameter' });
  }

  const cached = cache.get(asin);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(cached.buffer);
  }

  try {
    // Fetch Amazon product page and extract og:image
    const pageRes = await fetch(`https://www.amazon.com/dp/${asin}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    if (!pageRes.ok) throw new Error(`page fetch failed: ${pageRes.status}`);
    const html = await pageRes.text();

    if (debug === '1') {
      // Return debug info to help diagnose
      const ogMatch = html.match(/og:image.*?content="([^"]+)"/i) || html.match(/content="([^"]+)".*?og:image/i);
      return res.status(200).json({
        status: pageRes.status,
        htmlLength: html.length,
        ogImage: ogMatch ? ogMatch[1] : null,
        htmlSample: html.slice(0, 500),
      });
    }

    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                 || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);

    if (!ogMatch) throw new Error('no og:image in page');

    const imageUrl = ogMatch[1];
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // Sanity check — must be a real image
    if (!contentType.startsWith('image/')) throw new Error(`unexpected content-type: ${contentType}`);
    if (buffer.length < 1000) throw new Error(`image too small (${buffer.length} bytes) — likely an error`);

    cache.set(asin, { buffer, contentType, ts: Date.now() });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error(`product-image error for ${asin}:`, err.message);
    const transparent = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(transparent);
  }
}
