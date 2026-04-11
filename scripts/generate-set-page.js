// scripts/generate-set-page.js
// Generates a set guide HTML page from the template
//
// Usage:
//   node scripts/generate-set-page.js
//
// Required env vars:
//   SET_ID          e.g. sv02
//   SET_FULL_NAME   e.g. "Paldea Evolved (SV2)"
//
// Optional env vars:
//   SET_SLUG         e.g. paldea-evolved-card-list  (default: {{SET_ID}}-card-list)
//   SET_URL_SLUG     e.g. base-set                  (default: auto from SET_URL_SLUG_MAP or SET_SLUG minus -card-list)
//   SET_SERIES       e.g. "Scarlet & Violet"         (default: "Scarlet & Violet")
//   SET_SUBTITLE     e.g. "Paldea Evolved"            (default: fetched from TCGdex)
//   SET_SHORT_NAME   e.g. SV2                         (default: SET_ID uppercased)
//   SET_RELEASE_DATE e.g. "Jun 2023"                 (default: fetched from TCGdex)
//   SET_DESCRIPTION  2-3 sentence description         (default: auto-generated)
//   SET_SEARCH_NAME  Short name used in eBay/Amazon search queries, e.g. "Paldea Evolved"
//                    (default: SET_SUBTITLE or set name from TCGdex)
//   SET_TCGP_SLUG    TCGplayer URL slug e.g. "paldea-evolved"
//                    (default: auto-derived from SET_SUBTITLE)
//   HERO_CARD_1/2/3  localId of the 3 stacked hero card images (default: 001/002/003)
//   HERO_ALT_1/2/3   alt text for hero cards
//   PRODUCT_META_JSON  JSON string of the PRODUCT_META object for this set's products
//                      (default: {} — products section will gracefully show nothing)
//   CHASE_CARDS_JSON   JSON string of fallback chase cards shown before card data loads
//                      (default: [] — chase section auto-populates from rarity on page load)
//   CF_R2_PUBLIC_URL   Your R2 public URL for card images
//   CF_R2_ENDPOINT / CF_R2_ACCESS_KEY / CF_R2_SECRET_KEY / CF_R2_BUCKET  (for R2 backup)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ── Inputs ─────────────────────────────────────────────────────────────────────
const SET_ID           = (process.env.SET_ID || '').trim();
const SET_FULL_NAME    = (process.env.SET_FULL_NAME || '').trim();
const SET_SLUG         = (process.env.SET_SLUG || '').trim() || `${SET_ID}-card-list`;
const SET_SERIES       = (process.env.SET_SERIES || '').trim() || (SET_ID?.startsWith('me') ? 'Mega Evolution' : 'Scarlet & Violet');

// Derive series slug from set ID so me* sets don't default to scarlet-violet
// Also handles me02pt5 (shell-safe version of me02.5)
const SERIES_SLUG_MAP = {
  'me01': 'mega-evolution', 'me02': 'mega-evolution',
  'me02.5': 'mega-evolution', 'me02pt5': 'mega-evolution',
  'me03': 'mega-evolution',
};
// .trim() guards against GitHub Actions passing empty string instead of omitting the var
const SET_SERIES_SLUG = (process.env.SET_SERIES_SLUG || '').trim()
  || SERIES_SLUG_MAP[SET_ID]
  || 'scarlet-violet';

// URL slug override map — ensures base sets use /base-set/ not the full file slug
// Add new entries here whenever a set needs a shorter/different URL path segment
const SET_URL_SLUG_MAP = {
  'sv01': 'base-set',
  'me01': 'base-set',
};

// SET_URL_SLUG: the path segment used in the live URL (after the series slug)
// e.g. /pokemon/sets/mega-evolution/base-set/cards
// Separate from SET_SLUG which is the HTML filename slug
// .trim() guards against GitHub Actions passing empty string instead of omitting the var
const SET_URL_SLUG = (process.env.SET_URL_SLUG || '').trim()
  || SET_URL_SLUG_MAP[SET_ID]
  || SET_SLUG.replace('-card-list', '');

const SET_SEO_PATH     = process.env.SET_SEO_PATH || `pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`;
const SET_SHORT_NAME   = process.env.SET_SHORT_NAME || SET_ID?.toUpperCase();
const SET_RELEASE_DATE = process.env.SET_RELEASE_DATE || null;
const SET_DESCRIPTION  = process.env.SET_DESCRIPTION  || null;

// ── JP/EN phase support ───────────────────────────────────────────────────────
// PHASE=jp  → page uses Japanese cards from Scrydex, no TCGplayer prices yet
// PHASE=en  → normal EN flow (default)
const PHASE           = (process.env.PHASE          || 'en').trim();
const JP_SCRYDEX_ID   = (process.env.JP_SCRYDEX_ID  || '').trim();  // e.g. 'sv9b'
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
// ─────────────────────────────────────────────────────────────────────────────

// Hero cards — auto-fetched from TCGCSV top prices if not provided
let HERO_CARD_1 = process.env.HERO_CARD_1 || '';
let HERO_CARD_2 = process.env.HERO_CARD_2 || '';
let HERO_CARD_3 = process.env.HERO_CARD_3 || '';
let HERO_ALT_1  = process.env.HERO_ALT_1  || 'Card 1';
let HERO_ALT_2  = process.env.HERO_ALT_2  || 'Card 2';
let HERO_ALT_3  = process.env.HERO_ALT_3  || 'Card 3';

// TCGdex uses dot-notation for special sets (sv03.5, sv04.5 etc.)
const TCGDEX_ID_MAP = { 'sv3pt5': 'sv03.5', 'sv4pt5': 'sv04.5', 'sv6pt5': 'sv06.5', 'sv8pt5': 'sv08.5', 'me02pt5': 'me02.5' };
const TCGDEX_SET_OVERVIEW_ID = TCGDEX_ID_MAP[SET_ID] || SET_ID;

// TCGP group ID map — includes all ME series IDs
const GROUP_ID_MAP = {
  'sv01': '22873', 'sv02': '23120', 'sv03': '23228', 'sv04': '23286',
  'sv3pt5': '23237', 'sv4pt5': '23353', 'sv05': '23381', 'sv06': '23473',
  'sv6pt5': '23529', 'sv07': '23537', 'sv08': '23651', 'sv8pt5': '23821',
  'sv09': '24073', 'sv10': '24269',
  'me01': '24380', 'me02': '24448', 'me02.5': '24541', 'me03': '24587',
  'me04': '24655',
};
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID && process.env.TCGP_GROUP_ID !== '0')
  ? process.env.TCGP_GROUP_ID
  : (GROUP_ID_MAP[SET_ID] || '0');

if (!SET_ID || !SET_FULL_NAME) {
  console.error('❌  SET_ID and SET_FULL_NAME are required');
  process.exit(1);
}

if (TCGP_GROUP_ID === '0') {
  console.warn('⚠️  TCGP_GROUP_ID not set — prices will not load. Find your groupId at https://tcgcsv.com/tcgplayer/3/groups');
} else {
  console.log(`✅  Using groupId ${TCGP_GROUP_ID} for ${SET_ID}`);
}

// ── Fetch set metadata (Scrydex for JP phase, TCGdex for EN phase) ────────────
let setData      = {};
let officialCount = 0;

if (PHASE === 'jp' && JP_SCRYDEX_ID && SCRYDEX_API_KEY) {
  console.log(`📋 Fetching JP set metadata from Scrydex (${JP_SCRYDEX_ID})…`);
  try {
    const scrydexRes = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_SCRYDEX_ID}`, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
    });
    if (scrydexRes.ok) {
      const raw     = await scrydexRes.json();
      setData       = raw.data || raw;
      // For JP phase: printedTotal is the official card count (e.g. 088), total includes secret rares
      // Never use .total (that's DB count) — use printedTotal or cardCount
      officialCount = setData.printedTotal || setData.cardCount || setData.total || 0;
      console.log(`✅  Scrydex JP: ${setData.name || '(jp name)'} — ${officialCount} official cards`);
      setData.name = null; // Never use JP name — always use SET_FULL_NAME
    } else {
      console.warn(`⚠️  Scrydex ${scrydexRes.status} — falling back to manual values`);
    }
  } catch (e) {
    console.warn(`⚠️  Scrydex metadata failed: ${e.message}`);
  }
} else {
  console.log(`📋 Fetching set metadata from TCGdex for ${SET_ID}…`);
  const tcgRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${TCGDEX_SET_OVERVIEW_ID}`);
  if (!tcgRes.ok) {
    console.error(`❌  TCGdex ${tcgRes.status} for set ${SET_ID}`);
    process.exit(1);
  }
  setData       = await tcgRes.json();
  officialCount = setData.cardCount?.official || setData.cards?.length || 0;
  console.log(`✅  TCGdex: ${setData.name} — ${officialCount} official cards`);
}

const releaseDate = SET_RELEASE_DATE
  || (setData.releaseDate
      ? new Date(setData.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : '???');

// For JP phase, always use SET_FULL_NAME — never the JP name from Scrydex
const SET_SUBTITLE    = process.env.SET_SUBTITLE    || (PHASE === 'jp' ? SET_FULL_NAME : (setData.name || SET_FULL_NAME));
const SET_SEARCH_NAME = process.env.SET_SEARCH_NAME || SET_SUBTITLE;
const SET_TCGP_SLUG   = process.env.SET_TCGP_SLUG
  || SET_SUBTITLE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log(`✅  ${SET_SUBTITLE} — ${officialCount} cards, released ${releaseDate}`);
console.log(`    subtitle="${SET_SUBTITLE}", search="${SET_SEARCH_NAME}", tcgp="${SET_TCGP_SLUG}"`);
console.log(`    url slug="${SET_URL_SLUG}", file slug="${SET_SLUG}"`);

// ── Auto-fetch hero cards if not provided ──────────────────────────────────────
if (!HERO_CARD_1 && TCGP_GROUP_ID && TCGP_GROUP_ID !== '0') {
  console.log('\n🃏  Auto-fetching top chase cards for hero stack...');
  try {
    const [productsRes, pricesRes] = await Promise.all([
      fetch(`https://tcgcsv.com/tcgplayer/3/${TCGP_GROUP_ID}/products`),
      fetch(`https://tcgcsv.com/tcgplayer/3/${TCGP_GROUP_ID}/prices`),
    ]);
    const products   = (await productsRes.json()).results || [];
    const pricesList = (await pricesRes.json()).results || [];

    const priceById = {};
    for (const p of pricesList) {
      const sub = (p.subTypeName || '').toLowerCase();
      if (sub.includes('reverse')) continue;
      const existing = priceById[p.productId];
      if (!existing || (sub === 'normal' && (existing.subTypeName || '').toLowerCase() !== 'normal')) {
        priceById[p.productId] = p;
      }
    }

    const scored = products
      .filter(p => {
        const ext = p.extendedData || [];
        const hasNumber = ext.some(e => e.name === 'Number');
        if (!hasNumber) return false;
        const price = priceById[p.productId]?.marketPrice;
        return price != null && price > 0;
      })
      .map(p => {
        const ext    = p.extendedData || [];
        const numEntry = ext.find(e => e.name === 'Number');
        const cardNum  = numEntry?.value.split('/')[0].trim();
        const rawName = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*[-–]\s*\d+\/\d+\s*$/, '').trim();
        return { id: cardNum, name: rawName, price: priceById[p.productId].marketPrice };
      })
      .sort((a, b) => b.price - a.price)
      .slice(0, 3);

    if (scored.length >= 3) {
      HERO_CARD_1 = scored[0].id;  HERO_ALT_1 = scored[0].name;
      HERO_CARD_2 = scored[1].id;  HERO_ALT_2 = scored[1].name;
      HERO_CARD_3 = scored[2].id;  HERO_ALT_3 = scored[2].name;
      console.log(`  ✅  #1: ${scored[0].name} #${scored[0].id} ($${scored[0].price})`);
      console.log(`  ✅  #2: ${scored[1].name} #${scored[1].id} ($${scored[1].price})`);
      console.log(`  ✅  #3: ${scored[2].name} #${scored[2].id} ($${scored[2].price})`);
    } else {
      console.warn('  ⚠️  Not enough priced cards found, falling back to 001/002/003');
      HERO_CARD_1 = HERO_CARD_1 || '001';
      HERO_CARD_2 = HERO_CARD_2 || '002';
      HERO_CARD_3 = HERO_CARD_3 || '003';
    }
  } catch(e) {
    console.warn(`  ⚠️  Hero card fetch failed: ${e.message} — falling back to 001/002/003`);
    HERO_CARD_1 = HERO_CARD_1 || '001';
    HERO_CARD_2 = HERO_CARD_2 || '002';
    HERO_CARD_3 = HERO_CARD_3 || '003';
  }
} else {
  HERO_CARD_1 = HERO_CARD_1 || '001';
  HERO_CARD_2 = HERO_CARD_2 || '002';
  HERO_CARD_3 = HERO_CARD_3 || '003';
}

// ── PRODUCT_META ───────────────────────────────────────────────────────────────
let productMetaJson = process.env.PRODUCT_META_JSON || '';
if (productMetaJson) {
  try {
    const parsed = JSON.parse(productMetaJson);
    if (Object.keys(parsed).length === 0) productMetaJson = '';
  } catch(e) {
    console.warn('⚠️  PRODUCT_META_JSON is not valid JSON — will auto-fetch from TCGCSV');
    productMetaJson = '';
  }
}

const SET_PRODUCTS = {
  sv01: [
    { tcgpId: '476452', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Scarlet & Violet Booster Box (36 Packs)',       q: 'Pokemon Scarlet Violet Base Set Booster Box SV1' },
    { tcgpId: '478335', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Scarlet & Violet Elite Trainer Box',             q: 'Pokemon Scarlet Violet Base Set Elite Trainer Box SV1' },
    { tcgpId: '478258', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Scarlet & Violet 6-Pack Booster Bundle',         q: 'Pokemon Scarlet Violet Booster Bundle SV1' },
    { tcgpId: '476453', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Scarlet & Violet Booster Box Case (6 Boxes)',    q: 'Pokemon Scarlet Violet Booster Box Case SV1', noAmazon: true },
    { tcgpId: '478253', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Scarlet & Violet Build & Battle Box',            q: 'Pokemon Scarlet Violet Build Battle Box SV1' },
  ],
  sv02: [
    { tcgpId: '493975', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Paldea Evolved Booster Box (36 Packs)',          q: 'Pokemon Paldea Evolved Booster Box SV2' },
    { tcgpId: '493974', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Paldea Evolved Elite Trainer Box',               q: 'Pokemon Paldea Evolved Elite Trainer Box SV2' },
    { tcgpId: '496914', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Paldea Evolved Booster Bundle',                  q: 'Pokemon Paldea Evolved Booster Bundle SV2' },
    { tcgpId: '496905', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Paldea Evolved Booster Box Case (6 Boxes)',      q: 'Pokemon Paldea Evolved Booster Box Case SV2', noAmazon: true },
    { tcgpId: '496929', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Paldea Evolved Build & Battle Box',              q: 'Pokemon Paldea Evolved Build Battle Box SV2' },
  ],
  sv03: [
    { tcgpId: '501257', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Obsidian Flames Booster Box (36 Packs)',         q: 'Pokemon Obsidian Flames Booster Box SV3' },
    { tcgpId: '501264', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Obsidian Flames Elite Trainer Box',              q: 'Pokemon Obsidian Flames Elite Trainer Box SV3' },
    { tcgpId: '501263', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Obsidian Flames Booster Bundle',                 q: 'Pokemon Obsidian Flames Booster Bundle SV3' },
    { tcgpId: '501258', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Obsidian Flames Booster Box Case (6 Boxes)',     q: 'Pokemon Obsidian Flames Booster Box Case SV3', noAmazon: true },
    { tcgpId: '501268', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Obsidian Flames Build & Battle Box',             q: 'Pokemon Obsidian Flames Build Battle Box SV3' },
  ],
  sv04: [
    { tcgpId: '512821', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Paradox Rift Booster Box (36 Packs)',            q: 'Pokemon Paradox Rift Booster Box SV4' },
    { tcgpId: '512813', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Paradox Rift Elite Trainer Box',                 q: 'Pokemon Paradox Rift Elite Trainer Box SV4' },
    { tcgpId: '512820', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Paradox Rift Booster Bundle',                    q: 'Pokemon Paradox Rift Booster Bundle SV4' },
    { tcgpId: '512828', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Paradox Rift Booster Box Case (6 Boxes)',        q: 'Pokemon Paradox Rift Booster Box Case SV4', noAmazon: true },
    { tcgpId: '514068', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Paradox Rift Build & Battle Box',                q: 'Pokemon Paradox Rift Build Battle Box SV4' },
  ],
  sv3pt5: [
    { tcgpId: '503313', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Scarlet & Violet 151 Elite Trainer Box',         q: 'Pokemon Scarlet Violet 151 Elite Trainer Box MEW' },
    { tcgpId: '502000', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Scarlet & Violet 151 Booster Bundle',            q: 'Pokemon Scarlet Violet 151 Booster Bundle MEW' },
  ],
  sv4pt5: [
    { tcgpId: '528040', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Paldean Fates Elite Trainer Box',                q: 'Pokemon Paldean Fates Elite Trainer Box PAF' },
    { tcgpId: '528771', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Paldean Fates Booster Bundle',                   q: 'Pokemon Paldean Fates Booster Bundle PAF' },
  ],
  sv05: [
    { tcgpId: '536225', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Temporal Forces Booster Box (36 Packs)',         q: 'Pokemon Temporal Forces Booster Box SV5' },
    { tcgpId: '532848', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Temporal Forces Elite Trainer Box',              q: 'Pokemon Temporal Forces Elite Trainer Box SV5' },
    { tcgpId: '541017', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Temporal Forces Booster Bundle',                 q: 'Pokemon Temporal Forces Booster Bundle SV5' },
    { tcgpId: '537417', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Temporal Forces Booster Box Case (6 Boxes)',     q: 'Pokemon Temporal Forces Booster Box Case SV5', noAmazon: true },
    { tcgpId: '537411', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Temporal Forces Build & Battle Box',             q: 'Pokemon Temporal Forces Build Battle Box SV5' },
  ],
  sv06: [
    { tcgpId: '543846', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Twilight Masquerade Booster Box (36 Packs)',     q: 'Pokemon Twilight Masquerade Booster Box SV6' },
    { tcgpId: '543845', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Twilight Masquerade Elite Trainer Box',          q: 'Pokemon Twilight Masquerade Elite Trainer Box SV6' },
    { tcgpId: '543852', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Twilight Masquerade Booster Bundle',             q: 'Pokemon Twilight Masquerade Booster Bundle SV6' },
    { tcgpId: '544384', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Twilight Masquerade Booster Box Case (6 Boxes)', q: 'Pokemon Twilight Masquerade Booster Box Case SV6', noAmazon: true },
    { tcgpId: '544386', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Twilight Masquerade Build & Battle Box',         q: 'Pokemon Twilight Masquerade Build Battle Box SV6' },
  ],
  sv6pt5: [
    { tcgpId: '552999', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Shrouded Fable Elite Trainer Box',               q: 'Pokemon Shrouded Fable Elite Trainer Box SFA' },
    { tcgpId: '553031', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Shrouded Fable Booster Bundle',                  q: 'Pokemon Shrouded Fable Booster Bundle SFA' },
  ],
  sv07: [
    { tcgpId: '557354', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Stellar Crown Booster Box (36 Packs)',           q: 'Pokemon Stellar Crown Booster Box SV7' },
    { tcgpId: '557350', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Stellar Crown Elite Trainer Box',                q: 'Pokemon Stellar Crown Elite Trainer Box SV7' },
    { tcgpId: '557345', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Stellar Crown Booster Bundle',                   q: 'Pokemon Stellar Crown Booster Bundle SV7' },
    { tcgpId: '557365', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Stellar Crown Booster Box Case (6 Boxes)',       q: 'Pokemon Stellar Crown Booster Box Case SV7', noAmazon: true },
    { tcgpId: '557330', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Stellar Crown Build & Battle Box',               q: 'Pokemon Stellar Crown Build Battle Box SV7' },
  ],
  sv08: [
    { tcgpId: '565606', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Surging Sparks Booster Box (36 Packs)',          q: 'Pokemon Surging Sparks Booster Box SV8' },
    { tcgpId: '565630', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Surging Sparks Elite Trainer Box',               q: 'Pokemon Surging Sparks Elite Trainer Box SV8' },
    { tcgpId: '565629', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Surging Sparks Booster Bundle',                  q: 'Pokemon Surging Sparks Booster Bundle SV8' },
    { tcgpId: '580708', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Surging Sparks Booster Box Case (6 Boxes)',      q: 'Pokemon Surging Sparks Booster Box Case SV8', noAmazon: true },
    { tcgpId: '565599', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Surging Sparks Build & Battle Box',              q: 'Pokemon Surging Sparks Build Battle Box SV8' },
  ],
  sv8pt5: [
    { tcgpId: '593355', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Prismatic Evolutions Elite Trainer Box',         q: 'Pokemon Prismatic Evolutions Elite Trainer Box PRE' },
    { tcgpId: '600518', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Prismatic Evolutions Booster Bundle',            q: 'Pokemon Prismatic Evolutions Booster Bundle PRE' },
  ],
  sv09: [
    { tcgpId: '610931', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Journey Together Booster Box (36 Packs)',        q: 'Pokemon Journey Together Booster Box SV9' },
    { tcgpId: '610930', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Journey Together Elite Trainer Box',             q: 'Pokemon Journey Together Elite Trainer Box SV9' },
    { tcgpId: '610953', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Journey Together Booster Bundle',                q: 'Pokemon Journey Together Booster Bundle SV9' },
    { tcgpId: '614449', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Journey Together Booster Box Case (6 Boxes)',    q: 'Pokemon Journey Together Booster Box Case SV9', noAmazon: true },
  ],
  sv10: [
    { tcgpId: '624679', type: 'Booster Box',       filterKey: 'box',    badgeClass: 'badge-box',    name: 'Destined Rivals Booster Box (36 Packs)',         q: 'Pokemon Destined Rivals Booster Box SV10' },
    { tcgpId: '624676', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Destined Rivals Elite Trainer Box',              q: 'Pokemon Destined Rivals Elite Trainer Box SV10' },
    { tcgpId: '625670', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Destined Rivals Booster Bundle',                 q: 'Pokemon Destined Rivals Booster Bundle SV9' },
    { tcgpId: '624678', type: 'Booster Box Case',   filterKey: 'case',   badgeClass: 'badge-case',   name: 'Destined Rivals Booster Box Case (6 Boxes)',     q: 'Pokemon Destined Rivals Booster Box Case SV10', noAmazon: true },
    { tcgpId: '625677', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Destined Rivals Build & Battle Box',             q: 'Pokemon Destined Rivals Build Battle Box SV10' },
  ],
};

if (!productMetaJson) {
  const setProducts = SET_PRODUCTS[SET_ID];
  if (setProducts) {
    console.log(`\n📦  Using hardcoded product list for ${SET_ID} (${setProducts.length} products)`);
    const autoMeta = {};
    for (const p of setProducts) {
      autoMeta[p.tcgpId] = {
        ...p,
        image: `https://product-images.tcgplayer.com/fit-in/437x437/${p.tcgpId}.jpg`,
      };
      console.log(`  ✅  ${p.type}: ${p.name}`);
    }
    productMetaJson = JSON.stringify(autoMeta);
  } else {
    console.warn(`  ⚠️  No product list defined for ${SET_ID} — products section will be empty`);
    productMetaJson = '{}';
  }
}

// ── R2 client ──────────────────────────────────────────────────────────────────
const r2 = process.env.CF_R2_ACCESS_KEY ? new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
}) : null;

async function getEbayToken() {
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('eBay credentials not set');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  return (await res.json()).access_token;
}

async function fetchProductImage(query) {
  const token = await getEbayToken();
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10&filter=categoryIds:183468`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
  const data = await res.json();
  for (const item of data.itemSummaries || []) {
    if (item.thumbnailImages?.[0]?.imageUrl) return item.thumbnailImages[0].imageUrl;
    if (item.image?.imageUrl) return item.image.imageUrl;
  }
  return null;
}

const productMeta = JSON.parse(productMetaJson);
const R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL || '';

if (Object.keys(productMeta).length > 0 && r2 && process.env.EBAY_CLIENT_ID) {
  console.log(`\n🖼️  Fetching product images for ${Object.keys(productMeta).length} products...`);
  await Promise.all(Object.entries(productMeta).map(async ([asin, p]) => {
    try {
      const r2Key = `products/${SET_ID}/${asin}.jpg`;
      try {
        await r2.send(new HeadObjectCommand({ Bucket: process.env.CF_R2_BUCKET, Key: r2Key }));
        productMeta[asin].image = `${R2_PUBLIC_URL}/${r2Key}`;
        console.log(`  ✅  ${asin} (cached in R2)`);
        return;
      } catch {}
      const ebayImgUrl = await fetchProductImage(p.q);
      if (!ebayImgUrl) { console.warn(`  ⚠️  No image found for ${asin}`); return; }
      const imgRes = await fetch(ebayImgUrl);
      if (!imgRes.ok) throw new Error(`download failed: ${imgRes.status}`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      await r2.send(new PutObjectCommand({
        Bucket: process.env.CF_R2_BUCKET, Key: r2Key, Body: buffer,
        ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
      }));
      productMeta[asin].image = `${R2_PUBLIC_URL}/${r2Key}`;
      console.log(`  ✅  ${asin} → uploaded to R2`);
    } catch(e) {
      console.warn(`  ⚠️  Image failed for ${asin}: ${e.message}`);
    }
  }));
} else if (Object.keys(productMeta).length > 0) {
  console.log('  ℹ️  Skipping product images — no R2/eBay credentials');
}

productMetaJson = JSON.stringify(productMeta);

// ── CHASE_CARDS ────────────────────────────────────────────────────────────────
let chaseCardsJson = process.env.CHASE_CARDS_JSON || '[]';
try { JSON.parse(chaseCardsJson); } catch(e) {
  console.warn('⚠️  CHASE_CARDS_JSON is not valid JSON — using empty array');
  chaseCardsJson = '[]';
}

// ── Per-set SEO data ───────────────────────────────────────────────────────────
const SEO_DATA = {
  'me01': {
    metaTitle: 'Mega Evolution Card List and Prices | TCG Watchtower',
    metaDesc: 'Complete Mega Evolution card list with rarity filter and daily TCGplayer prices. Find every MEG card, chase pulls, and sealed product values.',
    intro: 'The Pokemon TCG Mega Evolution set launched the new Mega Evolution series in 2025, introducing Mega Evolution Pokemon ex for the first time in the modern card game era. The set features 88 main set cards plus secret rares, headlined by Mega Lucario ex and Mega Gardevoir ex as the most sought-after pulls. Collectors tracking the Mega Evolution card list will find multiple tiers of rare cards including Ultra Rares, Special Illustration Rares, and the coveted Mega Hyper Rare at the top of the pull sheet. Prices for the top chase cards have remained strong since release. This complete MEG card list includes every card numbered in the set, rarity filters, and daily updated market prices sourced from TCGplayer.',
  },
  'me02': {
    metaTitle: 'Phantasmal Flames Card List and Prices | TCG Watchtower',
    metaDesc: 'Full Phantasmal Flames card list with rarity filter and live TCGplayer prices. Every ME2 card, chase pulls, and booster box values in one place.',
    intro: 'Phantasmal Flames is the second set in the Pokemon TCG Mega Evolution series, released in late 2025. Built around Mega Gengar ex as its flagship card, the set quickly developed a reputation for producing some of the highest-valued Special Illustration Rares in the Mega Evolution block. The ME2 card list spans 88 main set cards plus over 30 secret rares across multiple rarity tiers. Phantasmal Flames booster box prices have held firm among collectors due to the strong hit rate on premium rares. This page covers the full Phantasmal Flames card list with real-time prices from TCGplayer, rarity filters, and links to individual card pages so you can find exactly what you pulled or what you are chasing.',
  },
  'me02pt5': {
    metaTitle: 'Ascended Heroes Card List and Prices | TCG Watchtower',
    metaDesc: 'Complete Ascended Heroes ME2.5 card list with live TCGplayer prices. Every card, rare pull, and sealed product value for the Mega Evolution subset.',
    intro: 'Ascended Heroes is the ME2.5 subset expansion in the Pokemon TCG Mega Evolution series, released in early 2026. As a smaller set, Ascended Heroes focuses on a tight selection of Mega Evolution Pokemon ex with a high concentration of premium rarities relative to set size, making it a popular target for collectors focused on pulling Special Illustration Rares. The ME2.5 card list contains fewer common filler cards than a standard main set, which has contributed to strong secondary market prices on its top pulls. This page provides the complete Ascended Heroes card list with rarity filters, live pricing from TCGplayer, and direct links to individual card pages for every card in the set.',
  },
  'me03': {
    metaTitle: 'Perfect Order Card List and Prices | TCG Watchtower',
    metaDesc: 'Full Perfect Order ME3 card list with live TCGplayer prices. Every card, Special Illustration Rare, Mega Ultra Rare, and booster box value updated daily.',
    intro: 'Perfect Order is the third main set in the Pokemon TCG Mega Evolution series, released in March 2026. The ME3 set contains 117 cards and is built around Mega Starmie ex, Mega Zygarde ex, and Mega Clefable ex as its headline Pokemon. The top chase cards include multiple Special Illustration Rares and a Mega Ultra Rare in Mega Zygarde ex at number 117, which sits at the apex of the pull sheet. Rosa\'s Encouragement has emerged as a standout Supporter card driving collector demand. This complete Perfect Order card list includes all ME3 cards with rarity labels, daily updated prices from TCGplayer, and rarity filters so you can quickly locate any card in the set whether you are tracking a recent pull or researching values before buying.',
  },
  'me04': {
    metaTitle: 'Chaos Rising Card List and Prices | TCG Watchtower',
    metaDesc: 'Full Chaos Rising ME4 card list with live prices. Every card, Mega Greninja ex chase pulls, Special Illustration Rares, and booster box values updated daily.',
    intro: 'Chaos Rising is the fourth set in the Pokemon TCG Mega Evolution series, releasing May 22 2026. Based on the Japanese Ninja Spinner set, ME4 is headlined by Mega Greninja ex as the most anticipated pull in the set. The Chaos Rising card list contains 122 cards including five Mega Evolution Pokemon ex, six Special Illustration Rares, and a Mega Hyper Rare of Mega Greninja ex at the top of the rarity ladder. Pre-release pricing has already put the Mega Greninja ex Mega Hyper Rare among the most valuable cards in the entire Mega Evolution block. This page tracks the full Chaos Rising card list with EN names, rarity filters, and real-time secondary market prices from TCGplayer that update daily.',
  },
};

const seoData   = SEO_DATA[SET_ID] || {};
const SEO_META_TITLE = seoData.metaTitle || `${SET_FULL_NAME} Card List and Prices | TCG Watchtower`;
const SEO_META_DESC  = seoData.metaDesc  || `Complete ${SET_FULL_NAME} guide — full card list, top chase cards ranked by rarity, booster box prices, and where to buy ETBs. Updated ${releaseDate}.`;
const SEO_INTRO      = seoData.intro     || '';

// ── Fill template ──────────────────────────────────────────────────────────────
let html = readFileSync('set-template.html', 'utf8');

const vars = {
  '{{SET_ID}}':             SET_ID,
  '__R2_PUBLIC_URL__':      R2_PUBLIC_URL,
  '{{SET_FULL_NAME}}':      SET_FULL_NAME,
  '{{SET_SERIES}}':         SET_SERIES,
  '{{SET_SERIES_SLUG}}':    SET_SERIES_SLUG,
  '{{SET_URL_SLUG}}':       SET_URL_SLUG,
  '{{SET_SLUG_FOR_URL}}':   SET_URL_SLUG,
  '{{SET_SEO_PATH}}':       SET_SEO_PATH,
  '{{SET_SUBTITLE}}':       SET_SUBTITLE,
  '{{SET_SHORT_NAME}}':     SET_SHORT_NAME,
  '{{SET_RELEASE_DATE}}':   releaseDate,
  '{{SET_DESCRIPTION}}':    SET_DESCRIPTION || `Complete guide to ${SET_FULL_NAME} — full card list, chase cards ranked by market price, and where to buy sealed product.`,
  '{{SET_OFFICIAL_COUNT}}': String(officialCount),
  '{{SET_SEARCH_NAME}}':    SET_SEARCH_NAME,
  '{{SET_TCGP_SLUG}}':      SET_TCGP_SLUG,
  '{{TCGP_GROUP_ID}}':      TCGP_GROUP_ID,
  '{{SET_PHASE}}':          PHASE,
  '{{SET_SLUG}}':           SET_SLUG,
  '{{HERO_CARD_1}}':        HERO_CARD_1,
  '{{HERO_CARD_2}}':        HERO_CARD_2,
  '{{HERO_CARD_3}}':        HERO_CARD_3,
  '{{HERO_ALT_1}}':         HERO_ALT_1,
  '{{HERO_ALT_2}}':         HERO_ALT_2,
  '{{HERO_ALT_3}}':         HERO_ALT_3,
  '{{PRODUCT_META_JSON}}':  productMetaJson,
  '{{CHASE_CARDS_JSON}}':   chaseCardsJson,
  '{{SEO_META_TITLE}}':     SEO_META_TITLE,
  '{{SEO_META_DESC}}':      SEO_META_DESC,
  '{{SEO_INTRO}}':          SEO_INTRO,
};

for (const [placeholder, value] of Object.entries(vars)) {
  html = html.replaceAll(placeholder, value);
}

// ── Handle JP phase conditional blocks ────────────────────────────────────────
// {{#IF_JP_PHASE}}...{{/IF_JP_PHASE}} blocks are shown only when PHASE=jp
if (PHASE === 'jp') {
  html = html.replace(/\{\{#IF_JP_PHASE\}\}([\s\S]*?)\{\{\/IF_JP_PHASE\}\}/g, '$1');

  // Auto-patch api/cards.js SCRYDEX_JP_ID_MAP with the new JP set ID
  if (JP_SCRYDEX_ID) {
    try {
      const { execSync } = await import('child_process');
      execSync(`SET_ID=${SET_ID} JP_SCRYDEX_ID=${JP_SCRYDEX_ID} node scripts/patch-jp-id-map.js`, { stdio: 'inherit' });
    } catch(e) {
      console.warn(`⚠️  Could not auto-patch SCRYDEX_JP_ID_MAP: ${e.message}`);
      console.warn(`   Manually add '${SET_ID}': '${JP_SCRYDEX_ID}' to api/cards.js SCRYDEX_JP_ID_MAP`);
    }
  }
} else {
  html = html.replace(/\{\{#IF_JP_PHASE\}\}[\s\S]*?\{\{\/IF_JP_PHASE\}\}/g, '');
}

const r2Url = R2_PUBLIC_URL;
if (r2Url) {
  html = html.replaceAll(
    `CONFIG.r2 && CONFIG.r2 !== '${r2Url}'`,
    'CONFIG.r2'
  );
}

// Handle SEO intro conditional block
if (SEO_INTRO) {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}([\s\S]*?)\{\{\/IF_SEO_INTRO\}\}/g, '$1');
} else {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}[\s\S]*?\{\{\/IF_SEO_INTRO\}\}/g, '');
}

const remaining = [...html.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m => m[0]);
if (remaining.length) {
  console.warn(`⚠️  Unreplaced placeholders: ${[...new Set(remaining)].join(', ')}`);
}

// ── Write output file ──────────────────────────────────────────────────────────
const outFile = `${SET_SLUG}.html`;
writeFileSync(outFile, html);
console.log(`\n✅  Generated ${outFile}`);
console.log(`    Live URL will be: https://tcgwatchtower.com/${SET_SEO_PATH}`);

// ── Upload to R2 (optional) ────────────────────────────────────────────────────
if (process.env.CF_R2_ENDPOINT) {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.CF_R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.CF_R2_ACCESS_KEY,
      secretAccessKey: process.env.CF_R2_SECRET_KEY,
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.CF_R2_BUCKET,
    Key:         `pages/${outFile}`,
    Body:        html,
    ContentType: 'text/html',
  }));
  console.log(`✅  Backed up to R2 at pages/${outFile}`);
}

// ── Update sets.json ───────────────────────────────────────────────────────────
const ALL_KNOWN_SETS = [
  { slug: 'scarlet-violet-base-set-card-list', name: 'Scarlet & Violet Base Set (SV1)', series: 'Scarlet & Violet', short: 'SV1',  setId: 'sv01'    },
  { slug: 'paldea-evolved-card-list',          name: 'Paldea Evolved (SV2)',            series: 'Scarlet & Violet', short: 'SV2',  setId: 'sv02'    },
  { slug: 'obsidian-flames-card-list',         name: 'Obsidian Flames (SV3)',           series: 'Scarlet & Violet', short: 'SV3',  setId: 'sv03'    },
  { slug: 'paradox-rift-card-list',            name: 'Paradox Rift (SV4)',              series: 'Scarlet & Violet', short: 'SV4',  setId: 'sv04'    },
  { slug: 'scarlet-violet-151-card-list',      name: 'Scarlet & Violet 151',            series: 'Scarlet & Violet', short: 'MEW',  setId: 'sv3pt5'  },
  { slug: 'paldean-fates-card-list',           name: 'Paldean Fates',                   series: 'Scarlet & Violet', short: 'PAF',  setId: 'sv4pt5'  },
  { slug: 'temporal-forces-card-list',         name: 'Temporal Forces (SV5)',           series: 'Scarlet & Violet', short: 'SV5',  setId: 'sv05'    },
  { slug: 'twilight-masquerade-card-list',     name: 'Twilight Masquerade (SV6)',       series: 'Scarlet & Violet', short: 'SV6',  setId: 'sv06'    },
  { slug: 'shrouded-fable-card-list',          name: 'Shrouded Fable',                  series: 'Scarlet & Violet', short: 'SFA',  setId: 'sv6pt5'  },
  { slug: 'stellar-crown-card-list',           name: 'Stellar Crown (SV7)',             series: 'Scarlet & Violet', short: 'SV7',  setId: 'sv07'    },
  { slug: 'surging-sparks-card-list',          name: 'Surging Sparks (SV8)',            series: 'Scarlet & Violet', short: 'SV8',  setId: 'sv08'    },
  { slug: 'prismatic-evolutions-card-list',    name: 'Prismatic Evolutions',            series: 'Scarlet & Violet', short: 'PRE',  setId: 'sv8pt5'  },
  { slug: 'journey-together-card-list',        name: 'Journey Together (SV9)',          series: 'Scarlet & Violet', short: 'SV9',  setId: 'sv09'    },
  { slug: 'destined-rivals-card-list',         name: 'Destined Rivals (SV10)',          series: 'Scarlet & Violet', short: 'SV10', setId: 'sv10'    },
  { slug: 'pokemon/sets/mega-evolution/base-set/cards',      name: 'Mega Evolution (ME1)', series: 'Mega Evolution', short: 'ME01', setId: 'me01'    },
  { slug: 'phantasmal-flames-card-list',       name: 'Phantasmal Flames',               series: 'Mega Evolution',   short: 'PFL',  setId: 'me02'    },
  { slug: 'pokemon/sets/mega-evolution/ascended-heroes/cards', name: 'Ascended Heroes',  series: 'Mega Evolution',   short: 'ASC',  setId: 'me02pt5' },
  { slug: 'perfect-order-card-list',           name: 'Perfect Order (ME3)',             series: 'Mega Evolution',   short: 'ME3',  setId: 'me03'    },
  { slug: 'chaos-rising-card-list',            name: 'Chaos Rising (ME4)',              series: 'Mega Evolution',   short: 'ME4',  setId: 'me04'    },
];

const setsPath = 'sets.json';
const existingSets = existsSync(setsPath) ? JSON.parse(readFileSync(setsPath, 'utf8')) : [];

const mergedSets = ALL_KNOWN_SETS.map(known => {
  const existing = existingSets.find(s => s.setId === known.setId);
  const isCurrentSet = known.setId === SET_ID;
  return {
    ...known,
    slug:  existing?.slug ?? known.slug,
    phase: isCurrentSet ? PHASE : (existing?.phase ?? 'en'),
    live:  isCurrentSet ? true  : (existing?.live  ?? false),
  };
});

writeFileSync(setsPath, JSON.stringify(mergedSets, null, 2));
console.log(`\n📋 sets.json updated — ${SET_SLUG} is now live`);

// ── Update sitemap.xml ─────────────────────────────────────────────────────────
const SITE_URL    = 'https://tcgwatchtower.com';
const sitemapPath = 'sitemap.xml';
const newUrl      = `${SITE_URL}/${SET_SEO_PATH}`;

let sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
if (sitemap.includes(newUrl)) {
  console.log(`\n📍 Sitemap already contains ${newUrl}`);
} else {
  const newEntry = `  <url>\n    <loc>${newUrl}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
  sitemap = sitemap.replace('</urlset>', `${newEntry}\n</urlset>`);
  writeFileSync(sitemapPath, sitemap);
  console.log(`\n📍 Added ${newUrl} to sitemap.xml`);
}

// ── Update vercel.json ─────────────────────────────────────────────────────────
const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
vercel.rewrites = vercel.rewrites || [];
vercel.redirects = vercel.redirects || [];

const CARD_WILDCARD = {
  source: '/pokemon/sets/:series/:set/cards/:slug',
  destination: '/pokemon/sets/:series/:set/cards/:slug.html',
};

// Strip wildcard before mutating — always re-pin it last
vercel.rewrites = vercel.rewrites.filter(r => r.source !== CARD_WILDCARD.source);

// Remove any stale rewrites for this set
vercel.rewrites = vercel.rewrites.filter(r =>
  !r.source.startsWith(`/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/`)
);

// Add fresh rewrites for cards, sealed-product, most-valuable, top-chase-cards
vercel.rewrites.push(
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`,          destination: `/${SET_SLUG}.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/sealed-product`, destination: `/${SET_SLUG}.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/most-valuable`,  destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/most-valuable.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/top-chase-cards`,destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/top-chase-cards.html` },
);

// Pin wildcard last
vercel.rewrites.push(CARD_WILDCARD);

// Add redirect from flat slug → canonical URL (if not already present)
const flatSource = `/${SET_SLUG}`;
const flatDest   = `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`;
if (!vercel.redirects.find(r => r.source === flatSource)) {
  vercel.redirects.push({ source: flatSource, destination: flatDest, permanent: true });
  console.log(`\n🔀 Added redirect ${flatSource} → ${flatDest}`);
}

// If SET_URL_SLUG differs from SET_SLUG-without-card-list, also redirect the old long path
const oldUrlSlug = SET_SLUG.replace('-card-list', '');
if (oldUrlSlug !== SET_URL_SLUG) {
  const oldSources = [
    `/pokemon/sets/${SET_SERIES_SLUG}/${oldUrlSlug}/cards`,
    `/pokemon/sets/${SET_SERIES_SLUG}/${oldUrlSlug}/sealed-product`,
    `/pokemon/sets/${SET_SERIES_SLUG}/${oldUrlSlug}/most-valuable`,
    `/pokemon/sets/${SET_SERIES_SLUG}/${oldUrlSlug}/top-chase-cards`,
  ];
  for (const src of oldSources) {
    const suffix  = src.split('/').pop();
    const newDest = `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/${suffix}`;
    if (!vercel.redirects.find(r => r.source === src)) {
      vercel.redirects.push({ source: src, destination: newDest, permanent: true });
      console.log(`\n🔀 Added redirect ${src} → ${newDest}`);
    }
  }
}

writeFileSync(vercelPath, JSON.stringify(vercel, null, 2));
console.log(`✅  vercel.json updated`);

console.log(`\n🎉 Done! Deploy ${outFile} — live at ${newUrl}`);
