// api/scrydex-cards.js
// Fetches cards from Scrydex for portfolio use — Redis cached 6h

import { fetchTcgcsvProducts, filterCardProducts, mergeCards } from './_lib/tcgcsv-bridge.js';

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';

// TCGCSV group ID for the bridge -- only me05 currently has a real,
// confirmed value (verified via diagnostic script against live data).
const SET_TO_GROUP = {
  'me05': '24688',
  // JP sets — categoryId 85
  'm1l_ja': '24399',
  'm1s_ja': '24400',
  'm2_ja':  '24459',
  'm2a_ja': '24499',
  'm3_ja':  '24600',
  'm4_ja':  '24653',
  'm5_ja':  '24711',
  // SV JP sets — categoryId 85
  'sv1s_ja': '23605',
  'sv1v_ja': '23606',
  'sv1a_ja': '23598',
};
const TCGCSV_CATEGORY_JP = 85;
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
  // EN set IDs → Scrydex JP expansion IDs (used by EN pages with phase=jp)
  'me01':'me1','me02':'me2','me02pt5':'me2pt5','me03':'m3_ja','me04':'m4_ja','me05':'m5_ja',
  // ME JP set IDs
  'm1l_ja':'m1l_ja','m1s_ja':'m1s_ja','m2_ja':'m2_ja','m2a_ja':'m2a_ja',
  'm3_ja':'m3_ja','m4_ja':'m4_ja','m5_ja':'m5_ja',
  // SV JP set IDs
  'sv1s_ja':'sv1s_ja','sv1v_ja':'sv1v_ja','sv1a_ja':'sv1a_ja',
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

// JP-phase cards return `rarity` as raw Japanese text (confirmed from
// live data on Pitch Black/Abyss Eye) rather than the English rarity
// names used elsewhere on the site (static/set-page.js's CHASE_RARITIES).
// Without this, JP-phase cards can never match chase-rarity filtering
// anywhere on the site. Mapped from the actual confirmed distinct values
// seen in production, not a generic/assumed list:
const RARITY_JA_TO_EN = {
  '通常': 'Common',
  '希少': 'Rare',
  'ダブルレア': 'Double Rare',
  'アートレア': 'Illustration Rare',
  'スーパーレア': 'Ultra Rare', // NOT "Super Rare" -- confirmed via 2 independent
                                 // position-verified reference cards against real
                                 // TCGCSV data (Mega Darkrai ex #099, Mega Zeraora
                                 // ex #096, both this exact raw JP string, both
                                 // confirmed "Ultra Rare" by TCGCSV).
  'スペシャルアートレア': 'Special Illustration Rare',
  '超ウルトラレア': 'Mega Hyper Rare',
  '非': 'Uncommon', // originally left unmapped (seen on Sinistcha, thought
                     // possibly a truncated/non-standalone string) -- now
                     // confirmed via a comprehensive check across 13
                     // independent, unambiguous cards in this set, all
                     // agreeing this raw JP string reliably means "Uncommon".
};

function translateRarity(rawRarity, phase) {
  if (phase !== 'jp') return rawRarity || '';
  return RARITY_JA_TO_EN[rawRarity] || rawRarity || '';
}

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
    rarity:    translateRarity(c.rarity, phase),
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

  // Versioned -- bumped when the TCGCSV bridge was added, so a stale
  // cached entry from before that change can never mask whether the new
  // code is actually working (this is exactly what happened today: this
  // cache masked the bridge fix for a while after it deployed).
  const cacheKey = `scrydex:cards:v9-force-refresh:${scrydexId}`;
  const cached   = await redisGet(cacheKey);
  if (cached) {
    // Same reasoning as api/cards.js: JP-phase data is actively volatile
    // right now, and a long edge-cache window here masked the bridge fix
    // for a while after it deployed today, independent of the Redis TTL.
    res.setHeader('Cache-Control', isJP
      ? 's-maxage=60, stale-while-revalidate=300'
      : 's-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'HIT');
    const cards = JSON.parse(cached);
    return res.status(200).json({ cards, total: cards.length, cached: true });
  }

  res.setHeader('Cache-Control', isJP
    ? 's-maxage=60, stale-while-revalidate=300'
    : 's-maxage=3600, stale-while-revalidate=86400');
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
    let cards = rawCards.map(c => normaliseCard(c, set, isJP ? 'jp' : 'en', fxRate));

    // TCGCSV bridge: only activates for JP-phase sets with a registered
    // group ID. Relinks existing pricing/data across the position shift
    // using a NAME+RARITY composite key -- NOT position (which moves
    // between JP and EN numbering) and NOT name alone (which collides for
    // any card with multiple rarity variants sharing a name -- e.g. Mega
    // Darkrai ex has 4; verified this would otherwise misattribute 3 of 4
    // real prices before this fix).
    const bridgeGroupId = isJP ? SET_TO_GROUP[set] : null;
    if (bridgeGroupId) {
      try {
        const tcgcsvCategory = set.endsWith('_ja') ? TCGCSV_CATEGORY_JP : undefined;
        const tcgcsvProducts = await fetchTcgcsvProducts(bridgeGroupId, tcgcsvCategory);
        const tcgcsvCardProducts = filterCardProducts(tcgcsvProducts);
        const jpShaped = cards.map(c => ({ localId: c.localId, name: c.name, rarity: c.rarity, image: c.image }));
        const { cards: mergedIdentity, jpFallbackCount } = mergeCards(tcgcsvCardProducts, jpShaped);

        const originalByKey = {};
        for (const c of cards) originalByKey[`${c.name.toLowerCase()}|${(c.rarity||'').toLowerCase()}`] = c;

        // Fetch TCGplayer EN prices for JP sets via TCGCSV
        let priceMap = {};
        try {
          const tcgcsvCategory = set.endsWith('_ja') ? TCGCSV_CATEGORY_JP : 3;
          const pricesRes = await fetch(`https://tcgcsv.com/tcgplayer/${tcgcsvCategory}/${bridgeGroupId}/prices`, {
            headers: { 'User-Agent': 'TCGWatchtower/1.0' },
            signal: AbortSignal.timeout(10000),
          });
          if (pricesRes.ok) {
            const pricesData = await pricesRes.json();
            for (const p of (pricesData.results || [])) {
              if (p.subTypeName === 'Normal' || p.subTypeName === 'Holofoil') {
                const existing = priceMap[p.productId];
                const price = p.marketPrice ?? p.lowPrice ?? null;
                if (!existing || (price != null && (existing.market == null || price > existing.market))) {
                  priceMap[p.productId] = { market: price };
                }
              }
            }
            console.log(`[scrydex-cards] TCGCSV prices fetched for ${set}: ${Object.keys(priceMap).length} priced products`);
          }
        } catch (priceErr) {
          console.warn(`[scrydex-cards] TCGCSV price fetch failed for ${set}:`, priceErr.message);
        }

        cards = mergedIdentity.map(m => {
          const key = `${m.name.toLowerCase()}|${(m.rarity||'').toLowerCase()}`;
          const original = originalByKey[key];
          const priceEntry = m.productId ? priceMap[m.productId] : null;
          // Use EN TCGplayer price if available, fall back to JP Scrydex price
          const market = priceEntry?.market ?? original?.market ?? null;
          if (original) {
            return { ...original, localId: m.localId, name: m.name, rarity: m.rarity, image: m.image || original.image, source: m.source, market, marketJPY: market === original?.market ? original?.marketJPY : undefined, isEstimate: market === original?.market ? original?.isEstimate : false };
          }
          return { localId: m.localId, name: m.name, rarity: m.rarity, image: m.image, market, source: m.source };
        });
        console.log(`[scrydex-cards] TCGCSV bridge hit for ${set}: ${cards.length} cards (${jpFallbackCount} from JP fallback)`);
      } catch (e) {
        console.warn(`[scrydex-cards] TCGCSV bridge failed for ${set}, using JP-only cards:`, e.message);
      }
    }

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

