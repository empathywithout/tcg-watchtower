// scripts/generate-jp-page.js
// Generates a Japanese set guide HTML page for JP Mega Evolution source sets.
// Kept strictly separate from generate-set-page.js — never modifies sets.json,
// PM_SERIES_ORDER, or EN vercel.json rewrites.
//
// Usage:
//   node scripts/generate-jp-page.js
//
// Required env vars:
//   SET_ID          e.g. m1l_ja
//   SET_FULL_NAME   e.g. "Mega Brave (M1L)"
//
// Optional env vars:
//   HERO_CARD_1/2/3   localId of the 3 stacked hero card images (default: 001/002/003)
//   HERO_ALT_1/2/3    alt text for hero cards
//   CF_R2_PUBLIC_URL  Your R2 public URL for card images
//   SCRYDEX_API_KEY   Scrydex API key
//   SCRYDEX_TEAM_ID   Scrydex Team ID

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ── Inputs ─────────────────────────────────────────────────────────────────────
const SET_ID        = (process.env.SET_ID        || '').trim();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || '').trim();

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const R2_PUBLIC_URL   = process.env.CF_R2_PUBLIC_URL || '';

if (!SET_ID || !SET_FULL_NAME) {
  console.error('❌  SET_ID and SET_FULL_NAME are required');
  process.exit(1);
}

// ── Load JP set config ─────────────────────────────────────────────────────────
const setsJP  = JSON.parse(readFileSync('sets-jp.json',  'utf8'));
const sealedJP = JSON.parse(readFileSync('sealed-jp.json', 'utf8'));

const setConfig = setsJP.find(s => s.setId === SET_ID);
if (!setConfig) {
  console.error(`❌  No entry found for ${SET_ID} in sets-jp.json`);
  process.exit(1);
}

const SET_SERIES      = 'Mega Evolution';
const SET_SERIES_SLUG = 'mega-evolution-jp';
const SET_URL_SLUG    = setConfig.slug;           // e.g. "mega-brave"
const SET_SLUG        = `jp-${setConfig.slug}`;  // e.g. "jp-mega-brave" — the HTML filename
const SET_SHORT_NAME  = setConfig.short;          // e.g. "M1L"
const SET_SEO_PATH    = `pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`;
const SCRYDEX_ID      = setConfig.scrydexId;      // e.g. "m1l_ja"
const EN_EQUIVALENT   = setConfig.enSetName;      // e.g. "Mega Evolution Base Set (ME1)"
const EN_SET_ID       = setConfig.enEquivalent;   // e.g. "me01"
const IS_HIGH_CLASS   = setConfig.isHighClassPack || false;

console.log(`\n🇯🇵 Generating JP page: ${SET_FULL_NAME} (${SET_ID})`);
console.log(`   URL: /pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`);
console.log(`   HTML: ${SET_SLUG}.html`);
console.log(`   EN equivalent: ${EN_EQUIVALENT}`);

// ── JP series order (source of truth for prev/next nav) ────────────────────────
// Update this array as new JP ME sets release. Never modify PM_SERIES_ORDER.
const JP_ME_SERIES_ORDER = [
  { setId: 'm1l_ja', url: '/pokemon/sets/mega-evolution-jp/mega-brave/cards',      name: 'Mega Brave',      short: 'M1L' },
  { setId: 'm1s_ja', url: '/pokemon/sets/mega-evolution-jp/mega-symphonia/cards',  name: 'Mega Symphonia',  short: 'M1S' },
  { setId: 'm2_ja',  url: '/pokemon/sets/mega-evolution-jp/inferno-x/cards',       name: 'Inferno X',       short: 'M2'  },
  { setId: 'm2a_ja', url: '/pokemon/sets/mega-evolution-jp/mega-dream-ex/cards',   name: 'MEGA Dream ex',   short: 'M2a' },
  { setId: 'm3_ja',  url: '/pokemon/sets/mega-evolution-jp/nihil-zero/cards',      name: 'Nihil Zero',      short: 'M3'  },
  { setId: 'm4_ja',  url: '/pokemon/sets/mega-evolution-jp/ninja-spinner/cards',   name: 'Ninja Spinner',   short: 'M4'  },
  { setId: 'm5_ja',  url: '/pokemon/sets/mega-evolution-jp/abyss-eye/cards',       name: 'Abyss Eye',       short: 'M5'  },
];

function buildSeriesNavHtml(order, currentSetId) {
  const idx     = order.findIndex(s => s.setId === currentSetId);
  const prev    = idx > 0 ? order[idx - 1] : null;
  const next    = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const prevHtml = prev
    ? `<a href="${prev.url}" style="color:var(--text-muted);text-decoration:none;">&larr; Previous: ${prev.name} (${prev.short})</a>`
    : '<span></span>';
  const nextHtml = next
    ? `<a href="${next.url}" style="color:var(--text-muted);text-decoration:none;">Next: ${next.name} (${next.short}) &rarr;</a>`
    : '<span></span>';
  return `<div class="series-nav" style="display:flex;justify-content:space-between;gap:16px;margin:0 0 16px;font-size:0.85rem;">${prevHtml}${nextHtml}</div>`;
}

const SERIES_NAV_HTML = buildSeriesNavHtml(JP_ME_SERIES_ORDER, SET_ID);

// ── Fetch JP set metadata from Scrydex ────────────────────────────────────────
let setData      = {};
let officialCount = 0;

if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
  console.log(`\n📋 Fetching JP set metadata from Scrydex (${SCRYDEX_ID})…`);
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/ja/expansions/${SCRYDEX_ID}`, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
    });
    if (res.ok) {
      const raw     = await res.json();
      setData       = raw.data || raw;
      officialCount = setData.printedTotal || setData.total || 0;
      console.log(`✅  Scrydex JP: ${setData.name || SET_FULL_NAME} — ${officialCount} official cards`);
    } else {
      console.warn(`⚠️  Scrydex ${res.status} — using manual values`);
    }
  } catch (e) {
    console.warn(`⚠️  Scrydex metadata failed: ${e.message} — using manual values`);
  }
} else {
  console.warn('⚠️  No Scrydex credentials — skipping metadata fetch');
}

const releaseDate = setConfig.releaseDate
  ? new Date(setConfig.releaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  : '???';

const SET_SUBTITLE    = SET_FULL_NAME;
const SET_SEARCH_NAME = SET_FULL_NAME;
const SET_TCGP_SLUG   = setConfig.tcgpSlug;

console.log(`✅  ${SET_SUBTITLE} — ${officialCount} cards, released ${releaseDate}`);

// ── Hero cards ─────────────────────────────────────────────────────────────────
// JP sets use Scrydex CDN images directly — no R2 pipeline needed
let HERO_CARD_1 = process.env.HERO_CARD_1 || '001';
let HERO_CARD_2 = process.env.HERO_CARD_2 || '002';
let HERO_CARD_3 = process.env.HERO_CARD_3 || '003';
let HERO_ALT_1  = process.env.HERO_ALT_1  || 'Card 1';
let HERO_ALT_2  = process.env.HERO_ALT_2  || 'Card 2';
let HERO_ALT_3  = process.env.HERO_ALT_3  || 'Card 3';

// ── Sealed products ────────────────────────────────────────────────────────────
const setProducts = sealedJP[SET_ID] || [];
const productMeta = {};

for (const p of setProducts) {
  productMeta[p.tcgpId] = {
    ...p,
    image: `https://product-images.tcgplayer.com/fit-in/437x437/${p.tcgpId}.jpg`,
  };
  console.log(`  ✅  ${p.type}: ${p.name}`);
}

const productMetaJson = JSON.stringify(productMeta);

// ── Per-set SEO data ───────────────────────────────────────────────────────────
const SEO_DATA = {
  'm1l_ja': {
    metaTitle: `Mega Brave Card List (M1L): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Mega Brave (M1L) Japanese card list — all cards with rarity filters, chase cards ranked by price, and where to buy. English guide for Japanese collectors.`,
    intro: `Mega Brave (M1L) is the first set in the Japanese Pokémon TCG Mega Evolution series, released August 1, 2025. The set is the Japanese source for the English Mega Evolution Base Set and introduces Mega Evolution Pokémon ex to the modern card game for the first time. Mega Brave contains 92 cards across multiple rarity tiers including Special Art Rares and the coveted Mega Hyper Rare. This complete Mega Brave card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Mega Brave?', a: 'Mega Brave (M1L) is the first Japanese expansion in the Pokémon TCG Mega Evolution series, released August 1, 2025. It is the Japanese source set for the English Mega Evolution Base Set (ME1).' },
      { q: 'What is the English equivalent of Mega Brave?', a: 'Mega Brave (M1L) is the Japanese source for Mega Evolution Base Set (ME1), which released in English in October 2025.' },
      { q: 'How many cards are in Mega Brave?', a: 'Mega Brave contains 92 cards in total, including main set cards and secret rares across Special Art Rare and Mega Hyper Rare tiers.' },
      { q: 'Are Japanese Mega Brave cards legal in tournaments?', a: 'Japanese cards are legal in official Pokémon TCG tournaments as long as they have an exact English equivalent. Mega Brave cards with English counterparts in Mega Evolution Base Set are tournament legal.' },
      { q: 'Where can I buy Mega Brave Japanese booster boxes?', a: 'Mega Brave Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm1s_ja': {
    metaTitle: `Mega Symphonia Card List (M1S): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Mega Symphonia (M1S) Japanese card list — all cards with rarity filters, chase cards ranked by price, and where to buy. English guide for Japanese collectors.`,
    intro: `Mega Symphonia (M1S) is the companion set to Mega Brave, released simultaneously on August 1, 2025. Together Mega Brave and Mega Symphonia form the Japanese foundation of the English Mega Evolution Base Set (ME1). Mega Symphonia contains 92 cards and introduces a distinct lineup of Mega Evolution Pokémon ex alongside Mega Brave. This complete Mega Symphonia card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Mega Symphonia?', a: 'Mega Symphonia (M1S) is the second Japanese expansion in the Pokémon TCG Mega Evolution series, released August 1, 2025 alongside Mega Brave. Together the two sets are the source for the English Mega Evolution Base Set (ME1).' },
      { q: 'What is the difference between Mega Brave and Mega Symphonia?', a: 'Mega Brave and Mega Symphonia released simultaneously and each contain different Mega Evolution Pokémon ex. They are companion sets — both feed into the English Mega Evolution Base Set (ME1).' },
      { q: 'What is the English equivalent of Mega Symphonia?', a: 'Mega Symphonia (M1S) is one of the two Japanese source sets for Mega Evolution Base Set (ME1) in English.' },
      { q: 'Are Japanese Mega Symphonia cards legal in tournaments?', a: 'Japanese cards are legal in official Pokémon TCG tournaments as long as they have an exact English equivalent. Mega Symphonia cards with English counterparts in Mega Evolution Base Set are tournament legal.' },
      { q: 'Where can I buy the Mega Brave and Mega Symphonia Premium Trainer Box?', a: 'The Premium Trainer Box MEGA covers both Mega Brave and Mega Symphonia and is available on TCGplayer (product ID 648589). It is a JP-exclusive product with no direct English equivalent.' },
    ],
  },
  'm2_ja': {
    metaTitle: `Inferno X Card List (M2): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Inferno X (M2) Japanese card list — all cards with rarity filters, Mega Charizard X ex chase pulls, and where to buy. English guide for Japanese collectors.`,
    intro: `Inferno X (M2) is the second main set in the Japanese Pokémon TCG Mega Evolution series, released September 26, 2025. Built around Mega Charizard X ex as its flagship card, Inferno X is the Japanese source for the English Phantasmal Flames (ME2). The set contains 116 cards across multiple rarity tiers including Special Art Rares and a Mega Hyper Rare. This complete Inferno X card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Inferno X?', a: 'Inferno X (M2) is the second Japanese expansion in the Pokémon TCG Mega Evolution series, released September 26, 2025. It is the Japanese source set for the English Phantasmal Flames (ME2).' },
      { q: 'What is the English equivalent of Inferno X?', a: 'Inferno X (M2) is the Japanese source for Phantasmal Flames (ME2), which released in English in November 2025.' },
      { q: 'What is the top chase card in Inferno X?', a: 'The top chase card in Inferno X is Mega Charizard X ex in its Mega Hyper Rare form — the highest rarity pull in the set.' },
      { q: 'How many cards are in Inferno X?', a: 'Inferno X contains 116 cards in total, including main set cards plus secret rares across Art Rare, Special Art Rare, and Mega Hyper Rare tiers.' },
      { q: 'Where can I buy Inferno X Japanese booster boxes?', a: 'Inferno X Japanese booster boxes are available on TCGplayer (product ID 655968), Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm2a_ja': {
    metaTitle: `MEGA Dream ex Card List (M2a): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete MEGA Dream ex (M2a) Japanese card list — all 250 cards with rarity filters, chase cards ranked by price, and where to buy. English guide for Japanese collectors.`,
    intro: `MEGA Dream ex (M2a) is the High Class Pack subset of the Japanese Pokémon TCG Mega Evolution series, released November 28, 2025. As the Japanese source for the English Ascended Heroes (ME2.5), MEGA Dream ex is a reprint-heavy premium set focused entirely on Mega Evolution Pokémon ex including new Mega Evolution cards based on Pokémon Legends: Z-A. Each booster pack contains 10 cards with a guaranteed Pokémon ex or Mega Evolution Pokémon ex. This complete MEGA Dream ex card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is MEGA Dream ex?', a: 'MEGA Dream ex (M2a) is the Japanese High Class Pack subset in the Pokémon TCG Mega Evolution series, released November 28, 2025. It is the Japanese source for the English Ascended Heroes (ME2.5).' },
      { q: 'What is the English equivalent of MEGA Dream ex?', a: 'MEGA Dream ex (M2a) is the Japanese source for Ascended Heroes (ME2.5), which released in English in January 2026.' },
      { q: 'How is MEGA Dream ex different from other Mega Evolution sets?', a: 'MEGA Dream ex is a High Class Pack — each booster pack contains 10 cards (vs 5 in standard sets) and each box contains only 10 packs. Every pack guarantees at least one Pokémon ex or Mega Evolution Pokémon ex.' },
      { q: 'How many cards are in MEGA Dream ex?', a: 'MEGA Dream ex contains 250 cards in total, making it one of the largest Japanese sets in the Mega Evolution series.' },
      { q: 'Where can I buy MEGA Dream ex Japanese booster boxes?', a: 'MEGA Dream ex Japanese booster boxes are available on TCGplayer (product ID 666254), Amazon, and eBay. Each box contains 10 packs of 10 cards.' },
    ],
  },
  'm3_ja': {
    metaTitle: `Nihil Zero Card List (M3): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Nihil Zero (M3) Japanese card list — all cards with rarity filters, Mega Zygarde ex chase pulls, and where to buy. English guide for Japanese collectors.`,
    intro: `Nihil Zero (M3) is the third main set in the Japanese Pokémon TCG Mega Evolution series, released in early 2026. Built around Mega Zygarde ex as its flagship card, Nihil Zero is the Japanese source for the English Perfect Order (ME3). This complete Nihil Zero card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Nihil Zero?', a: 'Nihil Zero (M3) is the third Japanese expansion in the Pokémon TCG Mega Evolution series. It is the Japanese source set for the English Perfect Order (ME3).' },
      { q: 'What is the English equivalent of Nihil Zero?', a: 'Nihil Zero (M3) is the Japanese source for Perfect Order (ME3), released in English in March 2026.' },
      { q: 'What is the top chase card in Nihil Zero?', a: 'The top chase card in Nihil Zero is Mega Zygarde ex in its Mega Ultra Rare form at the apex of the rarity ladder.' },
      { q: 'Where can I buy Nihil Zero Japanese booster boxes?', a: 'Nihil Zero Japanese booster boxes are available on TCGplayer (product ID 674449), Amazon, and eBay. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm4_ja': {
    metaTitle: `Ninja Spinner Card List (M4): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Ninja Spinner (M4) Japanese card list — all 120 cards with rarity filters, Mega Greninja ex chase pulls, and where to buy. English guide for Japanese collectors.`,
    intro: `Ninja Spinner (M4) is the fourth main set in the Japanese Pokémon TCG Mega Evolution series, released March 13, 2026. Built around Mega Greninja ex as its flagship card, Ninja Spinner is the Japanese source for the English Chaos Rising (ME4). The set contains 120 cards across Art Rare, Special Art Rare, and Mega Hyper Rare tiers with Mega Greninja ex MHR as the apex pull. This complete Ninja Spinner card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Ninja Spinner?', a: 'Ninja Spinner (M4) is the fourth Japanese expansion in the Pokémon TCG Mega Evolution series, released March 13, 2026. It is the Japanese source set for the English Chaos Rising (ME4).' },
      { q: 'What is the English equivalent of Ninja Spinner?', a: 'Ninja Spinner (M4) is the Japanese source for Chaos Rising (ME4), which released in English in May 2026.' },
      { q: 'What is the top chase card in Ninja Spinner?', a: 'The top chase card in Ninja Spinner is Mega Greninja ex in its Mega Hyper Rare form — one of the most anticipated Mega Evolution pulls in the series.' },
      { q: 'How many cards are in Ninja Spinner?', a: 'Ninja Spinner contains 120 cards in total — 83 main set cards plus 37 secret rares across Art Rare, Special Art Rare, and Mega Hyper Rare tiers.' },
      { q: 'Where can I buy Ninja Spinner Japanese booster boxes?', a: 'Ninja Spinner Japanese booster boxes are available on TCGplayer (product ID 683774), Amazon, and eBay. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm5_ja': {
    metaTitle: `Abyss Eye Card List (M5): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Abyss Eye (M5) Japanese card list — all 118 cards with rarity filters, Mega Darkrai ex chase pulls, and where to buy. English guide for Japanese collectors.`,
    intro: `Abyss Eye (M5) is the fifth main set in the Japanese Pokémon TCG Mega Evolution series, released May 22, 2026. Built around Mega Darkrai ex as its flagship card, Abyss Eye is the Japanese source for the English Pitch Black (ME5). The set contains 118 cards with a dark and atmospheric lineup inspired by Pokémon Legends: Z-A. This complete Abyss Eye card list covers all JP cards with EN name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Abyss Eye?', a: 'Abyss Eye (M5) is the fifth Japanese expansion in the Pokémon TCG Mega Evolution series, released May 22, 2026. It is the Japanese source set for the English Pitch Black (ME5).' },
      { q: 'What is the English equivalent of Abyss Eye?', a: 'Abyss Eye (M5) is the Japanese source for Pitch Black (ME5), which released in English in July 2026.' },
      { q: 'What is the top chase card in Abyss Eye?', a: 'The top chase card in Abyss Eye is Mega Darkrai ex in its Special Art Rare form, illustrated by Akira Egawa.' },
      { q: 'How many cards are in Abyss Eye?', a: 'Abyss Eye contains 118 cards in total — 81 main set cards plus 37 secret rares.' },
      { q: 'Where can I buy Abyss Eye Japanese booster boxes?', a: 'Abyss Eye Japanese booster boxes are available on TCGplayer (product ID 695112), Amazon, and eBay. Each box contains 30 packs of 5 cards.' },
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

const seoData = SEO_DATA[SET_ID] || {};

const DEFAULT_FAQ = [
  { q: `What is ${SET_FULL_NAME}?`, a: `${SET_FULL_NAME} is a Japanese Pokémon TCG expansion in the Mega Evolution series. The English equivalent is ${EN_EQUIVALENT}.` },
  { q: `How many cards are in the ${SET_FULL_NAME} card list?`, a: `${SET_FULL_NAME} contains ${officialCount || 'over 100'} cards in total. Use the rarity filter above to browse by type.` },
  { q: `When did ${SET_FULL_NAME} release?`, a: `${SET_FULL_NAME} released ${releaseDate} in Japan.` },
  { q: `What is the English equivalent of ${SET_FULL_NAME}?`, a: `${SET_FULL_NAME} is the Japanese source set for the English ${EN_EQUIVALENT}.` },
  { q: `Are Japanese ${SET_FULL_NAME} cards legal in tournaments?`, a: `Japanese Pokémon TCG cards are tournament legal when an exact English equivalent exists. Cards from ${SET_FULL_NAME} with English counterparts in ${EN_EQUIVALENT} are legal in official play.` },
];

const FAQ_ITEMS   = seoData.faq || DEFAULT_FAQ;
const FAQ_SECTION = buildFAQSection(FAQ_ITEMS, SET_FULL_NAME);
const FAQ_JSONLD  = buildFAQJsonLD(FAQ_ITEMS);

const SEO_META_TITLE = seoData.metaTitle || `${SET_FULL_NAME} Card List — Japanese Pokémon TCG Prices & Guide | TCG Watchtower`;
const SEO_META_DESC  = seoData.metaDesc  || `Complete ${SET_FULL_NAME} Japanese card list with EN translations, rarity filters, chase cards ranked by price, and sealed product guide. English resource for Japanese Pokémon TCG collectors.`;
const SEO_OG_TITLE   = SEO_META_TITLE;
const SEO_INTRO      = seoData.intro || '';

// Note: JP banner HTML lives in set-template.html inside {{#IF_JP_PHASE}} block.
// Generator just strips the conditional tags to show it on JP pages.

// ── Fill template ──────────────────────────────────────────────────────────────
let html = readFileSync('set-template.html', 'utf8');
const SET_PAGE_CSS = readFileSync('static/set-page.css', 'utf8').trim();
const SET_PAGE_JS  = readFileSync('static/set-page.js',  'utf8').trim();

const vars = {
  '{{GA_CUSTOM_DIMS}}':        JSON.stringify({ set_id: SET_ID, series: SET_SERIES, page_type: 'set_list', language: 'jp' }),
  '{{SERIES_NAV}}':            SERIES_NAV_HTML,
  '{{SET_ID}}':                SET_ID,
  '__R2_PUBLIC_URL__':         R2_PUBLIC_URL,
  '{{SET_FULL_NAME}}':         SET_FULL_NAME,
  '{{SET_SERIES}}':            SET_SERIES,
  '{{SET_SERIES_SLUG}}':       SET_SERIES_SLUG,
  '{{SET_URL_SLUG}}':          SET_URL_SLUG,
  '{{SET_SLUG_FOR_URL}}':      SET_URL_SLUG,
  '{{SET_SEO_PATH}}':          SET_SEO_PATH,
  '{{SET_SUBTITLE}}':          SET_SUBTITLE,
  '{{SET_SHORT_NAME}}':        SET_SHORT_NAME,
  '{{SET_RELEASE_DATE}}':      releaseDate,
  '{{SET_RELEASE_DATE_FULL}}': releaseDate,
  '{{SET_TOTAL_CARDS}}':       String(officialCount) || '100',
  '{{SET_DESCRIPTION}}':       `Complete guide to ${SET_FULL_NAME} — full Japanese card list with English translations, chase cards ranked by price, and where to buy sealed product.`,
  '{{SET_OFFICIAL_COUNT}}':    String(officialCount),
  '{{SET_SEARCH_NAME}}':       SET_SEARCH_NAME,
  '{{SET_TCGP_SLUG}}':         SET_TCGP_SLUG,
  '{{TCGP_GROUP_ID}}':         '0',   // JP sets use Scrydex for prices, not TCGCSV
  '{{SET_PHASE}}':             'jp',  // Always jp for JP pages
  '{{SET_SLUG}}':              SET_SLUG,
  '{{HERO_CARD_1}}':           HERO_CARD_1,
  '{{HERO_CARD_2}}':           HERO_CARD_2,
  '{{HERO_CARD_3}}':           HERO_CARD_3,
  '{{HERO_ALT_1}}':            HERO_ALT_1,
  '{{HERO_ALT_2}}':            HERO_ALT_2,
  '{{HERO_ALT_3}}':            HERO_ALT_3,
  '{{PRODUCT_META_JSON}}':     productMetaJson,
  '{{CHASE_CARDS_JSON}}':      '[]',
  '{{SEO_META_TITLE}}':        SEO_META_TITLE,
  '{{SEO_OG_TITLE}}':          SEO_OG_TITLE,
  '{{FAQ_SECTION}}':           FAQ_SECTION,
  '{{FAQ_JSONLD}}':            FAQ_JSONLD,
  '{{SEO_META_DESC}}':         SEO_META_DESC,
  '{{SEO_INTRO}}':             SEO_INTRO,
  '{{SET_PAGE_CSS}}':          SET_PAGE_CSS,
  '{{SET_PAGE_JS}}':           SET_PAGE_JS,
};

for (const [placeholder, value] of Object.entries(vars)) {
  html = html.replaceAll(placeholder, value);
}

// ── Handle JP phase conditional blocks ────────────────────────────────────────
// JP pages always show the JP banner (template already contains banner HTML)
html = html.replace(/\{\{#IF_JP_PHASE\}\}([\s\S]*?)\{\{\/IF_JP_PHASE\}\}/g, '$1');

// Register Scrydex JP ID for client-side price fetching
const scrydexJpPatch = `
<script>
  // Register Scrydex JP ID for this set
  if (window.SCRYDEX_JP_ID_MAP) {
    window.SCRYDEX_JP_ID_MAP[${JSON.stringify(SET_ID)}] = ${JSON.stringify(SCRYDEX_ID)};
  } else {
    window.SCRYDEX_JP_ID_MAP = { ${JSON.stringify(SET_ID)}: ${JSON.stringify(SCRYDEX_ID)} };
  }

  // Override cardImg to use Scrydex CDN for JP sets
  // JP card IDs in Scrydex look like "m2a_ja-001" — build that from setId + localId
  window.__JP_CARD_IMG_OVERRIDE__ = function(setId, localId) {
    if (!setId || !setId.includes('_ja')) return null;
    // Pad localId to 3 digits
    const paddedId = String(localId).padStart(3, '0');
    return 'https://images.scrydex.com/pokemon/' + setId + '-' + paddedId + '/medium';
  };

  // Override set logo to use R2 with EN equivalent fallback
  window.__JP_LOGO_OVERRIDE__ = ${JSON.stringify(setConfig.enEquivalent || SET_ID)};
</script>`;
html = html.replace('</head>', scrydexJpPatch + '\n</head>');

// Also patch cardImg and setLogoUrl calls in the page to use JP overrides
// Inject override after CONFIG is defined
const jpImgPatch = `
// ── JP image overrides ────────────────────────────────────────────────────────
(function() {
  const _origCardImg = typeof cardImg === 'function' ? cardImg : null;
  if (window.__JP_CARD_IMG_OVERRIDE__) {
    window.cardImg = function(setId, localId) {
      const jpUrl = window.__JP_CARD_IMG_OVERRIDE__(setId, localId);
      if (jpUrl) return jpUrl;
      return _origCardImg ? _origCardImg(setId, localId) : '';
    };
  }
  const _origLogoUrl = typeof setLogoUrl === 'function' ? setLogoUrl : null;
  if (window.__JP_LOGO_OVERRIDE__ && _origLogoUrl) {
    window.setLogoUrl = function(setId) {
      if (setId && setId.includes('_ja')) return _origLogoUrl(window.__JP_LOGO_OVERRIDE__);
      return _origLogoUrl(setId);
    };
  }
})();
// ─────────────────────────────────────────────────────────────────────────────
`;
// Inject right after the CONFIG block closes
html = html.replace('// ─── FIX: derive TCGdex series prefix from any set ID ───────────────────────', jpImgPatch + '\n// ─── FIX: derive TCGdex series prefix from any set ID ───────────────────────');

// Inject SEO intro if present
if (SEO_INTRO) {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}([\s\S]*?)\{\{\/IF_SEO_INTRO\}\}/g, '$1');
} else {
  html = html.replace(/\{\{#IF_SEO_INTRO\}\}[\s\S]*?\{\{\/IF_SEO_INTRO\}\}/g, '');
}

// Warn on any remaining unreplaced placeholders
const remaining = [...html.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m => m[0]);
if (remaining.length) {
  console.warn(`⚠️  Unreplaced placeholders: ${[...new Set(remaining)].join(', ')}`);
}

// ── Inject static SEO card table ───────────────────────────────────────────────
// Uses JP set ID namespaced under ja: prefix in R2
try {
  const metaUrl = `${R2_PUBLIC_URL}/data/${SET_ID}.json`;
  console.log(`\n📋 Fetching card metadata for SEO table from ${metaUrl}...`);
  const metaRes = await fetch(metaUrl);
  if (metaRes.ok) {
    const metaJson = await metaRes.json();
    const seoCards = metaJson.cards || [];
    if (seoCards.length > 0) {
      const rows = seoCards.map(c => {
        const enName = c.nameEN || c.name;
        const cardPath = `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards/${enName.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${c.localId}`;
        return `<tr><td>${c.localId}</td><td><a href="${cardPath}">${enName}</a></td><td>${c.rarity || ''}</td></tr>`;
      }).join('\n');
      const staticTable = `
<!-- SEO: static card list for search engine indexing -->
<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0" aria-hidden="true">
<h2>${SET_FULL_NAME} Card List — All ${seoCards.length} Cards (Japanese)</h2>
<table>
<thead><tr><th>Number</th><th>Card Name</th><th>Rarity</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
      html = html.replace('</body>', staticTable + '\n</body>');
      console.log(`✅  Injected static SEO table with ${seoCards.length} cards`);
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

// ── Update sets-jp.json live flag ──────────────────────────────────────────────
// Mark this set as live — never touches sets.json (EN only)
const updatedSetsJP = setsJP.map(s =>
  s.setId === SET_ID ? { ...s, live: true } : s
);
writeFileSync('sets-jp.json', JSON.stringify(updatedSetsJP, null, 2));
console.log(`\n📋 sets-jp.json updated — ${SET_SLUG} is now live`);

// ── Update sitemap.xml ─────────────────────────────────────────────────────────
const SITE_URL    = 'https://tcgwatchtower.com';
const sitemapPath = 'sitemap.xml';
const newUrl      = `${SITE_URL}/${SET_SEO_PATH}`;

let sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
if (sitemap.includes(newUrl)) {
  console.log(`\n📍 Sitemap already contains ${newUrl}`);
} else {
  const newEntry = `  <url>\n    <loc>${newUrl}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  sitemap = sitemap.replace('</urlset>', `${newEntry}\n</urlset>`);
  writeFileSync(sitemapPath, sitemap);
  console.log(`\n📍 Added ${newUrl} to sitemap.xml`);
}

// ── Update vercel.json with JP rewrites ────────────────────────────────────────
const vercelPath = 'vercel.json';
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
vercel.rewrites = vercel.rewrites || [];
vercel.redirects = vercel.redirects || [];

// Remove any existing JP rewrites for this set to avoid dupes
vercel.rewrites = vercel.rewrites.filter(r =>
  !r.source.startsWith(`/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/`)
);

vercel.rewrites.push(
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards`,          destination: `/${SET_SLUG}.html` },
  { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/sealed-product`, destination: `/${SET_SLUG}.html` },
);

writeFileSync(vercelPath, JSON.stringify(vercel, null, 2));
console.log(`✅  vercel.json updated with JP rewrites`);

console.log(`\n🎉 Done! Deploy ${outFile} — live at ${newUrl}`);
