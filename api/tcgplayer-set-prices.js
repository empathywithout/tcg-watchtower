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
  'bw1':'501','bw2':'502','bw3':'503','bw4':'504','bw5':'505',
  'bw6':'506','bw7':'507','bw8':'508','bw9':'509','bw10':'510','bw11':'511','bwp':'512',
  // ── HeartGold & SoulSilver ──────────────────────────────────────
  'hgss1':'488','hgss2':'489','hgss3':'490','hgss4':'491','hgssp':'492',
  // ── Platinum ────────────────────────────────────────────────────
  'pl1':'486','pl2':'487','pl3':'485','pl4':'484','plp':'493',
  // ── Diamond & Pearl ─────────────────────────────────────────────
  'dp1':'480','dp2':'481','dp3':'482','dp4':'483','dp5':'479','dp6':'478','dp7':'477','dpp':'494',
  // ── EX Series ───────────────────────────────────────────────────
  'ex1':'1415','ex2':'1416','ex3':'1420','ex4':'1421','ex5':'1417',
  'ex6':'1419','ex7':'1422','ex8':'1423','ex9':'1424','ex10':'1425',
  'ex11':'1426','ex12':'1427','ex13':'1428','ex14':'1429','ex15':'1430','ex16':'1431',
  // ── e-Card Series ───────────────────────────────────────────────
  'ecard1':'1407','ecard2':'1408','ecard3':'1409',
  // ── Neo ─────────────────────────────────────────────────────────
  'neo1':'1400','neo2':'1401','neo3':'1402','neo4':'1403',
  // ── Gym ─────────────────────────────────────────────────────────
  'gym1':'1411','gym2':'1412',
  // ── Base/Jungle/Fossil ──────────────────────────────────────────
  'base1':'1390','base2':'1392','base3':'1391','base4':'1393','base5':'1394',
  'base6':'1395','basep':'1396',
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

  // Strict match only — avoid false positives
  const nameLower = setName.toLowerCase().trim();
  const match = groups.find(g => g.name?.toLowerCase().trim() === nameLower);
  return match ? String(match.groupId) : null;
}

async function fetchPrices(groupId) {
  const [prodRes, priceRes] = await Promise.all([
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/products`, { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
    undiciFetch(`${TCGCSV_BASE}/3/${groupId}/prices`,   { headers: HEADERS, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!prodRes.ok || !priceRes.ok) throw new Error(`TCGCSV fetch failed: ${prodRes.status}/${priceRes.status}`);
  const [productsData, pricesData] = await Promise.all([prodRes.json(), priceRes.json()]);

  // Build price lookup by productId — skip reverse holofoil, prefer Normal
  const priceByProductId = {};
  for (const p of (pricesData.results || [])) {
    const sub = (p.subTypeName || '').toLowerCase();
    if (sub.includes('reverse')) continue;
    const existing = priceByProductId[p.productId];
    if (!existing || (sub === 'normal' && (existing.subTypeName||'').toLowerCase() !== 'normal')) {
      priceByProductId[p.productId] = p;
    }
  }

  // Map card number → market price using extendedData
  const prices = {};
  for (const p of (productsData.results || [])) {
    const priceEntry = priceByProductId[p.productId];
    if (!priceEntry?.marketPrice) continue;
    const numEntry = (p.extendedData || []).find(e => e.name === 'Number');
    if (!numEntry) continue;
    const rawNum = numEntry.value.split('/')[0].trim();
    const market = priceEntry.marketPrice;
    prices[rawNum]                             = market;
    prices[rawNum.padStart(3,'0')]             = market;
    const parsed = parseInt(rawNum, 10);
    if (!isNaN(parsed)) prices[String(parsed)] = market;
  }
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
    const prices = JSON.parse(cached);
    // Validate cache has card-number keys not productId keys
    const keys = Object.keys(prices);
    const looksValid = keys.length === 0 || keys.some(k => k.length <= 4 && !isNaN(parseInt(k)));
    if (looksValid) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ prices, cached: true });
    }
    // Stale productId-keyed cache — delete and re-fetch
    console.log(`[tcgplayer-set-prices] Invalidating bad cache for ${setId}`);
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
