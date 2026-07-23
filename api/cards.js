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

import { fetchTcgcsvProducts, filterCardProducts, mergeCards, TCGCSV_CATEGORY_POKEMON } from './_lib/tcgcsv-bridge.js';
const TCGCSV_CATEGORY_POKEMON_JP = 85;

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
  'me01':'24380','me02':'24448','me02pt5':'24541','me03':'24587','me04':'24655',
  'me05':'24688', // confirmed real via diagnostic script against live TCGCSV data (120/120 cards, 100% images)
  // JP sets — categoryId 85 on TCGCSV (Pokemon Japan)
  // TODO: verify these group IDs at https://tcgcsv.com/tcgplayer/85/groups
  'm1l_ja': null, // Mega Brave
  'm1s_ja': null, // Mega Symphonia
  'm2_ja':  null, // Inferno X
  'm2a_ja': null, // MEGA Dream ex
  'm3_ja':  null, // Nihil Zero
  'm4_ja':  null, // Ninja Spinner
  'm5_ja':  null, // Abyss Eye
};

// Our internal setId → Scrydex EN expansion ID
const SCRYDEX_EN_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10',
  'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03','me04':'me04',
};

// Our internal setId → Scrydex JP expansion ID
// Add entries here when registering new JP-phase sets in sets.json
// e.g. 'sv11': 'sv9b'  (Ninja Spinner / Chaos Rising)
// This map is auto-populated by generate-set-page.js when PHASE=jp
const SCRYDEX_JP_ID_MAP = {
  // EN set IDs → Scrydex JP expansion IDs (used by EN pages with PHASE=jp)
  'me01': 'me01',
  'me02': 'me02',
  'me02pt5': 'me02.5',
  'me03': 'm3_ja',
  'me04': 'm4_ja',
  // me05 removed — Scrydex EN data live as of July 17 2026

  // JP set IDs → Scrydex JP expansion IDs (used by dedicated JP pages)
  'm1l_ja': 'm1l_ja',
  'm1s_ja': 'm1s_ja',
  'm2_ja':  'm2_ja',
  'm2a_ja': 'm2a_ja',
  'm3_ja':  'm3_ja',
  'm4_ja':  'm4_ja',
  'm5_ja':  'm5_ja',
};

// TCGdex dot-notation map for special sets
const TCGDEX_ID_MAP = {
  'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5',
  'me02pt5':'me02.5',
};

function tcgdexSeriesPrefix(setId) {
  return (setId.match(/^([a-z]+)/i) || ['','sv'])[1].toLowerCase();
}

// Japanese rarity name → English rarity name
const JP_RARITY_MAP = {
  // Common
  'C':                              'Common',
  'コモン':                          'Common',
  '通常':                            'Common',
  // Uncommon
  'U':                              'Uncommon',
  'アンコモン':                       'Uncommon',
  '非':                              'Uncommon',
  // Rare
  'R':                              'Rare',
  'レア':                            'Rare',
  '希少':                            'Rare',
  // Double Rare
  'RR':                             'Double Rare',
  'スーパーレア':                     'Double Rare',
  'ダブルレア':                       'Double Rare',
  // Ultra Rare
  'SR':                             'Ultra Rare',
  'Uレア':                           'Ultra Rare',
  'ウルトラレア':                     'Ultra Rare',
  // Illustration Rare
  'IR':                             'Illustration Rare',
  'イラストレア':                     'Illustration Rare',
  'アートレア':                       'Illustration Rare',
  // Special Illustration Rare
  'SAR':                            'Special Illustration Rare',
  'スペシャルイラストレア':            'Special Illustration Rare',
  'スペシャルアートレア':              'Special Illustration Rare',
  // Hyper Rare
  'HR':                             'Hyper Rare',
  'ハイパーレア':                     'Hyper Rare',
  'ゴールデンレア':                   'Hyper Rare',
  // Mega Hyper Rare / Super Ultra Rare (top rainbow rarity in Mega Evolution era)
  'MHR':                            'Mega Hyper Rare',
  'メガハイパーレア':                 'Mega Hyper Rare',
  '超ウルトラレア':                   'Mega Hyper Rare',
  'スーパーウルトラレア':              'Mega Hyper Rare',
  // Promo
  'PR':                             'Promo',
  'プロモ':                           'Promo',
  // ACE SPEC
  'ACE':                            'ACE SPEC Rare',
  'ACEスペック':                      'ACE SPEC Rare',
  // Shiny
  'S':                              'Shiny Rare',
  'シャイニー':                       'Shiny Rare',
  'SSR':                            'Shiny Ultra Rare',
  'シャイニースーパーレア':            'Shiny Ultra Rare',
};

function normalizeRarity(r) {
  if (!r) return '';
  // Check JP translation first
  if (JP_RARITY_MAP[r.trim()]) return JP_RARITY_MAP[r.trim()];
  // Title-case English rarity
  return r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

// Read phase from sets.json at runtime so JP→EN switch requires no code deploy
// Explicit, hardcoded phase map -- NOT a runtime sets.json file read.
// That approach (readFileSync('sets.json') inside a try/catch that
// silently fell back to 'en' on any failure) is almost certainly why
// the whole TCGCSV bridge appeared not to work today: serverless
// functions only reliably bundle files that are statically detectable
// as dependencies, and a dynamic readFileSync with a bare relative path
// is exactly the kind of thing that can silently fail to be included at
// deploy time or resolve against the wrong working directory at runtime.
// Confirmed via a real API response showing phase:"en" + source:"r2" for
// me05 -- meaning this function had been resolving phase to 'en' the
// entire time, regardless of what sets.json actually says, silently
// bypassing the JP-phase bridge code path entirely. Only me05 is
// currently JP-phase; every other set defaults to 'en' as before.
const SET_PHASE_MAP = {
  'me05': 'en', // flipped to EN — Scrydex EN data confirmed available
  // Dedicated JP set pages — always use Scrydex JP endpoint
  'm1l_ja': 'jp',
  'm1s_ja': 'jp',
  'm2_ja':  'jp',
  'm2a_ja': 'jp',
  'm3_ja':  'jp',
  'm4_ja':  'jp',
  'm5_ja':  'jp',
};
async function getSetPhase(setId) {
  return SET_PHASE_MAP[setId] || 'en';
}

// Background-write card metadata + images to R2 after a Scrydex hit.
// Runs async — does NOT block the response. Next request hits R2 for free.
async function cacheToR2InBackground(setId, cards, phase) {
  const endpoint  = process.env.CF_R2_ENDPOINT;
  const accessKey = process.env.CF_R2_ACCESS_KEY;
  const secretKey = process.env.CF_R2_SECRET_KEY;
  const bucket    = process.env.CF_R2_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) return;

  // Don't cache if we got suspiciously few cards — likely a partial Scrydex response
  // Most sets have 100+ cards; only cache if we got at least 80 or it's a known small set
  const KNOWN_SMALL_SETS = ['sv3pt5', 'sv4pt5', 'sv6pt5', 'sv8pt5', 'me02pt5'];
  const minExpected = KNOWN_SMALL_SETS.includes(setId) ? 20 : 80;
  if (cards.length < minExpected) {
    console.warn(`[r2-cache] Skipping cache for ${setId} — only ${cards.length} cards (min ${minExpected}), likely partial`);
    return;
  } // R2 not configured

  try {
    const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'auto', endpoint,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });

    // 1 — Upload metadata JSON (always, even for JP — marks the set as known to R2)
    const metadata = {
      id: setId, phase,
      cardCount: { official: cards.length, total: cards.length },
      cards: cards.map(c => ({ localId: c.localId, name: c.name, rarity: c.rarity })),
    };
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: `data/${setId}.json`,
      Body: JSON.stringify(metadata), ContentType: 'application/json',
      CacheControl: 'public, max-age=3600',
    }));
    console.log(`[r2-cache] Wrote data/${setId}.json`);

    // 2 — Download and upload card images that aren't in R2 yet
    // Skip for EN sets where image URL is already pointing at R2 (would be circular)
    if (phase === 'jp') {
      let uploaded = 0, skipped = 0;
      for (const card of cards) {
        if (!card.image || card.image.includes(process.env.CF_R2_PUBLIC_URL)) continue;
        const r2Key = `cards/${setId}/${card.localId}.webp`;
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }));
          skipped++;
          continue; // already exists
        } catch { /* not in R2 yet — upload it */ }
        try {
          const imgRes = await fetch(card.image, { signal: AbortSignal.timeout(10000) });
          if (!imgRes.ok) continue;
          const buf = Buffer.from(await imgRes.arrayBuffer());
          await s3.send(new PutObjectCommand({
            Bucket: bucket, Key: r2Key, Body: buf,
            ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
          }));
          uploaded++;
        } catch (e) {
          console.warn(`[r2-cache] image upload failed ${card.localId}: ${e.message}`);
        }
      }
      console.log(`[r2-cache] JP images: ${uploaded} uploaded, ${skipped} skipped`);
    }
  } catch (e) {
    console.warn(`[r2-cache] background write failed for ${setId}:`, e.message);
  }
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const setId = (req.query.set || '').trim();
  const game  = (req.query.game || '').trim().toLowerCase(); // 'onepiece' or 'pokemon' (default)
  if (!setId || !/^[a-z0-9_]+$/.test(setId)) {
    return res.status(400).json({ error: 'Missing or invalid ?set= parameter' });
  }

  // Detect One Piece sets by prefix or explicit game param
  const isOnePiece = game === 'onepiece'
    || /^(op|eb|st)\d+/.test(setId);

  // Version prefix -- bump this whenever the underlying data-shape/logic
  // changes meaningfully (e.g. the TCGCSV bridge added here), so a stale
  // in-memory cache entry from before the change can never mask whether
  // new code is actually working. Hit this exact problem today: the
  // Redis cache in api/scrydex-cards.js masked the bridge fix for a
  // while, and this in-memory cache did the same thing here.
  const CACHE_VERSION = 'v4-en-phase-flip'; // bumped — me05 flipped to EN, force fresh Scrydex fetch
  const cacheKey = `${CACHE_VERSION}:${isOnePiece ? 'op:' : ''}${setId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    // JP-phase data is actively volatile right now (bridging from JP to
    // English as TCGCSV fills in) -- a long CDN cache window here caused a
    // real problem today: the edge cache kept serving a response from
    // before the bridge fix deployed for far longer than the in-memory
    // cache's own 1h TTL, since s-maxage/stale-while-revalidate operate
    // independently at Vercel's edge, in front of this function entirely.
    // EN-phase (stable, already-released) sets keep the original, longer
    // caching -- this is specifically about data that's still changing.
    res.setHeader('Cache-Control', cached.data.phase === 'jp'
      ? 's-maxage=60, stale-while-revalidate=300'
      : 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(cached.data);
  }

  // ── One Piece: read from R2 data/op/{setId}.json ─────────────────────────
  if (isOnePiece) {
    try {
      const r2Url = `${R2_BASE}/data/op/${setId}.json`;
      const r2Res = await fetch(r2Url, { signal: AbortSignal.timeout(5000) });
      if (r2Res.ok) {
        const json = await r2Res.json();
        // Same data-quality fixes as generate-op-card-pages.js, kept in sync
        // manually. CORRECTED: previously excluded 'Nami' here based on a
        // wrong assumption (shared image URL with 'King' at localId 031
        // implied one was fake). Confirmed via the official One Piece Card
        // Game site that BOTH are real cards -- OP14-031 is Nami (Super
        // Rare), EB04-031 is King (Rare), two different real cards sharing
        // a plain number since this set merges two independently-numbered
        // source releases. The real bug is a missing distinct image for
        // Nami, not a fake card -- KNOWN_BAD_RECORDS left empty for now.
        const KNOWN_BAD_RECORDS = {};
        const VARIANT_TYPE_RARITY = {
          treasureRare: 'Treasure Rare', altArt: 'Alternate Art',
          specialAltArt: 'Special', goldSpecialAltArt: 'Special', mangaAltArt: 'Manga Rare',
        };
        const badRecords = KNOWN_BAD_RECORDS[setId] || [];
        const cleanedRaw = (json.cards || []).filter(c => {
          if (badRecords.some(b => b.localId === c.localId && b.name === c.name)) return false;
          // Known exception: Scrydex sometimes labels a Treasure Rare variant
          // as "altArt" internally (e.g. Vista OP16-011), corrected via
          // RARITY_OVERRIDES in sync-op-images.mjs -- a legitimate fix, not
          // a data error, so it must not get silently filtered out here.
          const isKnownAltArtTreasureRareOverride = c.variantType === 'altArt' && c.rarity === 'Treasure Rare';
          if (!isKnownAltArtTreasureRareOverride && c.isVariant && c.variantType && VARIANT_TYPE_RARITY[c.variantType]
              && c.rarity !== VARIANT_TYPE_RARITY[c.variantType]) return false;
          return true;
        });
        const cards = cleanedRaw.map(c => ({
          ...c,
          image: c.image || `${R2_BASE}/cards/op/${setId}/${c.localId}.webp`,
          source: 'r2',
        }));
        const data = { cards, cardCount: json.cardCount || { total: cards.length }, phase: json.phase || 'en', game: 'onepiece' };
        cache.set(cacheKey, { ts: Date.now(), data });
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).json(data);
      }
    } catch(e) {
      console.warn(`[api/cards] One Piece R2 failed for ${setId}:`, e.message);
    }

    // Fallback: fetch from Scrydex One Piece API
    try {
      const scrydexId = setId.toUpperCase(); // op01 → OP01
      const url = `https://api.scrydex.com/onepiece/v1/expansions/${scrydexId}/cards?select=id,name,rarity,images&pageSize=100&page=1`;
      const scrydexRes = await fetch(url, {
        headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
        signal: AbortSignal.timeout(10000),
      });
      if (scrydexRes.ok) {
        const json = await scrydexRes.json();
        const cards = (json.data || []).map(c => {
          const rawId = c.id ? c.id.split('-').slice(1).join('-') : '';
          const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
          return {
            localId,
            name: (c.name || '').trim(),
            rarity: c.rarity || '',
            image: c.images?.[0]?.large || c.images?.[0]?.medium || `${R2_BASE}/cards/op/${setId}/${localId}.webp`,
            source: 'scrydex',
            phase: 'en',
          };
        });
        const data = { cards, cardCount: { total: cards.length }, phase: 'en', game: 'onepiece' };
        cache.set(cacheKey, { ts: Date.now(), data });
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).json(data);
      }
    } catch(e) {
      console.warn(`[api/cards] One Piece Scrydex failed for ${setId}:`, e.message);
    }

    return res.status(404).json({ error: `No data found for One Piece set: ${setId}` });
  }

  const phase        = await getSetPhase(setId);
  const tcgdexId     = TCGDEX_ID_MAP[setId] || setId;
  const seriesPrefix = tcgdexSeriesPrefix(tcgdexId);

  try {
    let cards = null;

    // ── Strategy 0: R2 pre-built JSON (EN sets — fastest, free, no API credits) ─
    // Always try R2 first for EN sets. Scrydex only used when R2 misses (new sets)
    // or for JP phase (images not in R2 yet).
    if (phase === 'en') {
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

    // ── Strategy 1: Scrydex ──────────────────────────────────────────────────
    // JP phase: always (R2 won't have JP images until after sync-images runs)
    // EN phase: only when R2 missed — means it's a brand new set not yet synced
    if (!cards && SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
      try {
        const scrydexId = phase === 'jp'
          ? SCRYDEX_JP_ID_MAP[setId]
          : SCRYDEX_EN_ID_MAP[setId];

        if (scrydexId) {
          // Use /ja/ URL prefix for JP — enables translation.en fields
          const baseUrl = phase === 'jp'
            ? `${SCRYDEX_BASE}/ja/expansions/${scrydexId}/cards?select=id,name,translation,rarity,images&pageSize=100`
            : `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,rarity,images&pageSize=100`;
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
            if (totalCount === null) totalCount = data.totalCount || data.total || null;
            allCards = allCards.concat(pageCards);
            if (pageCards.length === 0) break;
            if (pageCards.length < 100) break;
            if (totalCount !== null && allCards.length >= totalCount) break;
            page++;
          }

          if (allCards.length > 0) {
            const bridgeGroupId = phase === 'jp' ? SET_TO_GROUP[setId] : null;

            if (bridgeGroupId) {
              try {
                const tcgcsvCategory = setId.endsWith('_ja') ? TCGCSV_CATEGORY_POKEMON_JP : TCGCSV_CATEGORY_POKEMON;
                const tcgcsvProducts = await fetchTcgcsvProducts(bridgeGroupId, tcgcsvCategory);
                const tcgcsvCardProducts = filterCardProducts(tcgcsvProducts);

                const jpShaped = allCards.map((c) => {
                  const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
                  const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
                  const scrydexImage = c.images?.[0]?.small || c.images?.[0]?.medium || null;
                  return {
                    localId,
                    name: c.translation?.en?.name || (c.name || '').replace(/\s*[-\u2013\u2014]\s*\d+\/\d+\s*$/, '').trim(),
                    rarity: c.translation?.en?.rarity || c.rarity || '',
                    image: scrydexImage,
                  };
                });

                const { cards: mergedCards, jpFallbackCount } = mergeCards(tcgcsvCardProducts, jpShaped);
                cards = mergedCards.map(c => ({
                  localId: c.localId,
                  name: c.name,
                  rarity: normalizeRarity(c.rarity),
                  image: c.image || `${R2_BASE}/cards/${setId}/${c.localId}.webp`,
                  source: c.source,
                  phase,
                }));
                console.log(`[api/cards] TCGCSV bridge hit for ${setId}: ${cards.length} cards (${jpFallbackCount} from JP fallback)`);
              } catch (e) {
                console.warn(`[api/cards] TCGCSV bridge failed for ${setId}, falling back to Scrydex-only:`, e.message);
              }
            }

            if (!cards) {
              cards = allCards.map((c) => {
                const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
                const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;

                const scrydexImage = c.images?.[0]?.small || c.images?.[0]?.medium || null;
                const image = phase === 'en'
                  ? `${R2_BASE}/cards/${setId}/${localId}.webp`
                  : (scrydexImage || `${R2_BASE}/cards/${setId}/${localId}.webp`);

                const name = phase === 'jp'
                  ? (c.translation?.en?.name || (c.name || '').replace(/\s*[-\u2013\u2014]\s*\d+\/\d+\s*$/, '').trim())
                  : (c.name || '').replace(/\s*[-\u2013\u2014]\s*\d+\/\d+\s*$/, '').trim();

                const rarity = normalizeRarity(
                  phase === 'jp' ? (c.translation?.en?.rarity || c.rarity || '') : (c.rarity || '')
                );

                return { localId, name, rarity, image, source: 'scrydex', phase };
              });
            }
            console.log(`[api/cards] Scrydex hit for ${setId} (phase=${phase}): ${cards.length} cards`);
            // Fire-and-forget: cache metadata + images to R2 so next request is free
            cacheToR2InBackground(setId, cards, phase).catch(() => {});
          }
        } else {
          console.log(`[api/cards] No Scrydex ID mapped for ${setId} — skipping`);
        }
      } catch (e) {
        console.warn(`[api/cards] Scrydex failed for ${setId}:`, e.message);
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
    // Only cache to in-memory if we got a reasonable card count
    // Avoid caching suspiciously small results that might be partial
    cache.set(cacheKey, { ts: Date.now(), data: responseData });
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', phase === 'jp'
      ? 's-maxage=60, stale-while-revalidate=300'
      : 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(responseData);

  } catch (e) {
    console.error('[api/cards] error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
