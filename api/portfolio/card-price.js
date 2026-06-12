// api/portfolio/card-price.js
// Returns Scrydex pricing data (raw + trends, optionally graded) for a single card.
// Used by portfolio.html for per-card trend badges and graded card values.
//
// URL: GET /api/portfolio/card-price?set=zsv10pt5&localId=172
//      GET /api/portfolio/card-price?set=zsv10pt5&localId=172&grade=10&company=PSA
//
// Response:
//   {
//     raw:    { market, low, currency, trends: { days_7: {...}, days_30: {...} } } | null,
//     graded: { market, low, mid, high, currency, grade, company } | null
//   }

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';

// Our internal setId -> Scrydex EN expansion ID
// Mirrors SCRYDEX_EN_ID_MAP in api/cards.js and scripts/sync-images.js
const SCRYDEX_EN_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10',
  'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03',
  'me04':'me4','me05':'me5',
  'zsv10pt5':'zsv10pt5','rsv10pt5':'rsv10pt5',
};

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — prices don't need to be real-time

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const setId   = (req.query.set     || '').trim();
  const localId = (req.query.localId || '').trim();
  const grade   = (req.query.grade   || '').trim();
  const company = (req.query.company || '').trim().toUpperCase();

  if (!setId || !localId) {
    return res.status(400).json({ error: 'Missing ?set= or ?localId=' });
  }
  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(503).json({ error: 'Scrydex credentials not configured' });
  }

  const scrydexExpansion = SCRYDEX_EN_ID_MAP[setId];
  if (!scrydexExpansion) {
    return res.status(404).json({ error: `No Scrydex mapping for set ${setId}` });
  }

  const scrydexCardId = `${scrydexExpansion}-${localId}`;
  const cacheKey = `${scrydexCardId}:${company}:${grade}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(cached.data);
  }

  try {
    const url = `${SCRYDEX_BASE}/cards/${scrydexCardId}?include=prices`;
    const scrydexRes = await fetch(url, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
      signal: AbortSignal.timeout(10000),
    });

    if (!scrydexRes.ok) {
      return res.status(scrydexRes.status).json({ error: `Scrydex ${scrydexRes.status} for ${scrydexCardId}` });
    }

    const json = await scrydexRes.json();
    const card = json.data || json;

    // Prices live on the card itself and/or on variants — check both
    const allPrices = [];
    if (Array.isArray(card.prices)) allPrices.push(...card.prices);
    if (Array.isArray(card.variants)) {
      for (const v of card.variants) {
        if (Array.isArray(v.prices)) allPrices.push(...v.prices);
      }
    }

    // ── Raw price (prefer NM condition) ─────────────────────────────────────
    const rawPrices = allPrices.filter(p => p.type === 'raw');
    const rawNM = rawPrices.find(p => p.condition === 'NM') || rawPrices[0] || null;

    const raw = rawNM ? {
      condition: rawNM.condition,
      market:    rawNM.market ?? null,
      low:       rawNM.low ?? null,
      currency:  rawNM.currency || 'USD',
      trends:    rawNM.trends || null,
    } : null;

    // ── Graded price (only if requested) ────────────────────────────────────
    let graded = null;
    if (grade && company) {
      const gradedPrices = allPrices.filter(p => p.type === 'graded');
      const match = gradedPrices.find(p =>
        String(p.grade) === grade &&
        (p.company || '').toUpperCase() === company
      );
      if (match) {
        graded = {
          grade:    match.grade,
          company:  match.company,
          market:   match.market ?? null,
          low:      match.low ?? null,
          mid:      match.mid ?? null,
          high:     match.high ?? null,
          currency: match.currency || 'USD',
          trends:   match.trends || null,
        };
      }
    }

    const data = { raw, graded };
    cache.set(cacheKey, { ts: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(data);

  } catch (e) {
    console.warn(`[card-price] failed for ${scrydexCardId}:`, e.message);
    return res.status(502).json({ error: `Scrydex request failed: ${e.message}` });
  }
}
