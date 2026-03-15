// api/cards.js
// Returns card list with rarities for a given set.
// Uses TCGCSV (TCGplayer mirror) for card names + rarities in 2 parallel requests,
// then falls back to TCGdex if TCGCSV doesn't have the data.
// Cached in-memory for 1 hour.
//
// URL: GET /api/cards?set=sv07

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Maps set ID to TCGplayer group ID (verified from page configs)
const SET_TO_GROUP = {
  'sv01':   '22873',
  'sv02':   '23120',
  'sv03':   '23228',
  'sv3pt5': '23237',
  'sv04':   '23286',
  'sv4pt5': '23353',
  'sv05':   '23381',
  'sv06':   '23473',
  'sv6pt5': '23529',
  'sv07':   '23537',
  'sv08':   '23651',
  'sv8pt5': '23821',
  'sv09':   '24073',
  'sv10':   '24269',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const setId = req.query.set;
  if (!setId || !/^[a-z0-9]+$/.test(setId)) {
    return res.status(400).json({ error: 'Missing or invalid ?set= parameter' });
  }

  // Check cache
  const cached = cache.get(setId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(cached.data);
  }

  const groupId = SET_TO_GROUP[setId];

  try {
    let cards = null;

    // Strategy 1: TCGCSV — gets all cards + rarities in 2 parallel requests
    if (groupId) {
      try {
        const [productsRes, rarityRes] = await Promise.all([
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`),
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/product/rarities`)
        ]);

        if (productsRes.ok) {
          const productsData = await productsRes.json();
          const rarityData = rarityRes.ok ? await rarityRes.json() : { results: [] };

          // Build rarity map by productId
          const rarityMap = {};
          (rarityData.results || []).forEach(r => {
            if (r.productId && r.name) rarityMap[r.productId] = r.name;
          });

          // Filter to cards only (have a numeric card number, not sealed product)
          const cardRows = (productsData.results || []).filter(p =>
            p.number && /^\d+[a-zA-Z]?$/.test(p.number)
          );

          if (cardRows.length > 0) {
            const r2Base = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
            cards = cardRows.map(p => ({
              localId: p.number,
              name: p.name,
              image: `${r2Base}/cards/${setId}/${p.number}.webp`,
              rarity: rarityMap[p.productId] || ''
            }));
          }
        }
      } catch (e) {
        console.warn('[api/cards] TCGCSV failed:', e.message);
      }
    }

    // Strategy 2: TCGdex fallback — set endpoint + per-card fetches for rarity
    if (!cards || cards.length === 0) {
      // TCGdex uses different IDs for the pt5 sets
      const tcgdexId = {
        'sv3pt5': 'sv03.5',
        'sv4pt5': 'sv04.5',
        'sv6pt5': 'sv06.5',
        'sv8pt5': 'sv08.5',
      }[setId] || setId;

      const setRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${tcgdexId}`);
      if (!setRes.ok) {
        return res.status(502).json({ error: `TCGdex set fetch failed: ${setRes.status}` });
      }
      const setData = await setRes.json();
      const basicCards = setData.cards || [];

      const BATCH = 20;
      const fullCards = [];
      for (let i = 0; i < basicCards.length; i += BATCH) {
        const batch = basicCards.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(c =>
            fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}-${c.localId}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        );
        results.forEach((result, idx) => {
          const basic = batch[idx];
          const detail = result.status === 'fulfilled' ? result.value : null;
          fullCards.push({
            localId: basic.localId,
            name: basic.name,
            image: `https://assets.tcgdex.net/en/sv/${tcgdexId}/${basic.localId}/high.webp`,
            rarity: detail?.rarity || ''
          });
        });
      }
      cards = fullCards;
    }

    const data = { cards, cardCount: { total: cards.length } };
    cache.set(setId, { ts: Date.now(), data });
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(data);

  } catch (e) {
    console.error('[api/cards] error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
