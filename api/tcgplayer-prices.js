// api/tcgplayer-prices.js
// Fetches accurate TCGplayer market prices via TCGCSV (free, no auth, daily updated)
// TCGCSV mirrors TCGplayer's API: https://tcgcsv.com/docs
//
// URL: GET /api/tcgplayer-prices?groupId=22873
// Debug: GET /api/tcgplayer-prices?groupId=22873&debug=1&card=234
// Returns: { prices: { "001": 0.50, "199": 59.99, ... }, tcgpUrls: {...} }

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const POKEMON_CATEGORY = 3;

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

  const debugMode = req.query.debug === '1';
  const debugCard = req.query.card;

  if (!debugMode) {
    const cached = cache.get(groupId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached.data);
    }
  }

  try {
    const [productsRes, pricesRes] = await Promise.all([
      fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY}/${groupId}/products`, {
        signal: AbortSignal.timeout(10000)
      }),
      fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY}/${groupId}/prices`, {
        signal: AbortSignal.timeout(10000)
      })
    ]);

    if (!productsRes.ok) return res.status(502).json({ error: `TCGCSV products fetch failed: ${productsRes.status}` });
    if (!pricesRes.ok)   return res.status(502).json({ error: `TCGCSV prices fetch failed: ${pricesRes.status}` });

    const [productsData, pricesData] = await Promise.all([
      productsRes.json(),
      pricesRes.json()
    ]);

    const products   = productsData.results || [];
    const pricesList = pricesData.results   || [];

    // Debug mode
    if (debugMode && debugCard) {
      const matchingProducts = products.filter(p => {
        const numEntry = (p.extendedData || []).find(e => e.name === 'Number');
        return numEntry && numEntry.value.split('/')[0].trim() === debugCard;
      });
      const productIds = new Set(matchingProducts.map(p => p.productId));
      const matchingPrices = pricesList.filter(p => productIds.has(p.productId));
      return res.status(200).json({
        groupId, card: debugCard,
        products: matchingProducts, prices: matchingPrices,
        totalProducts: products.length, totalPrices: pricesList.length,
      });
    }

    // Build price lookup by productId
    // Priority: Normal > Holofoil > anything else; skip Reverse Holofoil
    const priceByProductId = {};
    for (const p of pricesList) {
      const subType = (p.subTypeName || '').toLowerCase();
      if (subType.includes('reverse')) continue;
      const existing = priceByProductId[p.productId];
      if (!existing) {
        priceByProductId[p.productId] = p;
      } else {
        const existingSub = (existing.subTypeName || '').toLowerCase();
        if (subType === 'normal' && existingSub !== 'normal') {
          priceByProductId[p.productId] = p;
        }
      }
    }

    // Build card number -> price + URL map
    // Keep lowest productId per card number = original canonical listing
    const prices   = {};
    const tcgpUrls = {};
    const bestProductId = {};

    for (const product of products) {
      const extData  = product.extendedData || [];
      const numEntry = extData.find(e => e.name === 'Number');
      if (!numEntry) continue;

      const cardNumber = numEntry.value.split('/')[0].trim();
      const priceObj   = priceByProductId[product.productId];
      if (!priceObj || priceObj.marketPrice == null) continue;

      // Keep lowest productId = earliest/original listing
      if (bestProductId[cardNumber] !== undefined && product.productId >= bestProductId[cardNumber]) continue;

      prices[cardNumber]    = priceObj.marketPrice;
      tcgpUrls[cardNumber]  = 'https://www.tcgplayer.com/product/' + product.productId;
      bestProductId[cardNumber] = product.productId;
    }

    // Build sealed product prices keyed by productId
    // Sealed products have no 'Number' extendedData — identify by absence of Number field
    const sealedPrices = {};
    for (const product of products) {
      const extData  = product.extendedData || [];
      const hasNumber = extData.some(e => e.name === 'Number');
      if (hasNumber) continue; // skip cards
      const priceObj = priceByProductId[product.productId];
      if (!priceObj || priceObj.marketPrice == null) continue;
      sealedPrices[String(product.productId)] = priceObj.marketPrice;
    }

    const responseData = {
      success: true,
      groupId,
      timestamp: new Date().toISOString(),
      count: Object.keys(prices).length,
      prices,
      tcgpUrls,
      sealedPrices,
    };

    cache.set(groupId, { ts: Date.now(), data: responseData });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responseData);

  } catch (err) {
    console.error('TCGplayer prices error:', err);
    return res.status(500).json({ error: err.message });
  }
}
