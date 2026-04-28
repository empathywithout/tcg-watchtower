// api/tcgplayer-prices.js
// Fetches accurate TCGplayer market prices via TCGCSV (free, no auth, daily updated)
// TCGCSV mirrors TCGplayer's API: https://tcgcsv.com/docs
//
// Uses undici fetch to ensure User-Agent header is not overridden by Vercel's runtime
//
// URL: GET /api/tcgplayer-prices?groupId=22873
// Debug: GET /api/tcgplayer-prices?groupId=22873&debug=1&card=234
// Returns: { prices: { "001": 0.50, "199": 59.99, ... }, tcgpUrls: {...} }

import { fetch as undiciFetch } from 'undici';

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const POKEMON_CATEGORY    = 3;
const ONE_PIECE_CATEGORY  = 68;

const TCGCSV_HEADERS = {
  'User-Agent': 'TCGWatchtower/1.0',
};

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_VERSION = 'v4'; // bumped — full cross-set card number keys

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const groupId = req.query.groupId;
  const game    = (req.query.game || 'pokemon').toLowerCase();
  const category = game === 'onepiece' ? ONE_PIECE_CATEGORY : POKEMON_CATEGORY;

  if (!groupId || !/^\d+$/.test(groupId)) {
    return res.status(400).json({ error: 'Missing or invalid ?groupId= parameter' });
  }

  const debugMode = req.query.debug === '1';
  const debugCard = req.query.card;

  if (!debugMode) {
    const cached = cache.get(CACHE_VERSION + groupId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached.data);
    }
  }

  try {
    const [productsRes, pricesRes] = await Promise.all([
      undiciFetch(`${TCGCSV_BASE}/${category}/${groupId}/products`, {
        signal: AbortSignal.timeout(10000),
        headers: TCGCSV_HEADERS,
      }),
      undiciFetch(`${TCGCSV_BASE}/${category}/${groupId}/prices`, {
        signal: AbortSignal.timeout(10000),
        headers: TCGCSV_HEADERS,
      })
    ]);

    if (!productsRes.ok) {
      const body = await productsRes.text();
      return res.status(502).json({ error: `TCGCSV products fetch failed: ${productsRes.status}`, body });
    }
    if (!pricesRes.ok) {
      const body = await pricesRes.text();
      return res.status(502).json({ error: `TCGCSV prices fetch failed: ${pricesRes.status}`, body });
    }

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
    // For One Piece: each variant is a separate product with the same card number
    // Key by "number_varianttype" to distinguish Nami (053), Nami (Alt Art) (053), etc.
    const prices   = {};
    const tcgpUrls = {};
    const bestProductId = {};

    // Primary set prefix for this group — detect from products
    // Cards whose rawNumber prefix differs from primary are cross-set cards
    // and should be keyed by full number (e.g. "OP11-106") not short number ("106")
    const primaryPrefixCounts = {};
    for (const product of products) {
      const extData  = product.extendedData || [];
      const numEntry = extData.find(e => e.name === 'Number');
      if (!numEntry) continue;
      const rawNumber = numEntry.value.split('/')[0].trim();
      const match = rawNumber.match(/^([A-Z]+\d+)-/);
      if (match) {
        primaryPrefixCounts[match[1]] = (primaryPrefixCounts[match[1]] || 0) + 1;
      }
    }
    // The primary prefix is the one with the most cards
    const primaryPrefix = Object.entries(primaryPrefixCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || '';

    for (const product of products) {
      const extData  = product.extendedData || [];
      const numEntry = extData.find(e => e.name === 'Number');
      if (!numEntry) continue;

      const rawNumber = numEntry.value.split('/')[0].trim();
      const cardNumber = rawNumber;

      // Detect if this is a cross-set card (different prefix from primary)
      const prefixMatch = rawNumber.match(/^([A-Z]+\d+)-/);
      const cardPrefix = prefixMatch ? prefixMatch[1] : '';
      const isCrossSet = cardPrefix && primaryPrefix && cardPrefix !== primaryPrefix;

      // For primary cards: use short padded number e.g. "106"
      // For cross-set cards: use full number e.g. "OP11-106"
      const opLocalId = category === 68
        ? (isCrossSet ? rawNumber : rawNumber.split('-').pop().padStart(3, '0'))
        : null;

      const priceObj = priceByProductId[product.productId];
      if (!priceObj || priceObj.marketPrice == null) continue;

      const productName = (product.name || '').trim();
      const setSlug = (product.groupName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      if (category === 68) {
        const nameLower = productName.toLowerCase();

        // Detect variant suffix from product name
        let suffix = ''; // base card
        if (nameLower.includes('manga')) {
          suffix = '_mangaaltart';
        } else if (nameLower.includes('(sp) (gold)') || nameLower.includes('gold)')) {
          suffix = '_goldspecialaltart';
        } else if (nameLower.includes('(sp)') || nameLower.includes('special alt') || nameLower.includes('sp alt')) {
          suffix = '_specialaltart';
        } else if (nameLower.includes('alternate art') || nameLower.includes('alt art') || nameLower.includes('(alt)')) {
          suffix = '_altart';
        }

        const baseName = productName
          .replace(/ - [A-Z0-9]+-[0-9]+/g, '')
          .replace(/[(][A-Z0-9]+-[0-9]+[)]/g, '')
          .replace(/[(][0-9]+[)]/g, '')
          .replace(/[(][^)]*[)]/g, '')
          .replace(/[^a-zA-Z0-9 ]/g, '')
          .trim()
          .toLowerCase()
          .replace(/  +/g, ' ')
          .trim();

        const nameKey = baseName + suffix;
        const numKey  = opLocalId + suffix;

        // Dedup by numKey (card number + variant)
        if (bestProductId[numKey] !== undefined) continue;
        bestProductId[numKey] = product.productId;

        const productUrl = product.url || `https://www.tcgplayer.com/product/${product.productId}`;

        prices[numKey]   = priceObj.marketPrice;
        tcgpUrls[numKey] = productUrl;

        if (!prices[nameKey]) {
          prices[nameKey]   = priceObj.marketPrice;
          tcgpUrls[nameKey] = productUrl;
        }

        if (!prices[opLocalId]) {
          prices[opLocalId]   = priceObj.marketPrice;
          tcgpUrls[opLocalId] = productUrl;
        }

      } else {
        // Pokemon: keep lowest productId per card number
        if (bestProductId[cardNumber] !== undefined && product.productId >= bestProductId[cardNumber]) continue;
        prices[cardNumber] = priceObj.marketPrice;
        const cardName = (product.name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
        const q = encodeURIComponent(`${cardName} ${cardNumber}`);
        tcgpUrls[cardNumber] = `https://www.tcgplayer.com/search/pokemon/${setSlug}?productLineName=pokemon&q=${q}&view=grid&Language=English&productTypeName=Cards&setName=${setSlug}&sharedid=&irpid=7068180&afsrc=1`;
        bestProductId[cardNumber] = product.productId;
      }
    }

    // Build sealed product prices keyed by productId
    const sealedPrices = {};
    for (const product of products) {
      const extData  = product.extendedData || [];
      const hasNumber = extData.some(e => e.name === 'Number');
      if (hasNumber) continue;
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

    cache.set(CACHE_VERSION + groupId, { ts: Date.now(), data: responseData });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responseData);

  } catch (err) {
    console.error('TCGplayer prices error:', err);
    return res.status(500).json({ error: err.message });
  }
}
