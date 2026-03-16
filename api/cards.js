// api/cards.js
// Returns card list with rarities for a given set.
//
// Primary path: fetches pre-built data/{setId}.json from R2 (uploaded by sync-images.js)
// Fallback: TCGCSV (2 requests) then TCGdex (per-card)
//
// URL: GET /api/cards?set=sv07
//      GET /api/cards?set=me02pt5   (me02.5 passed as me02pt5 to avoid dot in URL)

const R2_BASE = process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

// TCGplayer groupId map — used for TCGCSV fallback
const SET_TO_GROUP = {
  'sv01':'22873','sv02':'23120','sv03':'23228','sv3pt5':'23237',
  'sv04':'23286','sv4pt5':'23353','sv05':'23381','sv06':'23473',
  'sv6pt5':'23529','sv07':'23537','sv08':'23651','sv8pt5':'23821',
  'sv09':'24073','sv10':'24269',
  // Mega Evolution series
  'me01':'24380','me02':'24448','me02pt5':'24541','me03':'24587',
};

// TCGdex uses dot-notation for special sets — map from our pt-notation
const TCGDEX_ID_MAP = {
  'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5',
  'me02pt5':'me02.5',
};

// Derive TCGdex series prefix from a set ID
// e.g. 'sv01' → 'sv', 'me01' → 'me', 'sv03.5' → 'sv'
function tcgdexSeriesPrefix(setId) {
  return (setId.match(/^([a-z]+)/i) || ['','sv'])[1].toLowerCase();
}

// Title-case each word: "special illustration rare" -> "Special Illustration Rare"
function normalizeRarity(r) {
  if (!r) return '';
  return r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const setId = (req.query.set || '').trim();
  if (!setId || !/^[a-z0-9]+$/.test(setId)) {
    return res.status(400).json({ error: 'Missing or invalid ?set= parameter' });
  }

  const cached = cache.get(setId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(cached.data);
  }

  // Resolve TCGdex set ID (dot-notation) from our pt-notation
  const tcgdexId = TCGDEX_ID_MAP[setId] || setId;
  const seriesPrefix = tcgdexSeriesPrefix(tcgdexId);

  try {
    let cards = null;

    // ── Strategy 1: R2 pre-built JSON (fastest, has correct rarities) ──────────
    try {
      const r2Res = await fetch(`${R2_BASE}/data/${setId}.json`);
      if (r2Res.ok) {
        const r2Data = await r2Res.json();
        if (r2Data.cards && r2Data.cards.length > 0) {
          cards = r2Data.cards.map(c => ({
            localId: c.localId,
            name: c.name,
            rarity: normalizeRarity(c.rarity),
            // Always use R2 for images when R2 is available
            image: `${R2_BASE}/cards/${setId}/${c.localId}.webp`,
          }));
          console.log(`[api/cards] R2 hit for ${setId}: ${cards.length} cards`);
        }
      }
    } catch (e) {
      console.warn(`[api/cards] R2 failed for ${setId}:`, e.message);
    }

    // ── Strategy 2: TCGCSV (has prices + rarity, 2 parallel requests) ─────────
    const groupId = SET_TO_GROUP[setId];
    if (!cards && groupId) {
      try {
        const [productsRes, rarityRes] = await Promise.all([
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`),
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/product/rarities`)
        ]);
        if (productsRes.ok) {
          const productsData = await productsRes.json();
          const rarityData = rarityRes.ok ? await rarityRes.json() : { results: [] };
          const rarityMap = {};
          (rarityData.results || []).forEach(r => {
            if (r.productId && r.name) rarityMap[r.productId] = r.name;
          });
          const cardRows = (productsData.results || []).filter(p =>
            p.number && /^\d+[a-zA-Z]?$/.test(p.number)
          );
          if (cardRows.length > 0) {
            cards = cardRows.map(p => ({
              localId: p.number,
              name: p.name,
              image: `${R2_BASE}/cards/${setId}/${p.number}.webp`,
              rarity: normalizeRarity(rarityMap[p.productId] || '')
            }));
            console.log(`[api/cards] TCGCSV hit for ${setId}: ${cards.length} cards`);
          }
        }
      } catch (e) {
        console.warn(`[api/cards] TCGCSV failed for ${setId}:`, e.message);
      }
    }

    // ── Strategy 3: TCGdex fallback (slowest — per-card requests) ─────────────
    if (!cards) {
      console.log(`[api/cards] Falling back to TCGdex for ${setId} (tcgdexId=${tcgdexId})`);
      const setRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${tcgdexId}`);
      if (!setRes.ok) return res.status(502).json({ error: `TCGdex failed: ${setRes.status}` });
      const setData = await setRes.json();
      const basicCards = setData.cards || [];
      const BATCH = 20;
      const fullCards = [];
      for (let i = 0; i < basicCards.length; i += BATCH) {
        const batch = basicCards.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(c =>
            fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}-${c.localId}`)
              .then(r => r.ok ? r.json() : null).catch(() => null)
          )
        );
        results.forEach((result, idx) => {
          const basic = batch[idx];
          const detail = result.status === 'fulfilled' ? result.value : null;
          fullCards.push({
            localId: basic.localId,
            name: basic.name,
            // FIX: use seriesPrefix derived from setId, not hardcoded 'sv'
            image: `https://assets.tcgdex.net/en/${seriesPrefix}/${tcgdexId}/${basic.localId}/high.webp`,
            rarity: normalizeRarity(detail?.rarity || '')
          });
        });
      }
      cards = fullCards;
      console.log(`[api/cards] TCGdex fallback for ${setId}: ${cards.length} cards`);
    }

    const data = { cards, cardCount: { total: cards.length } };
    cache.set(setId, { ts: Date.now(), data });
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);

  } catch (e) {
    console.error('[api/cards] error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
