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
  'me03': 'mega-evolution', 'me04': 'mega-evolution', 'me05': 'mega-evolution',
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

// Guardrail: catches the exact mistake that produced the
// scarlet-violet/scarlet-violet-151 and .../scarlet-violet-base-set
// duplicate-page bug. The fallback above (SET_SLUG.replace('-card-list',''))
// only strips the file-slug suffix — it does NOT strip a series-name
// prefix, so any set whose file slug includes the series name (the sets.json
// default) falls through with a URL slug that still duplicates the series.
// If this fires, either pass SET_URL_SLUG explicitly or add SET_ID to
// SET_URL_SLUG_MAP above.
if (SET_URL_SLUG && SET_SERIES_SLUG && SET_URL_SLUG.startsWith(`${SET_SERIES_SLUG}-`)) {
  console.error(`❌ Computed SET_URL_SLUG ("${SET_URL_SLUG}") duplicates SET_SERIES_SLUG ("${SET_SERIES_SLUG}") as a prefix.`);
  console.error(`   Did you mean SET_URL_SLUG="${SET_URL_SLUG.slice(SET_SERIES_SLUG.length + 1)}"?`);
  console.error(`   Fix by passing SET_URL_SLUG explicitly, or adding '${SET_ID}': '${SET_URL_SLUG.slice(SET_SERIES_SLUG.length + 1)}' to SET_URL_SLUG_MAP above.`);
  process.exit(1);
}

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
  'me04': '24655', 'me05': '24688',
  'zsv10pt5': '24325',   // Black Bolt
  'rsv10pt5': '24326',   // White Flare
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
  // For ME sets and sv10pt5 sets, try Scrydex EN first since TCGdex may not have them yet
  const SCRYDEX_EN_META_MAP = {
    'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03','me04':'me4','me05':'me5',
    'zsv10pt5':'zsv10pt5',   // Black Bolt
    'rsv10pt5':'rsv10pt5',   // White Flare
  };
  const scrydexMetaId = SCRYDEX_EN_META_MAP[SET_ID];
  let scrydexMetaOk = false;
  if (scrydexMetaId && SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
    try {
      console.log(`📋 Fetching EN set metadata from Scrydex (${scrydexMetaId})…`);
      const scrydexRes = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${scrydexMetaId}`, {
        headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
      });
      if (scrydexRes.ok) {
        const raw = await scrydexRes.json();
        setData = raw.data || raw;
        officialCount = setData.printedTotal || setData.cardCount || setData.total || 0;
        console.log(`✅  Scrydex EN: ${setData.name || SET_FULL_NAME} — ${officialCount} official cards`);
        scrydexMetaOk = true;
      } else {
        console.warn(`⚠️  Scrydex EN ${scrydexRes.status} — falling back to TCGdex`);
      }
    } catch(e) {
      console.warn(`⚠️  Scrydex EN metadata failed: ${e.message} — falling back to TCGdex`);
    }
  }
  if (!scrydexMetaOk) {
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
}

const releaseDate = SET_RELEASE_DATE
  || (setData.releaseDate
      ? new Date(setData.releaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
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
  me05: [
    { tcgpId: '692939', type: 'Booster Box',        filterKey: 'box',    badgeClass: 'badge-box',    name: 'Pitch Black Booster Box (36 Packs)',                 q: 'Pokemon Pitch Black Booster Box ME5' },
    { tcgpId: '692947', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Pitch Black Elite Trainer Box',                      q: 'Pokemon Pitch Black Elite Trainer Box ME5' },
    { tcgpId: '692949', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Pitch Black Pokémon Center Elite Trainer Box',       q: 'Pokemon Pitch Black Pokemon Center Elite Trainer Box ME5' },
    { tcgpId: '692942', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Pitch Black Booster Bundle',                         q: 'Pokemon Pitch Black Booster Bundle ME5' },
    { tcgpId: '692946', type: 'Build & Battle Box', filterKey: 'battle', badgeClass: 'badge-battle', name: 'Pitch Black Build & Battle Box',                     q: 'Pokemon Pitch Black Build Battle Box ME5' },
  ],
  me04: [
    { tcgpId: '684444', type: 'Booster Box',               filterKey: 'box',    badgeClass: 'badge-box',    name: 'Chaos Rising Booster Box (36 Packs)',                q: 'Pokemon Chaos Rising Booster Box ME4' },
    { tcgpId: '684450', type: 'Elite Trainer Box',          filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Chaos Rising Elite Trainer Box',                     q: 'Pokemon Chaos Rising Elite Trainer Box ME4' },
    { tcgpId: '684452', type: 'Elite Trainer Box',          filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Chaos Rising Pokémon Center Elite Trainer Box',      q: 'Pokemon Chaos Rising Pokemon Center Elite Trainer Box ME4' },
    { tcgpId: '684456', type: 'Booster Bundle',             filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Chaos Rising Booster Bundle',                        q: 'Pokemon Chaos Rising Booster Bundle ME4' },
    { tcgpId: '684445', type: 'Booster Box Case',           filterKey: 'case',   badgeClass: 'badge-case',   name: 'Chaos Rising Booster Box Case (6 Boxes)',            q: 'Pokemon Chaos Rising Booster Box Case ME4', noAmazon: true },
    { tcgpId: '684451', type: 'Booster Box Case',           filterKey: 'case',   badgeClass: 'badge-case',   name: 'Chaos Rising ETB Case',                             q: 'Pokemon Chaos Rising Elite Trainer Box Case ME4', noAmazon: true },
    { tcgpId: '684454', type: 'Build & Battle Box',         filterKey: 'battle', badgeClass: 'badge-battle', name: 'Chaos Rising Build & Battle Box',                    q: 'Pokemon Chaos Rising Build Battle Box ME4' },
  ],
  zsv10pt5: [
    { tcgpId: '630686', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Black Bolt Elite Trainer Box',                            q: 'Pokemon Black Bolt Elite Trainer Box' },
    { tcgpId: '630687', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'Black Bolt Pokémon Center Elite Trainer Box',             q: 'Pokemon Black Bolt Pokemon Center Elite Trainer Box' },
    { tcgpId: '630431', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'Black Bolt Booster Bundle',                               q: 'Pokemon Black Bolt Booster Bundle' },
  ],
  rsv10pt5: [
    { tcgpId: '630689', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'White Flare Elite Trainer Box',                           q: 'Pokemon White Flare Elite Trainer Box' },
    { tcgpId: '630688', type: 'Elite Trainer Box',  filterKey: 'etb',    badgeClass: 'badge-etb',    name: 'White Flare Pokémon Center Elite Trainer Box',            q: 'Pokemon White Flare Pokemon Center Elite Trainer Box' },
    { tcgpId: '630696', type: 'Booster Bundle',     filterKey: 'bundle', badgeClass: 'badge-bundle', name: 'White Flare Booster Bundle',                              q: 'Pokemon White Flare Booster Bundle' },
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
  // ── Scarlet & Violet ──────────────────────────────────────────────────────────
  'sv01': {
    metaTitle: 'Scarlet & Violet Base Set Card List: 258 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Scarlet & Violet Base Set card list — all 258 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Scarlet & Violet Base Set launched the modern era of the Pokemon TCG in 2023, introducing the ex mechanic and a new card design. The SV1 card list spans 258 cards including Double Rares, Ultra Rares, Illustration Rares, and Special Illustration Rares. Charizard ex and Miraidon ex headline the set as the most sought-after pulls. This complete Scarlet & Violet card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv02': {
    metaTitle: 'Paldea Evolved Card List: 279 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Paldea Evolved card list — all 279 SV2 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Paldea Evolved is the second Scarlet & Violet expansion, featuring 279 cards and introducing the largest main set card count in the SV era. The SV2 card list is headlined by Iono and multiple Paradox Pokemon ex as top chase pulls. This complete Paldea Evolved card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv03': {
    metaTitle: 'Obsidian Flames Card List: 230 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Obsidian Flames card list — all 230 SV3 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Obsidian Flames introduced Tera-type Charizard ex as one of the most iconic cards of the Scarlet & Violet era. The SV3 card list spans 230 cards with a strong lineup of Special Illustration Rares. This complete Obsidian Flames card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv3pt5': {
    metaTitle: 'Pokemon 151 Card List: 207 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Pokemon 151 card list — all 207 SV3.5 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Pokemon 151 is the first subset of the Scarlet & Violet era, covering all 151 original Kanto Pokemon. The SV3.5 card list spans 207 cards and is one of the most popular collector sets ever printed, driven by nostalgia and a deep roster of Illustration Rares. This complete Pokemon 151 card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
    faq: [
      { q: 'What is the most expensive Pokemon 151 card?', a: 'The most expensive Pokemon 151 cards are the Charizard ex SIR, Mew ex SIR, and Alakazam ex SIR. Charizard ex consistently ranks as one of the top market value cards in the entire Scarlet & Violet era.' },
      { q: 'How many cards are in the Pokemon 151 card list?', a: 'Pokemon 151 contains 207 cards in total — 165 main set cards plus 42 secret rares including Illustration Rares, Ultra Rares, and Special Illustration Rares.' },
      { q: 'When did Pokemon 151 release?', a: 'Pokemon 151 released September 22, 2023 as the SV3.5 subset of the Scarlet & Violet era.' },
      { q: 'Does Pokemon 151 have all original Kanto Pokemon?', a: 'Yes — Pokemon 151 features all 151 original Kanto Pokemon with each one appearing at least once in the set, making it a nostalgia-driven collector favourite.' },
      { q: 'Is Pokemon 151 a good investment?', a: 'Pokemon 151 is one of the most collector-friendly sets in recent years due to its nostalgic appeal and high concentration of Illustration Rares. Sealed product and high-grade raw cards have maintained strong secondary market demand.' },
    ],
  },
  'sv04': {
    metaTitle: 'Paradox Rift Card List: 266 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Paradox Rift card list — all 266 SV4 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Paradox Rift introduced Ancient and Future Pokemon ex alongside the Tera mechanic in full force. The SV4 card list spans 266 cards headlined by Roaring Moon ex and Iron Valiant ex. This complete Paradox Rift card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv4pt5': {
    metaTitle: 'Paldean Fates Card List: 245 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Paldean Fates card list — all 245 SV4.5 cards with rarity filters, Shiny Pokemon, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Paldean Fates is the shiny set of the Scarlet & Violet era, featuring Shiny versions of every Paldean Pokemon. The SV4.5 card list spans 245 cards and is heavily collected for its Shiny Charizard ex and full roster of Shiny Special Illustration Rares. This complete Paldean Fates card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv05': {
    metaTitle: 'Temporal Forces Card List: 218 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Temporal Forces card list — all 218 SV5 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Temporal Forces introduced ACE SPEC cards back to the competitive format alongside Ancient and Future Pokemon ex. The SV5 card list spans 218 cards headlined by Walking Wake ex and Iron Leaves ex. This complete Temporal Forces card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv06': {
    metaTitle: 'Twilight Masquerade Card List: 226 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Twilight Masquerade card list — all 226 SV6 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Twilight Masquerade is built around Ogerpon ex in all four mask forms, making it one of the most thematically rich sets in the SV era. The SV6 card list spans 226 cards. This complete Twilight Masquerade card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv6pt5': {
    metaTitle: 'Shrouded Fable Card List: 99 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Shrouded Fable card list — all 99 SV6.5 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Shrouded Fable is the second subset of the Scarlet & Violet era, focused on the Mask of Ruin legendaries. Despite being a smaller set at 99 cards, it packs a strong chase lineup. This complete Shrouded Fable card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv07': {
    metaTitle: 'Stellar Crown Card List: 175 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Stellar Crown card list — all 175 SV7 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Stellar Crown introduced Stellar-type Tera Pokemon ex as the headline mechanic. The SV7 card list spans 175 cards headlined by Terapagos ex. This complete Stellar Crown card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv08': {
    metaTitle: 'Surging Sparks Card List: 252 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Surging Sparks card list — all 252 SV8 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Surging Sparks is the largest standard set of the Scarlet & Violet era at 252 cards, headlined by Pikachu ex in multiple Special Illustration Rare variants. This complete Surging Sparks card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv8pt5': {
    metaTitle: 'Prismatic Evolutions Card List: 180 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Prismatic Evolutions card list — all 180 SV8.5 cards with rarity filters, Eevee evolutions, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Prismatic Evolutions is the Eevee-themed subset of the Scarlet & Violet era and one of the most in-demand sets ever printed. The SV8.5 card list spans 180 cards with every Eeveelution featured in multiple art styles including Special Illustration Rares. This complete Prismatic Evolutions card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
    faq: [
      { q: 'What is the most expensive Prismatic Evolutions card?', a: 'The most expensive Prismatic Evolutions cards are the Eevee and Eeveelution Special Illustration Rares. Umbreon ex SIR, Sylveon ex SIR, and Espeon ex SIR consistently rank among the highest market values in the set.' },
      { q: 'How many cards are in the Prismatic Evolutions card list?', a: 'Prismatic Evolutions contains 180 cards in total, including 87 main set cards and 93 secret rares spanning Illustration Rares, Ultra Rares, Special Illustration Rares, and Hyper Rares.' },
      { q: 'When did Prismatic Evolutions release?', a: 'Prismatic Evolutions released January 17, 2025 as the SV8.5 subset of the Scarlet & Violet era.' },
      { q: 'Why is Prismatic Evolutions so hard to find?', a: 'Prismatic Evolutions was one of the most in-demand Pokémon TCG sets ever printed due to the Eevee theme and high concentration of Special Illustration Rares. Initial supply sold out almost instantly and restocks remained scarce for months.' },
      { q: 'Does Prismatic Evolutions have a God Pack?', a: 'Yes — Prismatic Evolutions features God Packs containing all Illustration Rares from a single booster pack, making them extremely rare and sought-after pulls.' },
    ],
  },
  'sv09': {
    metaTitle: 'Journey Together Card List: 190 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Journey Together card list — all 190 SV9 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Journey Together celebrates the bond between trainers and Pokemon with a roster built around iconic partnerships. The SV9 card list spans 190 cards. This complete Journey Together card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'sv10': {
    metaTitle: 'Destined Rivals Card List: 244 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Destined Rivals card list — all 244 SV10 cards with rarity filters, Illustration Rares, Special Illustration Rares, chase cards, and live prices on TCG Watchtower.',
    intro: 'Destined Rivals pits iconic rival duos against each other in a rivalry-themed expansion. The SV10 card list spans 244 cards. This complete Destined Rivals card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'zsv10pt5': {
    metaTitle: 'Black Bolt Card List: 172 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Black Bolt card list — all 172 cards with rarity filters, Zekrom ex chase pulls, Special Illustration Rares, and live prices on TCG Watchtower.',
    intro: 'Black Bolt is one half of the split Scarlet & Violet expansion released July 18, 2025, alongside White Flare. Together the two sets cover all 156 Pokemon from the Unova region — Black Bolt focuses on the Dark and Lightning types centered around Zekrom ex. Every Pokemon in Black Bolt has an Art Rare or Special Illustration Rare variant, making it one of the most collector-friendly sets in the Scarlet & Violet era. This complete Black Bolt card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  'rsv10pt5': {
    metaTitle: 'White Flare Card List: 173 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete White Flare card list — all 173 cards with rarity filters, Reshiram ex chase pulls, Special Illustration Rares, and live prices on TCG Watchtower.',
    intro: 'White Flare is one half of the split Scarlet & Violet expansion released July 18, 2025, alongside Black Bolt. Together the two sets cover all 156 Pokemon from the Unova region — White Flare focuses on the Fire and Water types centered around Reshiram ex. Every Pokemon in White Flare has an Art Rare or Special Illustration Rare variant, making it one of the most collector-friendly sets in the Scarlet & Violet era. This complete White Flare card list includes every card with rarity filters and live prices updated daily on TCG Watchtower.',
  },
  // ── Mega Evolution ────────────────────────────────────────────────────────────
  'me01': {
    metaTitle: 'Mega Evolution Card List: 188 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Mega Evolution Base Set card list — all 188 ME1 cards with rarity filters, Mega Lucario ex, Mega Gardevoir ex, Special Illustration Rares, and live prices on TCG Watchtower.',
    intro: 'The Pokemon TCG Mega Evolution set launched the new Mega Evolution series in 2025, introducing Mega Evolution Pokemon ex for the first time in the modern card game era. The set features 88 main set cards plus secret rares, headlined by Mega Lucario ex and Mega Gardevoir ex as the most sought-after pulls. Collectors tracking the Mega Evolution card list will find multiple tiers of rare cards including Ultra Rares, Special Illustration Rares, and the coveted Mega Hyper Rare at the top of the pull sheet. Prices for the top chase cards have remained strong since release. This complete MEG card list includes every card numbered in the set, rarity filters, and live prices on TCG Watchtower.',
  },
  'me02': {
    metaTitle: 'Phantasmal Flames Card List: 130 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Phantasmal Flames card list — all 130 ME2 cards with rarity filters, Mega Gengar ex chase pulls, Special Illustration Rares, and live prices on TCG Watchtower.',
    intro: 'Phantasmal Flames is the second set in the Pokemon TCG Mega Evolution series, released in late 2025. Built around Mega Gengar ex as its flagship card, the set quickly developed a reputation for producing some of the highest-valued Special Illustration Rares in the Mega Evolution block. The ME2 card list spans 88 main set cards plus over 30 secret rares across multiple rarity tiers. Phantasmal Flames booster box prices have held firm among collectors due to the strong hit rate on premium rares. This page covers the full Phantasmal Flames card list with live prices on TCG Watchtower, rarity filters, and links to individual card pages so you can find exactly what you pulled or what you are chasing.',
  },
  'me02pt5': {
    metaTitle: 'Ascended Heroes Card List: 295 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Ascended Heroes card list — all 295 ME2.5 cards with rarity filters, Special Illustration Rares, and live prices on TCG Watchtower.',
    intro: 'Ascended Heroes is the ME2.5 subset expansion in the Pokemon TCG Mega Evolution series, released in early 2026. At 295 cards, Ascended Heroes is the largest Pokemon TCG set ever printed, with a massive roster of Mega Evolution Pokemon ex and an exceptional density of premium rarities including Special Illustration Rares across the set. This page provides the complete Ascended Heroes card list with rarity filters, live prices on TCG Watchtower, and direct links to individual card pages for every card in the set.',
  },
  'me03': {
    metaTitle: 'Perfect Order Card List: 124 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Perfect Order card list — all 124 ME3 cards with rarity filters, Mega Zygarde ex, Special Illustration Rares, Mega Ultra Rare, and live prices on TCG Watchtower.',
    intro: 'Perfect Order is the third main set in the Pokemon TCG Mega Evolution series, released in March 2026. The ME3 set contains 117 cards and is built around Mega Starmie ex, Mega Zygarde ex, and Mega Clefable ex as its headline Pokemon. The top chase cards include multiple Special Illustration Rares and a Mega Ultra Rare in Mega Zygarde ex at number 117, which sits at the apex of the pull sheet. Rosa\'s Encouragement has emerged as a standout Supporter card driving collector demand. This complete Perfect Order card list includes all ME3 cards with rarity labels, live prices updated daily on TCG Watchtower, and rarity filters so you can quickly locate any card in the set whether you are tracking a recent pull or researching values before buying.',
    faq: [
      { q: 'What is the most expensive Perfect Order card?', a: 'The most expensive Perfect Order card is the Mega Zygarde ex Mega Ultra Rare (#117). Rosa\'s Encouragement SIR and Mega Starmie ex SIR are also strong chase pulls by market value.' },
      { q: 'How many cards are in the Perfect Order card list?', a: 'Perfect Order contains 124 cards in total, including 81 main set cards plus secret rares across Illustration Rare, Ultra Rare, Special Illustration Rare, and Mega Ultra Rare tiers.' },
      { q: 'When did Perfect Order release?', a: 'Perfect Order released March 2026 as the third set in the Pokémon TCG Mega Evolution series.' },
      { q: 'What Mega Pokemon are in Perfect Order?', a: 'Perfect Order is headlined by Mega Zygarde ex, Mega Starmie ex, and Mega Clefable ex as its three flagship Mega Evolution Pokemon ex.' },
    ],
  },
  'me04': {
    metaTitle: 'Chaos Rising Card List: 122 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Chaos Rising card list — all 122 ME4 cards with rarity filters, Mega Greninja ex, Special Illustration Rares, Mega Hyper Rare, and live prices on TCG Watchtower.',
    intro: 'Chaos Rising is the fourth set in the Pokemon TCG Mega Evolution series, releasing May 22 2026. Based on the Japanese Ninja Spinner set, ME4 is headlined by Mega Greninja ex as the most anticipated pull in the set. The Chaos Rising card list contains 122 cards including five Mega Evolution Pokemon ex, six Special Illustration Rares, and a Mega Hyper Rare of Mega Greninja ex at the top of the rarity ladder. Pre-release pricing has already put the Mega Greninja ex Mega Hyper Rare among the most valuable cards in the entire Mega Evolution block. This page tracks the full Chaos Rising card list with EN names, rarity filters, and live prices on TCG Watchtower that update daily.',
    faq: [
      { q: 'What is the most expensive Chaos Rising card?', a: 'The most expensive Chaos Rising card is the Mega Greninja ex Mega Hyper Rare (#122). The Mega Greninja ex Special Illustration Rare and supporting SIRs are also among the top chase pulls by market value.' },
      { q: 'How many cards are in the Chaos Rising card list?', a: 'Chaos Rising contains 122 cards in total — 81 main set cards plus secret rares including Illustration Rares, Special Illustration Rares, Ultra Rares, and the Mega Greninja ex Mega Hyper Rare.' },
      { q: 'When did Chaos Rising release?', a: 'Chaos Rising released May 22, 2026 as the fourth set in the Pokémon TCG Mega Evolution series.' },
      { q: 'What Mega Pokemon are in Chaos Rising?', a: 'Chaos Rising features Mega Greninja ex as its headline card, alongside Mega Gyarados ex, Mega Beedrill ex, Mega Pidgeot ex, and Mega Alakazam ex.' },
      { q: 'Is Chaos Rising based on a Japanese set?', a: 'Yes — Chaos Rising is the English adaptation of the Japanese set Ninja Spinner, which introduced Mega Greninja ex as the chase pull of the Mega Evolution series.' },
    ],
  },
  'me05': {
    metaTitle: 'Pitch Black Card List: 118 Cards, Rarity Filter & Prices | TCG Watchtower',
    metaDesc: 'Complete Pitch Black card list — all 118 ME05 cards with rarity filters, Illustration Rares, Special Illustration Rares, Mega Hyper Rares, chase cards, and live prices on TCG Watchtower. Releases July 2026.',
    intro: 'Pitch Black is the fifth set in the Pokemon TCG Mega Evolution series, releasing July 2026. Based on the Japanese Abyss Eye set, ME5 is headlined by Mega Darkrai ex as the top chase pull alongside Mega Zeraora ex, Mega Chandelure ex, and Mega Excadrill ex. This page currently shows the Japanese Abyss Eye card list — English names and prices will be added when Pitch Black releases.',
    faq: [
      { q: 'What is the most expensive Pitch Black card?', a: 'The most expensive Pitch Black card is expected to be the Mega Darkrai ex Special Illustration Rare, illustrated by Akira Egawa. Based on its Japanese counterpart in Abyss Eye, it is the top chase pull of the set. Mega Zeraora ex SIR and Gwynn SIR are also expected to command strong prices.' },
      { q: 'How many cards are in the Pitch Black card list?', a: 'Pitch Black contains 118 cards in total — 81 main set cards plus 37 secret rares including Illustration Rares, Special Illustration Rares, Ultra Rares, and the Mega Darkrai ex Mega Hyper Rare at #118.' },
      { q: 'When does Pitch Black release?', a: 'Pitch Black releases July 26, 2026. Prerelease events begin July 4, 2026 at participating local game stores, giving collectors early access to booster packs before the official launch.' },
      { q: 'What Mega Pokemon are in Pitch Black?', a: 'Pitch Black features four confirmed Mega Evolution Pokemon ex: Mega Darkrai ex, Mega Zeraora ex, Mega Chandelure ex, and Mega Excadrill ex. Mega Darkrai ex is the headline card and primary chase target.' },
      { q: 'Is Pitch Black based on a Japanese set?', a: 'Yes — Pitch Black is the English adaptation of the Japanese set Abyss Eye, released May 22, 2026. The English set is a near 1:1 translation with the same card list, artwork, and rarities.' },
      { q: 'What is the Pitch Black set code?', a: 'The Pitch Black set code is ME05, as it is the fifth expansion in the Pokémon TCG Mega Evolution series.' },
    ],
  },
};


// ── FAQ builder ────────────────────────────────────────────────────────────────
function buildFAQSection(faqs, setName) {
  const items = faqs.map(f => `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:10px;color:var(--text-light);">${f.q}</h3>
        <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.7;">${f.a}</p>
      </div>`).join('\n');
  return `<!-- ===== FAQ ===== -->
<section style="padding:64px 0;border-top:1px solid rgba(255,255,255,0.06);">
  <div class="container" style="max-width:800px;">
    <h2 class="section-title" style="text-align:center;margin-bottom:48px;">${setName} <span class="gradient-text">FAQ</span></h2>
    <div style="display:flex;flex-direction:column;gap:24px;">${items}
    </div>
  </div>
</section>`;
}

function buildFAQJsonLD(faqs) {
  const entities = faqs.map(f =>
    `    {\n      "@type": "Question",\n      "name": ${JSON.stringify(f.q)},\n      "acceptedAnswer": {\n        "@type": "Answer",\n        "text": ${JSON.stringify(f.a)}\n      }\n    }`
  ).join(',\n');
  return `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n${entities}\n  ]\n}\n<\/script>`;
}

const seoData   = SEO_DATA[SET_ID] || {};
const SEO_META_TITLE = seoData.metaTitle || `${SET_FULL_NAME} Card List and Prices | TCG Watchtower`;
const SEO_META_DESC  = seoData.metaDesc  || `Complete ${SET_FULL_NAME} guide — full card list, top chase cards ranked by rarity, booster box prices, and where to buy ETBs. Updated ${releaseDate}.`;
const SEO_OG_TITLE   = seoData.metaTitle || `${SET_FULL_NAME} Card List and Prices | TCG Watchtower`;

// ── Build FAQ content ─────────────────────────────────────────────────────────
const DEFAULT_FAQ = [
  { q: `How many cards are in the ${SET_FULL_NAME} card list?`, a: `${SET_FULL_NAME} contains ${officialCount || 'over 100'} cards in total, including the main set and all secret rare cards. Use the rarity filter above to browse by type.` },
  { q: `When did ${SET_FULL_NAME} release?`, a: `${SET_FULL_NAME} released ${releaseDate} as part of the Pokémon TCG ${SET_SERIES} series.` },
  { q: `What are the top chase cards in ${SET_FULL_NAME}?`, a: `The most valuable ${SET_FULL_NAME} cards are the highest rarity pulls — Special Illustration Rares, Hyper Rares, and Illustration Rares. See the Chase Cards section above for a complete ranked list with live prices on TCG Watchtower.` },
  { q: `Are ${SET_FULL_NAME} card prices available?`, a: `Yes — live prices on TCG Watchtower are updated daily on this page. Click any card to view current listings and buying options.` },
  { q: `What series is ${SET_FULL_NAME} part of?`, a: `${SET_FULL_NAME} is part of the ${SET_SERIES} series of the Pokémon Trading Card Game, set code ${SET_SHORT_NAME}.` },
];
const FAQ_ITEMS    = seoData.faq || DEFAULT_FAQ;
const FAQ_SECTION  = buildFAQSection(FAQ_ITEMS, SET_FULL_NAME);
const FAQ_JSONLD   = buildFAQJsonLD(FAQ_ITEMS);
const SEO_INTRO      = seoData.intro     || '';

// ── Fill template ──────────────────────────────────────────────────────────────
// Pokemon series chains (Scarlet & Violet, then Mega Evolution), in true
// chronological release order. Append new sets to the end of their series
// block as they release. Used to build the previous/next series-nav links.
const PM_SERIES_ORDER = [
  { setId: 'sv01',     url: '/pokemon/sets/scarlet-violet/base-set/cards',            name: 'Scarlet & Violet Base Set', short: 'SV1' },
  { setId: 'sv02',     url: '/pokemon/sets/scarlet-violet/paldea-evolved/cards',       name: 'Paldea Evolved', short: 'SV2' },
  { setId: 'sv03',     url: '/pokemon/sets/scarlet-violet/obsidian-flames/cards',      name: 'Obsidian Flames', short: 'SV3' },
  { setId: 'sv3pt5',   url: '/pokemon/sets/scarlet-violet/scarlet-violet-151/cards',   name: 'Pokemon 151', short: 'SV3.5' },
  { setId: 'sv04',     url: '/pokemon/sets/scarlet-violet/paradox-rift/cards',         name: 'Paradox Rift', short: 'SV4' },
  { setId: 'sv4pt5',   url: '/pokemon/sets/scarlet-violet/paldean-fates/cards',        name: 'Paldean Fates', short: 'SV4.5' },
  { setId: 'sv05',     url: '/pokemon/sets/scarlet-violet/temporal-forces/cards',      name: 'Temporal Forces', short: 'SV5' },
  { setId: 'sv06',     url: '/pokemon/sets/scarlet-violet/twilight-masquerade/cards',  name: 'Twilight Masquerade', short: 'SV6' },
  { setId: 'sv6pt5',   url: '/pokemon/sets/scarlet-violet/shrouded-fable/cards',       name: 'Shrouded Fable', short: 'SV6.5' },
  { setId: 'sv07',     url: '/pokemon/sets/scarlet-violet/stellar-crown/cards',        name: 'Stellar Crown', short: 'SV7' },
  { setId: 'sv08',     url: '/pokemon/sets/scarlet-violet/surging-sparks/cards',       name: 'Surging Sparks', short: 'SV8' },
  { setId: 'sv8pt5',   url: '/pokemon/sets/scarlet-violet/prismatic-evolutions/cards', name: 'Prismatic Evolutions', short: 'SV8.5' },
  { setId: 'sv09',     url: '/pokemon/sets/scarlet-violet/journey-together/cards',     name: 'Journey Together', short: 'SV9' },
  { setId: 'sv10',     url: '/pokemon/sets/scarlet-violet/destined-rivals/cards',      name: 'Destined Rivals', short: 'SV10' },
  { setId: 'zsv10pt5', url: '/pokemon/sets/scarlet-violet/black-bolt/cards',           name: 'Black Bolt', short: 'SV10.5' },
  { setId: 'rsv10pt5', url: '/pokemon/sets/scarlet-violet/white-flare/cards',          name: 'White Flare', short: 'SV10.5' },
  { setId: 'me01',     url: '/pokemon/sets/mega-evolution/base-set/cards',            name: 'Mega Evolution', short: 'ME1' },
  { setId: 'me02',     url: '/pokemon/sets/mega-evolution/phantasmal-flames/cards',   name: 'Phantasmal Flames', short: 'ME2' },
  { setId: 'me02pt5',  url: '/pokemon/sets/mega-evolution/ascended-heroes/cards',      name: 'Ascended Heroes', short: 'ME2.5' },
  { setId: 'me03',     url: '/pokemon/sets/mega-evolution/perfect-order/cards',        name: 'Perfect Order', short: 'ME3' },
  { setId: 'me04',     url: '/pokemon/sets/mega-evolution/chaos-rising/cards',         name: 'Chaos Rising', short: 'ME4' },
  { setId: 'me05',     url: '/pokemon/sets/mega-evolution/pitch-black/cards',          name: 'Pitch Black', short: 'ME5' },
];

function buildSeriesNavHtml(order, currentSetId) {
  const idx = order.findIndex(s => s.setId === currentSetId);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const prevHtml = prev
    ? `<a href="${prev.url}" style="color:var(--text-muted);text-decoration:none;">&larr; Previous: ${prev.name} (${prev.short})</a>`
    : '<span></span>';
  const nextHtml = next
    ? `<a href="${next.url}" style="color:var(--text-muted);text-decoration:none;">Next: ${next.name} (${next.short}) &rarr;</a>`
    : '<span></span>';
  return `<div class="series-nav" style="display:flex;justify-content:space-between;gap:16px;margin:0 0 16px;font-size:0.85rem;">${prevHtml}${nextHtml}</div>`;
}

const SERIES_NAV_HTML = buildSeriesNavHtml(PM_SERIES_ORDER, SET_ID);

let html = readFileSync('set-template.html', 'utf8');

const vars = {
  '{{SERIES_NAV}}':         SERIES_NAV_HTML,
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
  '{{SET_RELEASE_DATE_FULL}}': releaseDate,
  '{{SET_TOTAL_CARDS}}':    String(officialCount) || '118',
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
  '{{SEO_OG_TITLE}}':       SEO_OG_TITLE,
  '{{FAQ_SECTION}}':        FAQ_SECTION,
  '{{FAQ_JSONLD}}':         FAQ_JSONLD,
  '{{SEO_META_DESC}}':      SEO_META_DESC,
  '{{SEO_INTRO}}':          SEO_INTRO,
  '{{BODY_BACKGROUND}}': 'linear-gradient(to bottom right, #0f172a, #1e1b4b, #581c87)',
};

for (const [placeholder, value] of Object.entries(vars)) {
  html = html.replaceAll(placeholder, value);
}

// ── Handle JP phase conditional blocks ────────────────────────────────────────
if (PHASE === 'jp') {
  html = html.replace(/\{\{#IF_JP_PHASE\}\}([\s\S]*?)\{\{\/IF_JP_PHASE\}\}/g, '$1');

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

if (SEO_INTRO) {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}([\s\S]*?)\{\{\/IF_SEO_INTRO\}\}/g, '$1');
} else {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}[\s\S]*?\{\{\/IF_SEO_INTRO\}\}/g, '');
}

const remaining = [...html.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m => m[0]);
if (remaining.length) {
  console.warn(`⚠️  Unreplaced placeholders: ${[...new Set(remaining)].join(', ')}`);
}


// ── Inject static SEO card table ───────────────────────────────────────────────
// Fetches card list from R2 metadata JSON and appends a visually-hidden table
// so Google can index all card names, numbers, and rarities as static HTML.
try {
  const metaUrl = `${R2_PUBLIC_URL}/data/${SET_ID}.json`;
  console.log(`\n📋 Fetching card metadata for SEO table from ${metaUrl}...`);
  const metaRes = await fetch(metaUrl);
  if (metaRes.ok) {
    const metaJson = await metaRes.json();
    const seoCards = metaJson.cards || [];
    if (seoCards.length > 0) {
      const rows = seoCards.map(c => {
        const cardPath = `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards/${c.name.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${c.localId}`;
        return `<tr><td>${c.localId}</td><td><a href="${cardPath}">${c.name}</a></td><td>${c.rarity || ''}</td></tr>`;
      }).join('\n');
      const staticTable = `
<!-- SEO: static card list for search engine indexing -->
<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0" aria-hidden="true">
<h2>${SET_FULL_NAME} Card List — All ${seoCards.length} Cards</h2>
<table>
<thead><tr><th>Number</th><th>Card Name</th><th>Rarity</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
      html = html.replace('</body>', staticTable + '\n</body>');
      console.log(`✅  Injected static SEO table with ${seoCards.length} cards`);
    } else {
      console.warn('⚠️  No cards in metadata JSON — skipping SEO table');
    }
  } else {
    console.warn(`⚠️  Could not fetch card metadata (${metaRes.status}) — skipping SEO table`);
  }
} catch (seoErr) {
  console.warn(`⚠️  SEO table injection failed: ${seoErr.message} — continuing`);
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
  { slug: 'pokemon/sets/scarlet-violet/black-bolt/cards', name: 'Black Bolt',           series: 'Scarlet & Violet', short: 'BBT',  setId: 'zsv10pt5'},
  { slug: 'pokemon/sets/scarlet-violet/white-flare/cards', name: 'White Flare',         series: 'Scarlet & Violet', short: 'WHF',  setId: 'rsv10pt5'},
  { slug: 'pokemon/sets/mega-evolution/base-set/cards',      name: 'Mega Evolution (ME1)', series: 'Mega Evolution', short: 'ME01', setId: 'me01'    },
  { slug: 'phantasmal-flames-card-list',       name: 'Phantasmal Flames',               series: 'Mega Evolution',   short: 'PFL',  setId: 'me02'    },
  { slug: 'pokemon/sets/mega-evolution/ascended-heroes/cards', name: 'Ascended Heroes', series: 'Mega Evolution',   short: 'ASC',  setId: 'me02pt5' },
  { slug: 'perfect-order-card-list',           name: 'Perfect Order (ME3)',             series: 'Mega Evolution',   short: 'ME3',  setId: 'me03'    },
  { slug: 'chaos-rising-card-list',            name: 'Chaos Rising (ME4)',              series: 'Mega Evolution',   short: 'ME4',  setId: 'me04'    },
  { slug: 'pitch-black-card-list',             name: 'Pitch Black (ME5)',               series: 'Mega Evolution',   short: 'ME5',  setId: 'me05'    },
];

const setsPath = 'sets.json';
const existingSets = existsSync(setsPath) ? JSON.parse(readFileSync(setsPath, 'utf8')) : [];

const knownSetIds = new Set(ALL_KNOWN_SETS.map(s => s.setId));

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

// Preserve any sets not in ALL_KNOWN_SETS (e.g. One Piece sets)
const unknownExisting = existingSets.filter(s => !knownSetIds.has(s.setId));
const finalSets = [...mergedSets, ...unknownExisting];

writeFileSync(setsPath, JSON.stringify(finalSets, null, 2));
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

vercel.rewrites = vercel.rewrites.filter(r => r.source !== CARD_WILDCARD.source);
vercel.rewrites = vercel.rewrites.filter(r =>
  !r.source.startsWith(`/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/`)
);

vercel.rewrites.push(
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`,          destination: `/${SET_SLUG}.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/sealed-product`, destination: `/${SET_SLUG}.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/most-valuable`,  destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/most-valuable.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/top-chase-cards`,destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/top-chase-cards.html` },
);

vercel.rewrites.push(CARD_WILDCARD);

const flatSource = `/${SET_SLUG}`;
const flatDest   = `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`;
if (!vercel.redirects.find(r => r.source === flatSource)) {
  vercel.redirects.push({ source: flatSource, destination: flatDest, permanent: true });
  console.log(`\n🔀 Added redirect ${flatSource} → ${flatDest}`);
}

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






