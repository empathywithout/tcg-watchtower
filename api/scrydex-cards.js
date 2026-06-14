// api/scrydex-cards.js
// Fetches card list with prices + variants from Scrydex for portfolio use
// Redis cached 6h to limit credit usage

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const KV_URL          = process.env.KV_REST_API_URL;
const KV_TOKEN        = process.env.KV_REST_API_TOKEN;

const CACHE_TTL_SEC = 6 * 60 * 60; // 6 hours

const SCRYDEX_EN_ID_MAP = {
const SCRYDEX_EN_ID_MAP = {
  // Scarlet & Violet — exact Scrydex IDs
  'sv01':'sv1','sv02':'sv2','sv03':'sv3','sv3pt5':'sv3pt5',
  'sv04':'sv4','sv4pt5':'sv4pt5','sv05':'sv5','sv06':'sv6',
  'sv6pt5':'sv6pt5','sv07':'sv7','sv08':'sv8','sv8pt5':'sv8pt5',
  'sv09':'sv9','sv10':'sv10',
  'zsv10pt5':'zsv10pt5','rsv10pt5':'rsv10pt5',
  // Mega Evolution
  'me01':'me1','me02':'me2','me02pt5':'me2pt5','me03':'me3','me04':'me4','me05':'me5',
};

const SCRYDEX_JP_ID_MAP = {
  'me01':'me1','me02':'me2','me02pt5':'me2pt5','me03':'m3_ja','me04':'m4_ja',
};

/* ── Redis helpers ─────────────────────────────────────────────────── */
async function redisGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ?? null;
  } catch { return null; }
}

async function redisSetEx(key, value, ttl) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}

/* ── Fetch all pages from Scrydex ──────────────────────────────────── */
async function fetchAllCards(baseUrl) {
  let allCards = [];
  let page = 1;
  let total = null;

  while (true) {
    const res = await fetch(`${baseUrl}&page=${page}`, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Scrydex ${res.status}`);
    const data = await res.json();
    const pageCards = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allCards = allCards.concat(pageCards);
    if (pageCards.length === 0) break;
    if (pageCards.length < 100) break;
    if (total !== null && allCards.length >= total) break;
    page++;
  }
  return allCards;
}

/* ── Normalise a Scrydex card ──────────────────────────────────────── */
function normaliseCard(c, setId, phase) {
  const R2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
  const rawId  = c.id ? c.id.split('-').slice(1).join('-') : '';
  const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;

  // Primary image — R2 for EN, Scrydex for JP
  const scrydexImg = c.images?.[0]?.medium || c.images?.[0]?.small || null;
  const image = phase === 'jp'
    ? (scrydexImg || `${R2}/cards/${setId}/${localId}.webp`)
    : `${R2}/cards/${setId}/${localId}.webp`;

  // Extract variants with prices
  const variants = (c.variants || []).map(v => {
    const prices  = v.prices || [];
    const rawPrice = prices.find(p => p.type === 'raw' && p.condition === 'U');
    return {
      name:   v.name || 'normal',
      market: rawPrice?.market ?? null,
      // Future: graded prices when plan upgraded
    };
  }).filter(v => v.name); // skip empty

  // Market price from first normal variant
  const normalVariant = variants.find(v => v.name === 'normal') || variants[0];
  const market = normalVariant?.market ?? null;

  const name = phase === 'jp'
    ? (c.translation?.en?.name || c.name || '')
    : (c.name || '');

  return {
    id:       c.id,
    localId,
    name,
    rarity:   c.rarity || '',
    image,
    scrydexImage: scrydexImg,
    market,
    variants: variants.length > 1 ? variants : [], // only include if multiple variants
    supertype:  c.supertype || '',
    subtypes:   c.subtypes || [],
    artist:     c.artist || '',
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const { set, phase } = req.query;
  if (!set) return res.status(400).json({ error: 'Provide ?set= param' });

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  const isJP = phase === 'jp';
  const scrydexId = isJP
    ? SCRYDEX_JP_ID_MAP[set]
    : SCRYDEX_EN_ID_MAP[set];

  if (!scrydexId) return res.status(400).json({ error: `Unknown set: ${set}` });

  // ── Redis cache check ─────────────────────────────────────────────
  const cacheKey = `scrydex:cards:${scrydexId}`;
  const cached   = await redisGet(cacheKey);

  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    const cards = JSON.parse(cached);
    return res.status(200).json({ cards, total: cards.length, cached: true });
  }

  // ── Cache miss — fetch from Scrydex (1 credit per page) ──────────
  res.setHeader('X-Cache', 'MISS');
  try {
    const basePrefix = isJP ? `${SCRYDEX_BASE}/ja` : SCRYDEX_BASE;
    const selectFields = isJP
      ? 'id,name,translation,rarity,images,variants,supertype,subtypes,artist'
      : 'id,name,rarity,images,variants,supertype,subtypes,artist';

    const rawCards = await fetchAllCards(
      `${basePrefix}/expansions/${scrydexId}/cards?select=${selectFields}&include=prices&pageSize=100`
    );

    const cards = rawCards.map(c => normaliseCard(c, set, isJP ? 'jp' : 'en'));

    // ── Cache in Redis for 6h ──────────────────────────────────────
    await redisSetEx(cacheKey, JSON.stringify(cards), CACHE_TTL_SEC);

    return res.status(200).json({ cards, total: cards.length });
  } catch (e) {
    console.error('[scrydex-cards]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
