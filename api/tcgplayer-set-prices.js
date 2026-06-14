// api/tcgplayer-set-prices.js
// Fetches TCGplayer prices for any set by Scrydex expansion ID
// Looks up TCGplayer group ID dynamically from TCGCSV groups list
// Redis cached 6h

import { fetch as undiciFetch } from 'undici';

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const HEADERS     = { 'User-Agent': 'TCGWatchtower/1.0' };
const KV_URL      = process.env.KV_REST_API_URL;
const KV_TOKEN    = process.env.KV_REST_API_TOKEN;

// Known Scrydex ID → TCGplayer group ID (verified)
// Only include sets we've confirmed — others use dynamic TCGCSV lookup
const KNOWN_GROUPS = {
  // Scarlet & Violet
  'sv1':'22873','sv2':'23120','sv3':'23228','sv3pt5':'23237','sv4':'23286',
  'sv4pt5':'23353','sv5':'23381','sv6':'23473','sv6pt5':'23529','sv7':'23537',
  'sv8':'23651','sv8pt5':'23821','sv9':'24073','sv10':'24269',
  'zsv10pt5':'24325','rsv10pt5':'24326',
  // Mega Evolution
  'me1':'24380','me2':'24448','me2pt5':'24541','me3':'24587','me4':'24655','me5':'24688',
  // Sword & Shield
  'swsh1':'22157','swsh2':'22204','swsh3':'22292','swsh35':'22386','swsh4':'22420',
  'swsh45':'22468','swsh5':'22522','swsh6':'22572','swsh7':'22623','swsh8':'22691',
  'swsh9':'22741','swsh10':'22835','swsh11':'22909','swsh12':'22977','swsh12pt5':'23099',
  // Sun & Moon
  'sm1':'1865','sm2':'1866','sm3':'1869','sm35':'2261','sm4':'1870',
  'sm5':'1872','sm6':'1874','sm7':'1877','sm75':'2259','sm8':'1897',
  'sm9':'2002','sm10':'2118','sm11':'2258','sm115':'2631','sm12':'2726',
  // XY
  'xy1':'1694','xy2':'1696','xy3':'1699','xy4':'1700','xy5':'1702',
  'xy6':'1703','xy7':'1705','xy8':'1707','xy9':'1708','xy10':'1710',
  'xy11':'1711','xy12':'1712',
  // Black & White
  'bw1':'501','bw2':'502','bw3':'503','bw4':'504','bw5':'505',
  'bw6':'506','bw7':'507','bw8':'508','bw9':'509','bw10':'510','bw11':'511',
  // Older sets — rely on dynamic lookup if not here
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

async function findGroupId(setId, setName) {
  // Cache the full groups list in Redis for 24h to avoid repeated fetches
  const groupsCacheKey = 'tcgp:groups:pokemon';
  let groups = null;
  const cachedGroups = await redisGet(groupsCacheKey);
  if (cachedGroups) {
    groups = JSON.parse(cachedGroups);
  } else {
    try {
      const res = await undiciFetch(`${TCGCSV_BASE}/3/groups`, {
        headers: HEADERS, signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        groups = data.results || [];
        await redisSetEx(groupsCacheKey, JSON.stringify(groups), 24 * 60 * 60);
      }
    } catch { return null; }
  }
  if (!groups) return null;

  const nameLower = (setName || setId).toLowerCase();
  // Try exact match first, then partial
  const exact = groups.find(g => g.name?.toLowerCase() === nameLower);
  if (exact) return String(exact.groupId);
  const partial = groups.find(g => g.name?.toLowerCase().includes(nameLower) || nameLower.includes(g.name?.toLowerCase()));
  return partial ? String(partial.groupId) : null;
}

async function fetchPrices(groupId) {
  const [prodRes, priceRes] = await Promise.all([
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/products`, { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/prices`,   { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!prodRes.ok || !priceRes.ok) throw new Error('TCGCSV fetch failed');
  const [products, pricesData] = await Promise.all([prodRes.json(), priceRes.json()]);

  const priceMap = {};
  (pricesData.results || []).forEach(p => { priceMap[p.productId] = p.marketPrice; });

  const prices = {};
  (products.results || []).forEach(p => {
    const market = priceMap[p.productId];
    if (market != null) {
      const num = p.number || String(p.productId);
      prices[num] = market;
      prices[num.padStart(3,'0')] = market;
      prices[String(parseInt(num,10) || num)] = market;
    }
  });
  return prices;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { setId, setName } = req.query;
  if (!setId) return res.status(400).json({ error: 'Provide ?setId=' });

  // Check Redis cache
  const cacheKey = `tcgp:prices:${setId}`;
  const cached   = await redisGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ prices: JSON.parse(cached), cached: true });
  }

  res.setHeader('X-Cache', 'MISS');

  try {
    // Get group ID — use known map first, then look up dynamically
    let groupId = KNOWN_GROUPS[setId];
    if (!groupId) {
      groupId = await findGroupId(setId, setName);
    }
    if (!groupId) {
      return res.status(404).json({ error: `No TCGplayer group found for ${setId}` });
    }

    const prices = await fetchPrices(groupId);
    if (Object.keys(prices).length > 0) {
      await redisSetEx(cacheKey, JSON.stringify(prices), 6 * 60 * 60);
    }
    return res.status(200).json({ prices, groupId });
  } catch (e) {
    console.error('[tcgplayer-set-prices]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

