// api/scrydex-cards.js
// Fetches cards from Scrydex for portfolio use — Redis cached 6h

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const KV_URL          = process.env.KV_REST_API_URL;
const KV_TOKEN        = process.env.KV_REST_API_TOKEN;
const CACHE_TTL_SEC   = 6 * 60 * 60;

// Internal setId → Scrydex expansion ID (exact IDs from API)
const SCRYDEX_EN_ID_MAP = {
  'sv01':'sv1','sv02':'sv2','sv03':'sv3','sv3pt5':'sv3pt5',
  'sv04':'sv4','sv4pt5':'sv4pt5','sv05':'sv5','sv06':'sv6',
  'sv6pt5':'sv6pt5','sv07':'sv7','sv08':'sv8','sv8pt5':'sv8pt5',
  'sv09':'sv9','sv10':'sv10','zsv10pt5':'zsv10pt5','rsv10pt5':'rsv10pt5',
  'me01':'me1','me02':'me2','me02pt5':'me2pt5','me03':'me3','me04':'me4','me05':'me5',
};

const SCRYDEX_JP_ID_MAP = {
  'me01':'me1','me02':'me2','me02pt5':'me2pt5','me03':'m3_ja','me04':'m4_ja',
  // 'me05': '<CONFIRM ME>',  // Pitch Black / Abyss Eye — do NOT guess this ID.
  // Run `node scripts/find-scrydex-jp-id.js "Abyss Eye"` locally (needs
  // SCRYDEX_API_KEY/SCRYDEX_TEAM_ID in env) to get the confirmed expansion ID,
  // then add it here AND in the matching map in api/cards.js.
};

// JPY→USD conversion for JP-phase sets (no English TCGplayer prices exist yet).
// Free, no-key exchange-rate API; cached in Redis 24h with a static fallback
// so a transient outage never breaks pricing — it just uses a slightly stale rate.
const FX_CACHE_KEY = 'fx:jpy_usd';
const FX_TTL_SEC   = 24 * 60 * 60;
const FX_FALLBACK_RATE = 0.0067; // approx JPY→USD — update if API is down for a long stretch

async function getJpyToUsdRate() {
  const cached = await redisGet(FX_CACHE_KEY);
  if (cached) {
    const parsed = parseFloat(cached);
    if (parsed > 0) return parsed;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/JPY', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.USD;
    if (typeof rate === 'number' && rate > 0) {
      await redisSetEx(FX_CACHE_KEY, String(rate), FX_TTL_SEC);
      return rate;
    }
    throw new Error('fx response missing rates.USD');
  } catch (e) {
    console.warn('[scrydex-cards fx]', e.message, '— using fallback rate');
    return FX_FALLBACK_RATE;
  }
}

/* ── Redis ─────────────────────────────────────────────────────────── */
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

/* ── Scrydex fetch helpers ─────────────────────────────────────────── */
const HEADERS = () => ({ 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID });

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Scrydex ${res.status}`);
  return res.json();
}

async function fetchAllPages(baseUrl) {
  let allCards = [], page = 1, total = null;
  while (true) {
    const data = await fetchPage(`${baseUrl}&page=${page}`);
    const rows = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allCards = allCards.concat(rows);
    if (rows.length === 0 || rows.length < 100) break;
    if (total !== null && allCards.length >= total) break;
    page++;
  }
  return allCards;
}

/* ── Normalise ─────────────────────────────────────────────────────── */
const R2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

function normaliseCard(c, internalSetId, phase, fxRate = null) {
  const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
  const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;

  const scrydexImg = c.images?.[0]?.medium || c.images?.[0]?.small || null;
  const image = phase === 'jp'
    ? (scrydexImg || `${R2}/cards/${internalSetId}/${localId}.webp`)
    : (scrydexImg || `${R2}/cards/${internalSetId}/${localId}.webp`);

  // JP prices come back from Scrydex in JPY. Convert to USD for display, but keep
  // the raw JPY figure around too so the UI can be transparent about the estimate.
  const shouldConvert = phase === 'jp' && typeof fxRate === 'number' && fxRate > 0;

  const variants = (c.variants || []).map(v => {
    const prices    = v.prices || [];
    const rawPrice  = prices.find(p => p.type === 'raw' && p.condition === 'U') || prices[0];
    const marketJPY = rawPrice?.market ?? null;
    const market    = shouldConvert && marketJPY != null
      ? Math.round(marketJPY * fxRate * 100) / 100
      : marketJPY;
    return {
      name: v.name || 'normal',
      market,
      ...(shouldConvert ? { marketJPY } : {}),
    };
  }).filter(v => v.name);

  const normalVariant = variants.find(v => v.name === 'normal') || variants[0];
  const market = normalVariant?.market ?? null;

  const name = phase === 'jp'
    ? (c.translation?.en?.name || c.name || '')
    : (c.name || '');

  return {
    id: c.id,
    localId,
    name,
    rarity:    c.rarity || '',
    image,
    market,
    ...(shouldConvert ? { marketJPY: normalVariant?.marketJPY ?? null, isEstimate: true, fxRate } : {}),
    variants:  variants.length > 1 ? variants : [],
    supertype: c.supertype || '',
    subtypes:  c.subtypes || [],
    artist:    c.artist || '',
    expansion: c.expansion || null,
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  const { set, phase, q } = req.query;

  // ── Global name search ───────────────────────────────────────────
  if (q && !set) {
    // Cache by query in Redis 1h — same query = same results within an hour
    const qCacheKey = `scrydex:search:${q.toLowerCase().trim()}`;
    const qCached   = await redisGet(qCacheKey);
    if (qCached) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('X-Cache', 'HIT');
      const cards = JSON.parse(qCached);
      return res.status(200).json({ cards, total: cards.length, cached: true });
    }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');
    try {
      const url = `${SCRYDEX_BASE}/cards?q=name:${encodeURIComponent(q)}* -expansion.id:tcgp*&include=prices&page_size=20&select=id,name,rarity,images,variants,supertype,expansion`;
      const data = await fetchPage(url);
      const cards = (data.data || []).map(c => normaliseCard(c, c.expansion?.id || '', 'en'));
      // Cache if we got results
      if (cards.length > 0) await redisSetEx(qCacheKey, JSON.stringify(cards), 3600);
      return res.status(200).json({ cards, total: cards.length });
    } catch (e) {
      console.error('[scrydex-cards q]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Set-scoped fetch (Redis cached 6h) ───────────────────────────
  if (!set) return res.status(400).json({ error: 'Provide ?set= or ?q= param' });

  const isJP     = phase === 'jp';
  const scrydexId = isJP ? SCRYDEX_JP_ID_MAP[set] : SCRYDEX_EN_ID_MAP[set];
  if (!scrydexId) return res.status(400).json({ error: `Unknown set: ${set}` });

  const cacheKey = `scrydex:cards:${scrydexId}`;
  const cached   = await redisGet(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    const cards = JSON.parse(cached);
    return res.status(200).json({ cards, total: cards.length, cached: true });
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('X-Cache', 'MISS');
  try {
    const basePrefix    = isJP ? `${SCRYDEX_BASE}/ja` : SCRYDEX_BASE;
    const selectFields  = isJP
      ? 'id,name,translation,rarity,images,variants,supertype,subtypes,artist'
      : 'id,name,rarity,images,variants,supertype,subtypes,artist';

    const fxRate = isJP ? await getJpyToUsdRate() : null;

    const rawCards = await fetchAllPages(
      `${basePrefix}/expansions/${scrydexId}/cards?select=${selectFields}&include=prices&pageSize=100`
    );
    const cards = rawCards.map(c => normaliseCard(c, set, isJP ? 'jp' : 'en', fxRate));

    // Only cache if prices are actually present — prevents stale null-price cache
    const hasAnyPrice = cards.some(c => c.market != null);
    if (hasAnyPrice) {
      await redisSetEx(cacheKey, JSON.stringify(cards), CACHE_TTL_SEC);
    }

    return res.status(200).json({ cards, total: cards.length });
  } catch (e) {
    console.error('[scrydex-cards set]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

