// api/tcgplayer-set-prices.js
// Fetches TCGplayer prices for any set by Scrydex expansion ID
// Uses known group ID map + dynamic TCGCSV lookup as fallback
// Redis cached 6h per set

import { fetch as undiciFetch } from 'undici';

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const HEADERS     = { 'User-Agent': 'TCGWatchtower/1.0' };
const KV_URL      = process.env.KV_REST_API_URL;
const KV_TOKEN    = process.env.KV_REST_API_TOKEN;

// Complete Scrydex expansion ID → TCGplayer group ID map
// Sources: TCGCSV groups endpoint + TCGplayer set pages
const KNOWN_GROUPS = {
  // ── Mega Evolution ──────────────────────────────────────────────
  'me1':'24380','me2':'24448','me2pt5':'24541','me3':'24587','me4':'24655','me5':'24688',
  // ── Scarlet & Violet ────────────────────────────────────────────
  'sv1':'22873','sv2':'23120','sv3':'23228','sv3pt5':'23237','sv4':'23286',
  'sv4pt5':'23353','sv5':'23381','sv6':'23473','sv6pt5':'23529','sv7':'23537',
  'sv8':'23651','sv8pt5':'23821','sv9':'24073','sv10':'24269',
  'zsv10pt5':'24325','rsv10pt5':'24326','svp':'22804',
  // ── Sword & Shield ──────────────────────────────────────────────
  'swsh1':'22157','swsh2':'22204','swsh3':'22292','swsh35':'22386','swsh4':'22420',
  'swsh45':'22468','swsh5':'22522','swsh6':'22572','swsh7':'22623','swsh8':'22691',
  'swsh9':'22741','swsh10':'22835','swsh11':'22909','swsh12':'22977',
  'swsh12pt5':'23099','swsh12pt5gg':'23100',
  // ── Sun & Moon ──────────────────────────────────────────────────
  'sm1':'1865','sm2':'1866','sm3':'1869','sm35':'2261','sm4':'1870',
  'sm5':'1872','sm6':'1874','sm7':'1877','sm75':'2259','sm8':'1897',
  'sm9':'2002','sm10':'2118','sm11':'2258','sm115':'2631','sm12':'2726','smp':'1876',
  // ── XY ──────────────────────────────────────────────────────────
  'xy1':'1694','xy2':'1696','xy3':'1699','xy4':'1700','xy5':'1702',
  'xy6':'1703','xy7':'1705','xy8':'1707','xy9':'1708','xy10':'1710',
  'xy11':'1711','xy12':'1712','xyp':'1714',
  // ── Black & White ───────────────────────────────────────────────
  // NOTE: BW and older group IDs use dynamic TCGCSV groups lookup
  // ── Base era ─────────────────────────────────────────────────────
  // TCGdex: base1=Shadowless(102 cards), base4=Base Set 2(130 cards)
  'base1':'1663',  // Base Set (Shadowless) — Charizard ~$2,146 unlimited holo
  'base4':'605',   // Base Set 2 — Charizard ~$436
  // ── Pokémon GO / McDonald's / Other ─────────────────────────────
  'pgo':'22704','mcd22':'22637','mcd23':'22903','mcd24':'23152',
  // ── Classic & Promos ────────────────────────────────────────────
  'clv':'23271','clc':'23272','clb':'23273',
};

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

async function findGroupIdByName(setName) {
  // Cache groups list 24h
  const cacheKey = 'tcgp:groups:pokemon';
  let groups = null;
  const cached = await redisGet(cacheKey);
  if (cached) {
    groups = JSON.parse(cached);
  } else {
    try {
      const res = await undiciFetch(`${TCGCSV_BASE}/3/groups`, {
        headers: HEADERS, signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        groups = data.results || [];
        await redisSetEx(cacheKey, JSON.stringify(groups), 24 * 60 * 60);
      }
    } catch { return null; }
  }
  if (!groups) return null;

  // Name corrections: Scrydex name → TCGplayer group name
  const NAME_CORRECTIONS = {
    'Base Set (Shadowless)': 'Base Set (Shadowless)',
    'Base Set': 'Base Set',
    'Base Set 2': 'Base Set 2',
    'Jungle': 'Jungle',
    'Fossil': 'Fossil',
    'Team Rocket': 'Team Rocket',
    'Gym Heroes': 'Gym Heroes',
    'Gym Challenge': 'Gym Challenge',
    'Neo Genesis': 'Neo Genesis',
    'Neo Discovery': 'Neo Discovery',
    'Neo Revelation': 'Neo Revelation',
    'Neo Destiny': 'Neo Destiny',
    'Legendary Collection': 'Legendary Collection',
  };

  const correctedName = NAME_CORRECTIONS[setName] || setName;
  const nameLower = correctedName.toLowerCase().trim();
  const match = groups.find(g => g.name?.toLowerCase().trim() === nameLower);
  return match ? String(match.groupId) : null;
}

async function fetchPrices(groupId) {
  const [prodRes, priceRes] = await Promise.all([
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/products`, { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/prices`,   { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!prodRes.ok || !priceRes.ok) throw new Error(`TCGCSV ${prodRes.status}/${priceRes.status}`);
  const [productsData, pricesData] = await Promise.all([prodRes.json(), priceRes.json()]);

  const products   = productsData.results || [];
  const pricesList = pricesData.results   || [];

  // Subtype priority — higher = more common/preferred default
  // Input: raw subTypeName string (mixed case, with spaces)
  const subtypePriority = (sub) => {
    const s = sub.toLowerCase().replace(/\s+/g, '');
    if (s.includes('reverse'))             return -1; // always skip
    if (s.includes('jumbo'))               return -1; // skip promos
    if (s.includes('metal'))               return -1; // skip special
    if (s === 'unlimitedholofoil')         return 10; // best for vintage
    if (s === 'unlimitedshadowlessholofoil') return 9;
    if (s === 'holofoil')                  return 8;  // modern holo
    if (s === 'normal')                    return 6;  // modern non-holo
    if (s === 'unlimited')                 return 7;  // vintage non-holo
    if (s.includes('1stedition'))          return 3;  // rare — show but not default
    if (s.includes('shadowless'))          return 2;
    return 4;
  };

  // Build productId → card number map from products
  const productCardNum = {};
  for (const product of products) {
    const numEntry = (product.extendedData || []).find(e => e.name === 'Number');
    if (!numEntry) continue;
    productCardNum[product.productId] = numEntry.value.split('/')[0].trim();
  }

  // Map card number → all variants with prices, and best price
  const prices   = {};
  const variants = {};
  const bestPrio = {};
  const seenVar  = {};

  for (const p of pricesList) {
    const sub = (p.subTypeName || '');
    if (subtypePriority(sub) < 0) continue; // skip reverse, jumbo, metal
    if (!p.marketPrice) continue;

    const cardNumber = productCardNum[p.productId];
    if (!cardNumber) continue;

    const varName = (p.subTypeName || '').replace(/\s+/g, '');
    const varKey  = `${cardNumber}:${varName}`;
    const prio    = subtypePriority(sub);

    // Collect all unique variants
    if (!seenVar[varKey]) {
      seenVar[varKey] = true;
      if (!variants[cardNumber]) variants[cardNumber] = [];
      variants[cardNumber].push({ name: varName, market: p.marketPrice });
    }

    // Track best price (highest priority)
    if (prio > (bestPrio[cardNumber] ?? -999)) {
      bestPrio[cardNumber] = prio;
      const market = p.marketPrice;
      prices[cardNumber]                          = market;
      prices[cardNumber.padStart(3, '0')]         = market;
      const parsed = parseInt(cardNumber, 10);
      if (!isNaN(parsed)) prices[String(parsed)] = market;
    }
  }

  // Sort variants: best (highest priority) first
  for (const num of Object.keys(variants)) {
    variants[num].sort((a, b) =>
      subtypePriority(b.name.toLowerCase()) - subtypePriority(a.name.toLowerCase())
    );
  }

  return { prices, variants, _debug: { priceRowCount: pricesList.length, productCount: products.length } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { setId, setName } = req.query;
  if (!setId) return res.status(400).json({ error: 'Provide ?setId=' });

  // Check Redis cache
  const cacheKey = `tcgp:prices:${setId}`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    // Handle both old format {key:price} and new format {prices:{}, variants:{}}
    const prices   = parsed.prices || parsed;
    const variants = parsed.variants || {};
    const keys     = Object.keys(prices);
    const looksValid = keys.length === 0 || keys.some(k => k.length <= 4 && !isNaN(parseInt(k)));
    if (looksValid) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ prices, variants, cached: true });
    }
  }

  res.setHeader('X-Cache', 'MISS');

  try {
    let groupId = KNOWN_GROUPS[setId];
    if (!groupId && setName) {
      groupId = await findGroupIdByName(setName);
    }
    if (!groupId) {
      return res.status(404).json({ error: `No TCGplayer group found for ${setId}` });
    }

    const result = await fetchPrices(groupId);
    const { prices, variants } = result;
    if (Object.keys(prices).length > 0) {
      await redisSetEx(cacheKey, JSON.stringify(result), 6 * 60 * 60);
    }
    return res.status(200).json({ prices, variants, groupId });
  } catch (e) {
    console.error('[tcgplayer-set-prices]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

