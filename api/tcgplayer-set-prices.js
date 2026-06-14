// api/tcgplayer-set-prices.js
// Fetches TCGplayer prices for any Pokémon set, keyed by Scrydex expansion ID.
// Proxies through our verified TCGCSV group ID map; falls back to name lookup.
// Redis cached 6h.

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const HEADERS     = { 'User-Agent': 'TCGWatchtower/1.0' };
const KV_URL      = process.env.KV_REST_API_URL;
const KV_TOKEN    = process.env.KV_REST_API_TOKEN;

// Scrydex expansion ID → verified TCGplayer group ID
const KNOWN_GROUPS = {
  'me1':'24380','me2':'24448','me2pt5':'24541','me3':'24587','me4':'24655','me5':'24688',
  'sv1':'22873','sv2':'23120','sv3':'23228','sv3pt5':'23237','sv4':'23286',
  'sv4pt5':'23353','sv5':'23381','sv6':'23473','sv6pt5':'23529','sv7':'23537',
  'sv8':'23651','sv8pt5':'23821','sv9':'24073','sv10':'24269',
  'zsv10pt5':'24325','rsv10pt5':'24326','svp':'22804',
  'swsh1':'22157','swsh2':'22204','swsh3':'22292','swsh35':'22386','swsh4':'22420',
  'swsh45':'22468','swsh5':'22522','swsh6':'22572','swsh7':'22623','swsh8':'22691',
  'swsh9':'22741','swsh10':'22835','swsh11':'22909','swsh12':'22977',
  'swsh12pt5':'23099','swsh12pt5gg':'23100',
  'sm1':'1865','sm2':'1866','sm3':'1869','sm35':'2261','sm4':'1870',
  'sm5':'1872','sm6':'1874','sm7':'1877','sm75':'2259','sm8':'1897',
  'sm9':'2002','sm10':'2118','sm11':'2258','sm115':'2631','sm12':'2726','smp':'1876',
  'xy1':'1694','xy2':'1696','xy3':'1699','xy4':'1700','xy5':'1702',
  'xy6':'1703','xy7':'1705','xy8':'1707','xy9':'1708','xy10':'1710',
  'xy11':'1711','xy12':'1712','xyp':'1714',
  // Base era — verified via TCGCSV
  'base1':'1663', // Base Set (Shadowless)
  'base4':'605',  // Base Set 2
  'ex6':'1419',   // FireRed & LeafGreen
  'pgo':'22704','mcd22':'22637','mcd23':'22903','mcd24':'23152',
  'clv':'23271','clc':'23272','clb':'23273',
};

// Scrydex set name → TCGplayer group name (for dynamic lookup fallback)
const NAME_MAP = {
  'Base Set (Shadowless)':'Base Set (Shadowless)',
  'Base Set 2':'Base Set 2',
  'Jungle':'Jungle','Fossil':'Fossil','Team Rocket':'Team Rocket',
  'Gym Heroes':'Gym Heroes','Gym Challenge':'Gym Challenge',
  'Neo Genesis':'Neo Genesis','Neo Discovery':'Neo Discovery',
  'Neo Revelation':'Neo Revelation','Neo Destiny':'Neo Destiny',
  'Legendary Collection':'Legendary Collection',
  'FireRed & LeafGreen':'EX FireRed & LeafGreen',
};

async function redisGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }, signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const { result } = await r.json();
    return result ?? null;
  } catch { return null; }
}

async function redisSetEx(key, value, ttl) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, signal: AbortSignal.timeout(3000),
    });
  } catch {}
}

async function findGroupByName(name) {
  const cacheKey = 'tcgp:groups:pokemon';
  let groups = null;
  const cached = await redisGet(cacheKey);
  if (cached) { groups = JSON.parse(cached); }
  else {
    try {
      const r = await fetch(`${TCGCSV_BASE}/3/groups`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        groups = data.results || [];
        await redisSetEx(cacheKey, JSON.stringify(groups), 24 * 60 * 60);
      }
    } catch { return null; }
  }
  if (!groups) return null;
  const mapped = NAME_MAP[name] || name;
  const match = groups.find(g => g.name?.toLowerCase() === mapped.toLowerCase());
  return match ? String(match.groupId) : null;
}

async function fetchPrices(groupId) {
  const [pr, pp] = await Promise.all([
    fetch(`${TCGCSV_BASE}/3/${groupId}/products`, { headers: HEADERS, signal: AbortSignal.timeout(12000) }),
    fetch(`${TCGCSV_BASE}/3/${groupId}/prices`,   { headers: HEADERS, signal: AbortSignal.timeout(12000) }),
  ]);
  if (!pr.ok || !pp.ok) throw new Error(`TCGCSV ${pr.status}/${pp.status}`);
  const [prodData, priceData] = await Promise.all([pr.json(), pp.json()]);
  const products   = prodData.results  || [];
  const pricesList = priceData.results || [];

  // Priority: skip reverse holo & 1st edition by default; prefer normal > holofoil
  const priceByProductId = {};
  for (const p of pricesList) {
    const sub = (p.subTypeName || '').toLowerCase();
    if (sub.includes('reverse') || sub.includes('jumbo') || sub.includes('metal')) continue;
    if (!p.marketPrice) continue;
    const existing = priceByProductId[p.productId];
    if (!existing) {
      priceByProductId[p.productId] = p;
    } else {
      const existSub = (existing.subTypeName || '').toLowerCase();
      // Prefer: unlimited holo > holo > normal > unlimited > 1st edition
      const rank = s => s.includes('1st') ? 0 : s === 'unlimited holofoil' ? 5 : s === 'holofoil' ? 4 : s === 'normal' ? 3 : s === 'unlimited' ? 2 : 1;
      if (rank(sub) > rank(existSub)) priceByProductId[p.productId] = p;
    }
  }

  const prices = {};
  const seen   = {};
  for (const product of products) {
    const numEntry = (product.extendedData || []).find(e => e.name === 'Number');
    if (!numEntry) continue;
    const num = numEntry.value.split('/')[0].trim();
    const po  = priceByProductId[product.productId];
    if (!po?.marketPrice) continue;
    // Keep highest-ranked price per card number
    if (seen[num] !== undefined && seen[num] >= po.marketPrice) continue;
    seen[num]                        = po.marketPrice;
    prices[num]                      = po.marketPrice;
    prices[num.padStart(3, '0')]     = po.marketPrice;
    const n = parseInt(num, 10);
    if (!isNaN(n)) prices[String(n)] = po.marketPrice;
  }
  return prices;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const { setId, setName } = req.query;
  if (!setId) return res.status(400).json({ error: 'Provide ?setId=' });

  const cacheKey = `tcgp:prices:${setId}`;
  const cached   = await redisGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({ prices: JSON.parse(cached), cached: true });
  }

  res.setHeader('X-Cache', 'MISS');
  try {
    let groupId = KNOWN_GROUPS[setId];
    if (!groupId && setName) groupId = await findGroupByName(setName);
    if (!groupId) return res.status(404).json({ error: `No group found for ${setId}` });

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
