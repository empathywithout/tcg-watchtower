// api/tcgplayer-prices.js
// Fetches accurate TCGplayer market prices via TCGCSV (free, no auth, daily updated)
// TCGCSV mirrors TCGplayer's API: https://tcgcsv.com/docs
//
// URL: GET /api/tcgplayer-prices?groupId=22873
// Returns: { prices: { "001": 0.50, "199": 59.99, ... }, tcgpUrl: {...} }

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const POKEMON_CATEGORY = 3;

// Cache responses in memory for the duration of the serverless function instance
// (prevents hammering TCGCSV on rapid repeated requests)
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const groupId = req.query.groupId;
  if (!groupId || !/^\d+$/.test(groupId)) {
    return res.status(400).json({ error: 'Missing or invalid ?groupId= parameter' });
  }

  // Check memory cache
  const cached = cache.get(groupId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    // Fetch products (has card numbers) and prices in parallel
    const [productsRes, pricesRes] = await Promise.all([
      fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY}/${groupId}/products`, {
        signal: AbortSignal.timeout(10000)
      }),
      fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY}/${groupId}/prices`, {
        signal: AbortSignal.timeout(10000)
      })
    ]);

    if (!productsRes.ok) {
      return res.status(502).json({ error: `TCGCSV products fetch failed: ${productsRes.status}` });
    }
    if (!pricesRes.ok) {
      return res.status(502).json({ error: `TCGCSV prices fetch failed: ${pricesRes.status}` });
    }

    const [productsData, pricesData] = await Promise.all([
      productsRes.json(),
      pricesRes.json()
    ]);

    const products = productsData.results || [];
    const pricesList = pricesData.results || [];

    // Filter products to only those belonging to this exact group
    // (TCGCSV can return products from supplemental/promo groups that share card numbers)
    const groupIdNum = parseInt(groupId, 10);
    const filteredProducts = products.filter(p => p.groupId === groupIdNum);

    // Build price lookup by productId, preferring "Normal" subtype over "Holofoil", skipping Reverse
    const priceByProductId = {};
    for (const p of pricesList) {
      const existing = priceByProductId[p.productId];
      const subType = (p.subTypeName || '').toLowerCase();
      if (subType.includes('reverse')) continue;
      if (!existing) {
        priceByProductId[p.productId] = p;
      } else {
        const existingSub = (existing.subTypeName || '').toLowerCase();
        if (subType === 'normal' && existingSub !== 'normal') {
          priceByProductId[p.productId] = p;
        }
      }
    }

    // Build card number → price map
    // extendedData contains {name: "Number", value: "199/198"} — extract just the card number part
    // When multiple products share a card number (shouldn't happen after groupId filter, but just in case),
    // prefer the one with the lowest productId (earliest/original listing)
    const prices = {};
    const tcgpUrls = {};
    const seenProductIds = {}; // cardNumber → productId already used

    for (const product of filteredProducts) {
      const extData = product.extendedData || [];
      const numberEntry = extData.find(e => e.name === 'Number');
      if (!numberEntry) continue;

      const cardNumber = numberEntry.value.split('/')[0].trim();

      // If we already have a price for this card number, keep the one with the lower productId
      if (seenProductIds[cardNumber] && product.productId > seenProductIds[cardNumber]) continue;

      const priceObj = priceByProductId[product.productId];
      if (priceObj && priceObj.marketPrice != null) {
        prices[cardNumber] = priceObj.marketPrice;
        tcgpUrls[cardNumber] = `https://www.tcgplayer.com/product/${product.productId}`;
        seenProductIds[cardNumber] = product.productId;
      }
    }

    const responseData = {
      success: true,
      groupId,
      timestamp: new Date().toISOString(),
      count: Object.keys(prices).length,
      prices,    // { "199": 59.99, "086": 8.50, ... }
      tcgpUrls   // { "199": "https://www.tcgplayer.com/product/...", ... }
    };

    cache.set(groupId, { ts: Date.now(), data: responseData });

    // Cache aggressively — TCGCSV only updates daily
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responseData);

  } catch (err) {
    console.error('TCGplayer prices error:', err);
    return res.status(500).json({ error: err.message });
  }
}
