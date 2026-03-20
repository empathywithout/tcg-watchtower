// api/cards.js
// Returns card list with rarities for a given set.
//
// Strategy 0: Scrydex API (fastest for new/JP sets, phase-aware)
// Strategy 1: R2 pre-built JSON (fastest for existing EN sets)
// Strategy 2: TCGCSV (TCGplayer mirror, has prices + rarity)
// Strategy 3: TCGdex (slowest fallback, per-card requests)
//
// URL: GET /api/cards?set=sv07
//      GET /api/cards?set=sv9b          (Japanese set ID — handled via sets.json phase)
//      GET /api/cards?set=me02pt5

const R2_BASE = process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';

const cache        = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// TCGplayer groupId map — used for TCGCSV fallback
const SET_TO_GROUP = {
  'sv01':'22873','sv02':'23120','sv03':'23228','sv3pt5':'23237',
  'sv04':'23286','sv4pt5':'23353','sv05':'23381','sv06':'23473',
  'sv6pt5':'23529','sv07':'23537','sv08':'23651','sv8pt5':'23821',
  'sv09':'24073','sv10':'24269',
  'me01':'24380','me02':'24448','me02pt5':'24541','me03':'24587',
};

// Our internal setId → Scrydex EN expansion ID
const SCRYDEX_EN_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10',
  'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03',
};

// Our internal setId → Scrydex JP expansion ID
// Add entries here when registering new JP-phase sets in sets.json
// e.g. 'sv11': 'sv9b'  (Ninja Spinner / Chaos Rising)
// This map is auto-populated by generate-set-page.js when PHASE=jp
const SCRYDEX_JP_ID_MAP = {};

// TCGdex dot-notation map for special sets
const TCGDEX_ID_MAP = {
  'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5',
  'me02pt5':'me02.5',
};

function tcgdexSeriesPrefix(setId) {
  return (setId.match(/^([a-z]+)/i) || ['','sv'])[1].toLowerCase();
}

function normalizeRarity(r) {
  if (!r) return '';
  return r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

// Read phase from sets.json at runtime so JP→EN switch requires no code deploy
async function getSetPhase(setId) {
  try {
    const { readFileSync } = await import('fs');
    const sets  = JSON.parse(readFileSync('sets.json', 'utf8'));
    const entry = sets.find(s => s.setId === setId);
    return entry?.phase || 'en';
  } catch {
    return 'en';
  }
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

  const phase        = await getSetPhase(setId);
  const tcgdexId     = TCGDEX_ID_MAP[setId] || setId;
  const seriesPrefix = tcgdexSeriesPrefix(tcgdexId);

  try {
    let cards = null;

    // ── Strategy 0: Scrydex ─────────────────────────────────────────────────
    if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
      try {
        const scrydexId = phase === 'jp'
          ? SCRYDEX_JP_ID_MAP[setId]
          : SCRYDEX_EN_ID_MAP[setId];

        if (scrydexId) {
          const langParam  = phase === 'jp' ? '&languageCode=JA' : '';
          const baseUrl    = `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,rarity,images&pageSize=100${langParam}`;
          let allCards     = [];
          let page         = 1;
          let totalCount   = null;

          while (true) {
            const scrydexRes = await fetch(`${baseUrl}&page=${page}`, {
              headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
              signal: AbortSignal.timeout(10000),
            });

            if (!scrydexRes.ok) {
              console.warn(`[api/cards] Scrydex ${scrydexRes.status} for ${setId}`);
              break;
            }

            const data      = await scrydexRes.json();
            const pageCards = data.data || [];
            if (totalCount === null) totalCount = data.totalCount || pageCards.length;
            allCards = allCards.concat(pageCards);
            if (pageCards.length < 100 || allCards.length >= totalCount) break;
            page++;
          }

          if (allCards.length > 0) {
            cards = allCards.map(c => {
              // Scrydex ID format: "sv01-001" → localId = "001"
              const localId      = c.id ? c.id.split('-').slice(1).join('-') : '';
              const scrydexImage = c.images?.[0]?.small || c.images?.[0]?.medium || null;
              // EN sets: prefer R2 image (already synced, faster CDN)
              // JP sets: use Scrydex image (not yet in R2)
              const image = phase === 'en'
                ? `${R2_BASE}/cards/${setId}/${localId}.webp`
                : (scrydexImage || `${R2_BASE}/cards/${setId}/${localId}.webp`);

              return { localId, name: c.name || '', rarity: normalizeRarity(c.rarity || ''), image, source: 'scrydex', phase };
            });
            console.log(`[api/cards] Scrydex hit for ${setId} (phase=${phase}): ${cards.length} cards`);
          }
        } else {
          console.log(`[api/cards] No Scrydex ID mapped for ${setId} — trying R2`);
        }
      } catch (e) {
        console.warn(`[api/cards] Scrydex failed for ${setId}:`, e.message);
      }
    }

    // ── Strategy 1: R2 pre-built JSON ───────────────────────────────────────
    if (!cards) {
      try {
        const r2Res = await fetch(`${R2_BASE}/data/${setId}.json`);
        if (r2Res.ok) {
          const r2Data = await r2Res.json();
          if (r2Data.cards && r2Data.cards.length > 0) {
            cards = r2Data.cards.map(c => ({
              localId: c.localId,
              name:    c.name,
              rarity:  normalizeRarity(c.rarity),
              image:   `${R2_BASE}/cards/${setId}/${c.localId}.webp`,
              source:  'r2',
              phase:   'en',
            }));
            console.log(`[api/cards] R2 hit for ${setId}: ${cards.length} cards`);
          }
        }
      } catch (e) {
        console.warn(`[api/cards] R2 failed for ${setId}:`, e.message);
      }
    }

    // ── Strategy 2: TCGCSV ──────────────────────────────────────────────────
    const groupId = SET_TO_GROUP[setId];
    if (!cards && groupId) {
      try {
        const [productsRes, rarityRes] = await Promise.all([
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`),
          fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/product/rarities`),
        ]);
        if (productsRes.ok) {
          const productsData = await productsRes.json();
          const rarityData   = rarityRes.ok ? await rarityRes.json() : { results: [] };
          const rarityMap    = {};
          (rarityData.results || []).forEach(r => { if (r.productId && r.name) rarityMap[r.productId] = r.name; });
          const cardRows = (productsData.results || []).filter(p => p.number && /^\d+[a-zA-Z]?$/.test(p.number));
          if (cardRows.length > 0) {
            cards = cardRows.map(p => ({
              localId: p.number,
              name:    p.name,
              image:   `${R2_BASE}/cards/${setId}/${p.number}.webp`,
              rarity:  normalizeRarity(rarityMap[p.productId] || ''),
              source:  'tcgcsv',
              phase:   'en',
            }));
            console.log(`[api/cards] TCGCSV hit for ${setId}: ${cards.length} cards`);
          }
        }
      } catch (e) {
        console.warn(`[api/cards] TCGCSV failed for ${setId}:`, e.message);
      }
    }

    // ── Strategy 3: TCGdex fallback ─────────────────────────────────────────
    if (!cards) {
      console.log(`[api/cards] TCGdex fallback for ${setId}`);
      const setRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${tcgdexId}`);
      if (!setRes.ok) return res.status(502).json({ error: `TCGdex failed: ${setRes.status}` });
      const setData    = await setRes.json();
      const basicCards = setData.cards || [];
      const BATCH      = 20;
      const fullCards  = [];
      for (let i = 0; i < basicCards.length; i += BATCH) {
        const batch   = basicCards.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(c => fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}-${c.localId}`).then(r => r.ok ? r.json() : null).catch(() => null))
        );
        results.forEach((result, idx) => {
          const basic  = batch[idx];
          const detail = result.status === 'fulfilled' ? result.value : null;
          fullCards.push({
            localId: basic.localId,
            name:    basic.name,
            image:   `https://assets.tcgdex.net/en/${seriesPrefix}/${tcgdexId}/${basic.localId}/high.webp`,
            rarity:  normalizeRarity(detail?.rarity || ''),
            source:  'tcgdex',
            phase:   'en',
          });
        });
      }
      cards = fullCards;
      console.log(`[api/cards] TCGdex for ${setId}: ${cards.length} cards`);
    }

    const responseData = { cards, cardCount: { total: cards.length }, phase };
    cache.set(setId, { ts: Date.now(), data: responseData });
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(responseData);

  } catch (e) {
    console.error('[api/cards] error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
