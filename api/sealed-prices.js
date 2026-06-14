// api/sealed-prices.js
// Proxies Scrydex sealed product endpoint with server-side credentials
// Redis cache: 6h TTL to limit Scrydex credit usage

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const KV_URL          = process.env.KV_REST_API_URL;
const KV_TOKEN        = process.env.KV_REST_API_TOKEN;

const CACHE_TTL_SEC = 6 * 60 * 60; // 6 hours

// Our internal setId → Scrydex expansion ID
const SCRYDEX_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10','zsv10pt5':'sv10.5-black','rsv10pt5':'sv10.5-white',
  'me01':'me1','me02':'me2','me02pt5':'me2.5','me03':'me3','me04':'me4','me05':'me5',
  // Short IDs from Scrydex expansion.id
  'me1':'me1','me2':'me2','me3':'me3','me4':'me4','me5':'me5',
  'sv1':'sv01','sv2':'sv02','sv3':'sv03','sv4':'sv04','sv5':'sv05',
  'sv6':'sv06','sv7':'sv07','sv8':'sv08','sv9':'sv09',
};

// Set name keywords — used for Scrydex name search (expansion.id filter unsupported)
const SET_NAME_MAP = {
  // Mega Evolution
  'me1':'Mega Evolution','me2':'Phantasmal Flames','me3':'Perfect Order',
  'me4':'Chaos Rising','me5':'Pitch Black',
  'me01':'Mega Evolution','me02':'Phantasmal Flames','me03':'Perfect Order',
  'me04':'Chaos Rising','me05':'Pitch Black',
  // Scarlet & Violet
  'sv01':'Scarlet Violet','sv1':'Scarlet Violet',
  'sv02':'Paldea Evolved','sv2':'Paldea Evolved',
  'sv03':'Obsidian Flames','sv3':'Obsidian Flames',
  'sv3pt5':'151','sv03.5':'151',
  'sv04':'Paradox Rift','sv4':'Paradox Rift',
  'sv4pt5':'Paldean Fates','sv04.5':'Paldean Fates',
  'sv05':'Temporal Forces','sv5':'Temporal Forces',
  'sv06':'Twilight Masquerade','sv6':'Twilight Masquerade',
  'sv6pt5':'Shrouded Fable','sv06.5':'Shrouded Fable',
  'sv07':'Stellar Crown','sv7':'Stellar Crown',
  'sv08':'Surging Sparks','sv8':'Surging Sparks',
  'sv8pt5':'Prismatic Evolutions','sv08.5':'Prismatic Evolutions',
  'sv09':'Journey Together','sv9':'Journey Together',
  'sv10':'Destined Rivals',
  'zsv10pt5':'Black Bolt','rsv10pt5':'White Flare',
  // One Piece
  'op14':'Azure','op15':'Kami','eb03':'Heroines',
  // Miscellaneous sets — use product name search
  'miscp':'Miscellaneous','mcd24':'McDonald','mcd23':'McDonald','mcd22':'McDonald',
  'clv':'Classic Venusaur','clc':'Classic Charizard','clb':'Classic Blastoise',
  'mep':'Mega Evolution Black Star','svp':'Scarlet Violet Black Star',
};

/* ── Redis helpers ─────────────────────────────────────────────────────── */
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

async function redisSetEx(key, value, ttlSec) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttlSec}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* silent */ }
}

/* ── Scrydex fetch ─────────────────────────────────────────────────────── */
async function fetchFromScrydex(url) {
  const res = await fetch(url, {
    headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Scrydex ${res.status}`);
  return res.json();
}

function normaliseProducts(raw) {
  return (raw || []).map(p => {
    const variant    = (p.variants || [])[0] || {};
    const prices     = variant.prices || [];
    const priceEntry = prices.find(e => e.type === 'raw') || prices[0] || null;
    return {
      id:    p.id,
      name:  p.name,
      type:  p.type || '',
      image: p.images?.[0]?.medium || p.images?.[0]?.small || null,
      expansion: {
        id:          p.expansion?.id,
        name:        p.expansion?.name,
        releaseDate: p.expansion?.release_date,
      },
      market: priceEntry?.market ?? null,
      trends: null, // populated when Scrydex plan upgraded
    };
  });
}

/* ── Handler ───────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // CDN cache: 1h for sets, 5min for searches
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const { setId, q, productId } = req.query;

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  try {
    let products = [];

    // ── Direct product ID fetch ──────────────────────────────────────
    if (productId) {
      const cacheKey = `sealed:product:${productId}`;
      const cached   = await redisGet(cacheKey);
      if (cached) {
        const p = JSON.parse(cached);
        if (p.length > 0 && p[0].market != null) {
          return res.status(200).json({ products: p, total: p.length, cached: true });
        }
      }
      // Single search by productId — most reliable, 1 credit
      let products = [];
      try {
        const data = await fetchFromScrydex(
          `${SCRYDEX_BASE}/sealed?q=${encodeURIComponent(productId)}&include=prices&page_size=5`
        );
        const match = (data.data || []).find(p => p.id === productId);
        if (match) products = normaliseProducts([match]);
      } catch {}

      if (products[0]?.market != null) {
        await redisSetEx(cacheKey, JSON.stringify(products), CACHE_TTL_SEC);
      }
      return res.status(200).json({ products, total: products.length });
    }

    if (setId) {
      const scrydexId = SCRYDEX_ID_MAP[setId] || setId;
      const setName   = SET_NAME_MAP[setId] || SET_NAME_MAP[scrydexId];

      // ── Check Redis cache first ──────────────────────────────────────
      const cacheKey = `sealed:prices:${scrydexId}`;
      const cached   = await redisGet(cacheKey);
      if (cached) {
        const p = JSON.parse(cached);
        // Don't serve stale null-price cache
        if (p.length === 0 || p.some(x => x.market != null)) {
          res.setHeader('X-Cache', 'HIT');
          return res.status(200).json({ products: p, total: p.length, cached: true });
        }
      }

      // ── Cache miss — fetch from Scrydex (costs 1 credit) ────────────
      res.setHeader('X-Cache', 'MISS');

      let data;
      if (setName) {
        data = await fetchFromScrydex(
          `${SCRYDEX_BASE}/sealed?q=name:${encodeURIComponent(setName)}*&include=prices&page_size=100`
        );
        products = normaliseProducts(
          (data.data || []).filter(p => p.expansion?.id === scrydexId)
        );
      } else {
        try {
          data = await fetchFromScrydex(
            `${SCRYDEX_BASE}/expansions/${scrydexId}/sealed?include=prices&page_size=100`
          );
          products = normaliseProducts(data.data || []);
        } catch {
          products = [];
        }
      }

      // Only cache if we got products with prices
      const hasPrice = products.some(p => p.market != null);
      if (products.length > 0 && hasPrice) {
        await redisSetEx(cacheKey, JSON.stringify(products), CACHE_TTL_SEC);
      }

    } else if (q) {
      // Search — Redis cached 1h per query
      const qKey = `sealed:search:${q.toLowerCase().trim()}`;
      const qCached = await redisGet(qKey);
      if (qCached) {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).json({ products: JSON.parse(qCached), total: JSON.parse(qCached).length, cached: true });
      }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      const data = await fetchFromScrydex(
        `${SCRYDEX_BASE}/sealed?q=name:${encodeURIComponent(q)}*&include=prices&page_size=20`
      );
      products = normaliseProducts(data.data || []);
      if (products.length > 0) await redisSetEx(qKey, JSON.stringify(products), 3600);

    } else {
      return res.status(400).json({ error: 'Provide setId or q param' });
    }

    return res.status(200).json({ products, total: products.length });

  } catch (e) {
    console.error('[sealed-prices]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

