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
const SET_SERIES_SLUG = SET_ID.startsWith('sv') ? 'scarlet-violet-jp' : 'mega-evolution-jp';
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

const JP_SV_SERIES_ORDER = [
  { setId: 'sv1s_ja', url: '/pokemon/sets/scarlet-violet-jp/scarlet-ex/cards',   name: 'Scarlet ex',    short: 'SV1S' },
  { setId: 'sv1v_ja', url: '/pokemon/sets/scarlet-violet-jp/violet-ex/cards',    name: 'Violet ex',     short: 'SV1V' },
  { setId: 'sv1a_ja', url: '/pokemon/sets/scarlet-violet-jp/triplet-beat/cards', name: 'Triplet Beat',  short: 'SV1a' },
];

// Pick correct series order based on set ID
const IS_SV_JP = SET_ID.startsWith('sv');
const SERIES_ORDER = IS_SV_JP ? JP_SV_SERIES_ORDER : JP_ME_SERIES_ORDER;
const EN_SERIES_PATH = IS_SV_JP ? 'scarlet-violet' : 'mega-evolution';

function buildSeriesNavHtml(order, currentSetId, enSlug, enSetName, enSeriesPath = 'mega-evolution') {
  const idx     = order.findIndex(s => s.setId === currentSetId);
  const prev    = idx > 0 ? order[idx - 1] : null;
  const next    = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const prevHtml = prev
    ? `<a href="${prev.url}" style="color:var(--text-muted);text-decoration:none;">&larr; Previous: ${prev.name} (${prev.short})</a>`
    : '<span></span>';
  const nextHtml = next
    ? `<a href="${next.url}" style="color:var(--text-muted);text-decoration:none;">Next: ${next.name} (${next.short}) &rarr;</a>`
    : '<span></span>';
  const enLinkHtml = enSlug
    ? `<div style="text-align:center;margin-top:8px;"><a href="/pokemon/sets/${enSeriesPath}/${enSlug}/cards" style="display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);text-decoration:none;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:999px;padding:3px 14px;font-size:0.82rem;white-space:nowrap;">🇬🇧 English: <span style="color:var(--primary-blue);">${enSetName}</span> →</a></div>`
    : '';
  return `<div class="series-nav" style="margin:0 0 16px;font-size:0.85rem;">
    <div style="display:flex;justify-content:space-between;gap:16px;">${prevHtml}${nextHtml}</div>
    ${enLinkHtml}
  </div>`;
}

const SERIES_NAV_HTML = buildSeriesNavHtml(SERIES_ORDER, SET_ID, setConfig.enSlug, setConfig.enSetName, EN_SERIES_PATH);

// ── Fetch JP set metadata from Scrydex ────────────────────────────────────────
let setData      = {};
let officialCount = 0;
let printedTotal = 0;

if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
  console.log(`\n📋 Fetching JP set metadata from Scrydex (${SCRYDEX_ID})…`);
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/ja/expansions/${SCRYDEX_ID}`, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
    });
    if (res.ok) {
      const raw     = await res.json();
      setData       = raw.data || raw;
      officialCount = setData.total || setData.printedTotal || 0;
      printedTotal  = setData.printedTotal || setData.total || setConfig.printedTotal || 0;
      // For High Class Packs, Scrydex may not split printedTotal — use sets-jp.json value
      if (setConfig.printedTotal && setConfig.printedTotal < officialCount) {
        printedTotal = setConfig.printedTotal;
      }
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

// ── Download JP logo from Scrydex and upload to R2 ────────────────────────────
let jpLogoR2Url = null;
const r2LogoKey = `logos/${SET_ID}.png`;
if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID && process.env.CF_R2_ENDPOINT && R2_PUBLIC_URL) {
  try {
    const r2 = new S3Client({
      region: 'auto',
      endpoint: process.env.CF_R2_ENDPOINT,
      credentials: { accessKeyId: process.env.CF_R2_ACCESS_KEY, secretAccessKey: process.env.CF_R2_SECRET_KEY },
    });
    // Check if logo already in R2
    let logoExists = false;
    try {
      await r2.send(new HeadObjectCommand({ Bucket: process.env.CF_R2_BUCKET, Key: r2LogoKey }));
      logoExists = true;
      jpLogoR2Url = `${R2_PUBLIC_URL}/${r2LogoKey}`;
      console.log(`✅  JP logo already in R2: ${jpLogoR2Url}`);
    } catch {}

    if (!logoExists && setData.logo) {
      // Download from Scrydex (requires auth headers)
      const logoRes = await fetch(setData.logo, {
        headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
      });
      if (logoRes.ok) {
        const buf = Buffer.from(await logoRes.arrayBuffer());
        await r2.send(new PutObjectCommand({
          Bucket: process.env.CF_R2_BUCKET,
          Key: r2LogoKey,
          Body: buf,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        jpLogoR2Url = `${R2_PUBLIC_URL}/${r2LogoKey}`;
        console.log(`✅  JP logo uploaded to R2: ${jpLogoR2Url}`);
      } else {
        console.warn(`⚠️  Could not download JP logo from Scrydex: ${logoRes.status}`);
      }
    }
  } catch (logoErr) {
    console.warn(`⚠️  JP logo R2 upload failed: ${logoErr.message}`);
  }
}

// ── Hero cards ─────────────────────────────────────────────────────────────────
let HERO_CARD_1 = (setConfig.heroCards?.[0] || process.env.HERO_CARD_1 || '001');
let HERO_CARD_2 = (setConfig.heroCards?.[1] || process.env.HERO_CARD_2 || '002');
let HERO_CARD_3 = (setConfig.heroCards?.[2] || process.env.HERO_CARD_3 || '003');
let HERO_ALT_1  = process.env.HERO_ALT_1  || 'Card 1';
let HERO_ALT_2  = process.env.HERO_ALT_2  || 'Card 2';
let HERO_ALT_3  = process.env.HERO_ALT_3  || 'Card 3';

// ── Sealed products ────────────────────────────────────────────────────────────
const setProducts = sealedJP[SET_ID] || {};
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
    metaDesc:  `Complete Mega Brave (M1L) Japanese card list — 92 JP cards with English translations, chase cards ranked by price, and sealed product guide on TCG Watchtower.`,
    intro: `Mega Brave (M1L) is the first set in the Japanese Pokémon TCG Mega Evolution series, released August 1, 2025. Alongside its companion set <a href="/pokemon/sets/mega-evolution-jp/mega-symphonia/cards" style="color:var(--accent);">Mega Symphonia (M1S)</a>, Mega Brave forms the Japanese foundation of the English <a href="/pokemon/sets/mega-evolution/base-set/cards" style="color:var(--accent);">Mega Evolution Base Set (ME1)</a>. The set contains 92 cards introducing Mega Evolution Pokémon ex including Mega Lucario ex, Mega Venusaur ex, and Mega Absol ex, with Special Art Rares and Mega Hyper Rares as the top pulls. This complete Mega Brave card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Mega Brave?', a: 'Mega Brave (M1L) is the first Japanese expansion in the Pokémon TCG Mega Evolution series, released August 1, 2025. It released alongside companion set Mega Symphonia (M1S) and together they are the Japanese source for the English Mega Evolution Base Set (ME1).' },
      { q: 'What is the English equivalent of Mega Brave?', a: 'Mega Brave (M1L) is one of the two Japanese source sets for <a href="/pokemon/sets/mega-evolution/base-set/cards" style="color:var(--accent);">Mega Evolution Base Set (ME1)</a>, which released in English in October 2025.' },
      { q: 'What is the difference between Mega Brave and Mega Symphonia?', a: 'Mega Brave and Mega Symphonia released simultaneously on August 1, 2025 and contain different Mega Evolution Pokémon ex. Mega Brave features Mega Lucario ex, Mega Venusaur ex, and Mega Absol ex as key pulls, while Mega Symphonia features Mega Gardevoir ex and Mega Kangaskhan ex.' },
      { q: 'What is the rarest card in Mega Brave?', a: 'The rarest card in Mega Brave is Mega Lucario ex in its Mega Ultra Rare (MUR) gold foil form — the apex pull of the set and one of the most valuable cards in the Japanese Mega Evolution series.' },
      { q: 'Are Japanese Mega Brave cards worth buying?', a: 'Japanese Mega Brave cards are worth buying for collectors who want the original JP versions at a lower price point than their English equivalents. The Mega Brave booster box offers 30 packs of 5 cards, giving strong pull rates for Special Art Rares and Mega Hyper Rares.' },
      { q: 'Where can I buy Mega Brave Japanese booster boxes?', a: 'Mega Brave Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards. A Premium Trainer Box covering both Mega Brave and Mega Symphonia is also available.' },
    ],
  },
  'm1s_ja': {
    metaTitle: `Mega Symphonia Card List (M1S): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Mega Symphonia (M1S) Japanese card list — 92 JP cards with English translations, Mega Gardevoir ex chase pulls, and sealed product guide on TCG Watchtower.`,
    intro: `Mega Symphonia (M1S) is the companion set to <a href="/pokemon/sets/mega-evolution-jp/mega-brave/cards" style="color:var(--accent);">Mega Brave (M1L)</a>, released simultaneously on August 1, 2025. Together the two sets form the Japanese foundation of the English <a href="/pokemon/sets/mega-evolution/base-set/cards" style="color:var(--accent);">Mega Evolution Base Set (ME1)</a>. Mega Symphonia contains 92 cards with Mega Gardevoir ex, Mega Kangaskhan ex, and Mega Latias ex as key chase pulls. This complete Mega Symphonia card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Mega Symphonia?', a: 'Mega Symphonia (M1S) is the second Japanese expansion in the Pokémon TCG Mega Evolution series, released August 1, 2025 alongside Mega Brave (M1L). Together the two sets are the Japanese source for the English Mega Evolution Base Set (ME1).' },
      { q: 'What is the English equivalent of Mega Symphonia?', a: 'Mega Symphonia (M1S) is one of the two Japanese source sets for <a href="/pokemon/sets/mega-evolution/base-set/cards" style="color:var(--accent);">Mega Evolution Base Set (ME1)</a>, which released in English in October 2025.' },
      { q: 'What is the difference between Mega Brave and Mega Symphonia?', a: 'Mega Brave features Mega Lucario ex, Mega Venusaur ex, and Mega Absol ex, while Mega Symphonia features Mega Gardevoir ex, Mega Kangaskhan ex, and Mega Latias ex. They are companion sets with different Pokémon lineups but the same rarity structure.' },
      { q: 'What is the rarest card in Mega Symphonia?', a: 'The rarest card in Mega Symphonia is Mega Gardevoir ex in its Mega Ultra Rare (MUR) gold foil form, featuring one of the most striking gold card designs in the Mega Evolution series.' },
      { q: 'What is the Premium Trainer Box for Mega Brave and Mega Symphonia?', a: 'The Premium Trainer Box MEGA is a JP-exclusive product that covers both Mega Brave and Mega Symphonia with a combined set of packs and accessories. It has no direct English equivalent and is available on TCGplayer, Amazon, and eBay.' },
      { q: 'Where can I buy Mega Symphonia Japanese booster boxes?', a: 'Mega Symphonia Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm2_ja': {
    metaTitle: `Inferno X Card List (M2): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Inferno X (M2) Japanese card list — 116 JP cards with Mega Charizard X ex chase pulls, English translations, and live prices on TCG Watchtower.`,
    intro: `Inferno X (M2) is the second main set in the Japanese Pokémon TCG Mega Evolution series, released September 26, 2025. Built around Mega Charizard X ex as its flagship card, Inferno X is the Japanese source for the English <a href="/pokemon/sets/mega-evolution/phantasmal-flames/cards" style="color:var(--accent);">Phantasmal Flames (ME2)</a>. The set contains 116 cards across Art Rare, Special Art Rare, and Mega Hyper Rare tiers, with Mega Charizard X ex MHR as the most coveted pull. This complete Inferno X card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Inferno X?', a: 'Inferno X (M2) is the second Japanese expansion in the Pokémon TCG Mega Evolution series, released September 26, 2025. It is the Japanese source set for the English Phantasmal Flames (ME2).' },
      { q: 'What is the English equivalent of Inferno X?', a: 'Inferno X (M2) is the Japanese source for <a href="/pokemon/sets/mega-evolution/phantasmal-flames/cards" style="color:var(--accent);">Phantasmal Flames (ME2)</a>, which released in English in November 2025.' },
      { q: 'What is the top chase card in Inferno X?', a: 'The top chase card in Inferno X is Mega Charizard X ex in its Mega Hyper Rare (MHR) gold foil form — the highest rarity pull in the set and one of the most sought-after Japanese Pokémon TCG singles.' },
      { q: 'How many cards are in Inferno X?', a: 'Inferno X contains 116 cards in total — 84 main set cards plus 32 secret rares across Art Rare, Special Art Rare, and Mega Hyper Rare tiers.' },
      { q: 'Are Japanese Inferno X cards worth buying?', a: 'Japanese Inferno X cards are popular with collectors who want Mega Charizard X ex at a lower entry price than the English Phantasmal Flames version. The booster box offers 30 packs of 5 cards with strong pull rates for high-rarity cards.' },
      { q: 'Where can I buy Inferno X Japanese booster boxes?', a: 'Inferno X Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm2a_ja': {
    metaTitle: `MEGA Dream ex Card List (M2a): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete MEGA Dream ex (M2a) Japanese card list — all 250 High Class Pack cards with English translations, chase cards ranked by price, and live prices on TCG Watchtower.`,
    intro: `MEGA Dream ex (M2a) is the High Class Pack subset of the Japanese Pokémon TCG Mega Evolution series, released November 28, 2025. As the Japanese source for the English <a href="/pokemon/sets/mega-evolution/ascended-heroes/cards" style="color:var(--accent);">Ascended Heroes (ME2.5)</a>, MEGA Dream ex is a reprint-heavy premium set focused entirely on Mega Evolution Pokémon ex. Each booster pack contains 10 cards with a guaranteed Pokémon ex or Mega Evolution Pokémon ex, with Mega Dragonite ex SAR and Mega Gengar ex SAR as the top pulls. This complete MEGA Dream ex card list covers all 250 JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is MEGA Dream ex?', a: 'MEGA Dream ex (M2a) is the Japanese High Class Pack subset in the Pokémon TCG Mega Evolution series, released November 28, 2025. It is the Japanese source for the English Ascended Heroes (ME2.5).' },
      { q: 'What is the English equivalent of MEGA Dream ex?', a: 'MEGA Dream ex (M2a) is the Japanese source for <a href="/pokemon/sets/mega-evolution/ascended-heroes/cards" style="color:var(--accent);">Ascended Heroes (ME2.5)</a>, released in English in January 2026.' },
      { q: 'How is MEGA Dream ex different from other Mega Evolution sets?', a: 'MEGA Dream ex is a High Class Pack — each booster pack contains 10 cards vs 5 in standard sets, and each box contains only 10 packs. Every pack guarantees at least one Pokémon ex or Mega Evolution Pokémon ex, making pull rates significantly better than standard sets.' },
      { q: 'What are the top chase cards in MEGA Dream ex?', a: 'The top chase cards in MEGA Dream ex are Mega Dragonite ex SAR (#246), Mega Gengar ex SAR (#240), and Pikachu ex SIR (#234). The Mega Dragonite ex MUR (#250) is the single rarest pull in the set.' },
      { q: 'How many cards are in MEGA Dream ex?', a: 'MEGA Dream ex contains 250 cards in total — 193 main set cards plus 57 secret rares across Art Rare, Mega Attack Rare, Special Art Rare, and Mega Ultra Rare tiers.' },
      { q: 'Where can I buy MEGA Dream ex Japanese booster boxes?', a: 'MEGA Dream ex Japanese booster boxes are available on TCGplayer, Amazon, and eBay. Each box contains 10 packs of 10 cards. Check the Sealed Products section above for current prices.' },
    ],
  },
  'm3_ja': {
    metaTitle: `Nihil Zero Card List (M3): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Nihil Zero (M3) Japanese card list — JP cards with Mega Zygarde ex chase pulls, English translations, and live prices on TCG Watchtower.`,
    intro: `Nihil Zero (M3) is the third main set in the Japanese Pokémon TCG Mega Evolution series, released early 2026. Built around Mega Zygarde ex as its flagship card, Nihil Zero is the Japanese source for the English <a href="/pokemon/sets/mega-evolution/perfect-order/cards" style="color:var(--accent);">Perfect Order (ME3)</a>. This complete Nihil Zero card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Nihil Zero?', a: 'Nihil Zero (M3) is the third Japanese expansion in the Pokémon TCG Mega Evolution series. It is the Japanese source set for the English Perfect Order (ME3).' },
      { q: 'What is the English equivalent of Nihil Zero?', a: 'Nihil Zero (M3) is the Japanese source for <a href="/pokemon/sets/mega-evolution/perfect-order/cards" style="color:var(--accent);">Perfect Order (ME3)</a>, released in English in March 2026.' },
      { q: 'What is the top chase card in Nihil Zero?', a: 'The top chase card in Nihil Zero is Mega Zygarde ex in its Mega Ultra Rare (MUR) gold foil form — the apex pull of the set.' },
      { q: 'How many cards are in Nihil Zero?', a: 'Nihil Zero contains approximately 116 cards in total — 84 main set cards plus secret rares across Art Rare, Special Art Rare, and Mega Ultra Rare tiers.' },
      { q: 'Are Japanese Nihil Zero cards worth buying?', a: 'Japanese Nihil Zero cards are a strong buy for Mega Zygarde ex collectors who want JP versions at lower prices than the English Perfect Order equivalents. The booster box offers 30 packs of 5 cards.' },
      { q: 'Where can I buy Nihil Zero Japanese booster boxes?', a: 'Nihil Zero Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm4_ja': {
    metaTitle: `Ninja Spinner Card List (M4): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Ninja Spinner (M4) Japanese card list — 120 JP cards with Mega Greninja ex chase pulls, English translations, and live prices on TCG Watchtower.`,
    intro: `Ninja Spinner (M4) is the fourth main set in the Japanese Pokémon TCG Mega Evolution series, released March 13, 2026. Built around Mega Greninja ex as its flagship card, Ninja Spinner is the Japanese source for the English <a href="/pokemon/sets/mega-evolution/chaos-rising/cards" style="color:var(--accent);">Chaos Rising (ME4)</a>. The set contains 120 cards across Art Rare, Special Art Rare, and Mega Hyper Rare tiers with Mega Greninja ex MHR as the apex pull. This complete Ninja Spinner card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Ninja Spinner?', a: 'Ninja Spinner (M4) is the fourth Japanese expansion in the Pokémon TCG Mega Evolution series, released March 13, 2026. It is the Japanese source set for the English Chaos Rising (ME4).' },
      { q: 'What is the English equivalent of Ninja Spinner?', a: 'Ninja Spinner (M4) is the Japanese source for <a href="/pokemon/sets/mega-evolution/chaos-rising/cards" style="color:var(--accent);">Chaos Rising (ME4)</a>, which released in English in May 2026.' },
      { q: 'What is the top chase card in Ninja Spinner?', a: 'The top chase card in Ninja Spinner is Mega Greninja ex in its Mega Hyper Rare (MHR) form — one of the most popular Mega Evolution pulls in the series among competitive players and collectors.' },
      { q: 'How many cards are in Ninja Spinner?', a: 'Ninja Spinner contains 120 cards in total — 83 main set cards plus 37 secret rares across Art Rare, Special Art Rare, and Mega Hyper Rare tiers.' },
      { q: 'Are Japanese Ninja Spinner cards worth buying?', a: 'Japanese Ninja Spinner cards are popular with collectors chasing Mega Greninja ex at lower prices than the English Chaos Rising equivalents. The booster box offers 30 packs of 5 cards with competitive pull rates.' },
      { q: 'Where can I buy Ninja Spinner Japanese booster boxes?', a: 'Ninja Spinner Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards.' },
    ],
  },
  'm5_ja': {
    metaTitle: `Abyss Eye Card List (M5): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Abyss Eye (M5) Japanese card list — 118 JP cards with Mega Darkrai ex chase pulls, English translations, and live prices on TCG Watchtower.`,
    intro: `Abyss Eye (M5) is the fifth main set in the Japanese Pokémon TCG Mega Evolution series, released May 22, 2026. Built around Mega Darkrai ex as its flagship card, Abyss Eye is the Japanese source for the English <a href="/pokemon/sets/mega-evolution/pitch-black/cards" style="color:var(--accent);">Pitch Black (ME5)</a>. The set contains 118 cards with a dark, atmospheric lineup inspired by Pokémon Legends: Z-A, featuring Mega Darkrai ex SAR as the most sought-after pull. This complete Abyss Eye card list covers all JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Abyss Eye?', a: 'Abyss Eye (M5) is the fifth Japanese expansion in the Pokémon TCG Mega Evolution series, released May 22, 2026. It is the Japanese source set for the English Pitch Black (ME5).' },
      { q: 'What is the English equivalent of Abyss Eye?', a: 'Abyss Eye (M5) is the Japanese source for <a href="/pokemon/sets/mega-evolution/pitch-black/cards" style="color:var(--accent);">Pitch Black (ME5)</a>, which released in English in July 2026.' },
      { q: 'What is the top chase card in Abyss Eye?', a: 'The top chase cards in Abyss Eye are Mega Darkrai ex in its Special Art Rare and Mega Ultra Rare forms. The Mega Darkrai ex SAR features striking dark artwork that has made it one of the most popular JP singles in the Mega Evolution series.' },
      { q: 'How many cards are in Abyss Eye?', a: 'Abyss Eye contains 118 cards in total — 81 main set cards plus 37 secret rares across Art Rare, Special Art Rare, and Mega Ultra Rare tiers.' },
      { q: 'Are Japanese Abyss Eye cards worth buying?', a: 'Japanese Abyss Eye cards are a strong option for Mega Darkrai ex collectors, with JP versions typically priced lower than the English Pitch Black equivalents. The booster box offers 30 packs of 5 cards.' },
      { q: 'Where can I buy Abyss Eye Japanese booster boxes?', a: 'Abyss Eye Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards. Check the Sealed Products section above for current prices.' },
    ],
  },
  'sv1s_ja': {
    metaTitle: `Scarlet ex Card List (SV1S): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Scarlet ex (SV1S) Japanese card list — 108 JP cards with English translations, Gardevoir ex SAR chase pulls, and live prices on TCG Watchtower.`,
    intro: `Scarlet ex (SV1S) is the first Japanese expansion of the Scarlet & Violet era, released January 20, 2023 alongside its companion set <a href="/pokemon/sets/scarlet-violet-jp/violet-ex/cards" style="color:var(--accent);">Violet ex (SV1V)</a>. Together the two sets introduced the ex mechanic and Terastal forms to the modern Pokémon TCG. Scarlet ex contains 108 cards and is the Japanese source for the English <a href="/pokemon/sets/scarlet-violet/scarlet-violet-base-set/cards" style="color:var(--accent);">Scarlet & Violet Base Set (SV1)</a>. The top chase card is Gardevoir ex SAR (#101), one of the most iconic Special Art Rares of the generation. This complete Scarlet ex card list covers all 108 JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Scarlet ex?', a: 'Scarlet ex (SV1S) is the first Japanese expansion in the Pokémon TCG Scarlet & Violet era, released January 20, 2023 alongside Violet ex (SV1V). It is the Japanese source for the English Scarlet & Violet Base Set (SV1).' },
      { q: 'What is the English equivalent of Scarlet ex?', a: 'Scarlet ex (SV1S) is one of the two Japanese source sets for the English Scarlet & Violet Base Set (SV1). Browse the English card list and prices on TCG Watchtower.' },
      { q: 'What is the difference between Scarlet ex and Violet ex?', a: 'Scarlet ex features Koraidon ex and Gardevoir ex as key pulls, while Violet ex features Miraidon ex. They released simultaneously and together form the Japanese basis of the English Scarlet & Violet Base Set.' },
      { q: 'What is the top chase card in Scarlet ex?', a: 'The top chase card in Scarlet ex is Gardevoir ex SAR (#101/078) — one of the most popular Special Art Rares of the Scarlet & Violet era and consistently one of the most valuable JP singles from the set.' },
      { q: 'How many cards are in Scarlet ex?', a: 'Scarlet ex contains 108 cards in total — 78 main set cards plus 30 secret rares across Art Rare, Super Rare, Special Art Rare, and Ultra Rare tiers.' },
      { q: 'Where can I buy Scarlet ex Japanese booster boxes?', a: 'Scarlet ex Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards. Check the Sealed Products section above for current prices.' },
    ],
  },
  'sv1v_ja': {
    metaTitle: `Violet ex Card List (SV1V): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Violet ex (SV1V) Japanese card list — 108 JP cards with English translations, Miraidon ex SAR chase pulls, and live prices on TCG Watchtower.`,
    intro: `Violet ex (SV1V) is the companion set to <a href="/pokemon/sets/scarlet-violet-jp/scarlet-ex/cards" style="color:var(--accent);">Scarlet ex (SV1S)</a>, released simultaneously on January 20, 2023. Together the two sets launched the Scarlet & Violet era and are the Japanese source for the English <a href="/pokemon/sets/scarlet-violet/scarlet-violet-base-set/cards" style="color:var(--accent);">Scarlet & Violet Base Set (SV1)</a>. Violet ex contains 108 cards and is headlined by Miraidon ex SAR (#102) as its most coveted pull. This complete Violet ex card list covers all 108 JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Violet ex?', a: 'Violet ex (SV1V) is the second Japanese expansion in the Pokémon TCG Scarlet & Violet era, released January 20, 2023 alongside Scarlet ex (SV1S). It is the Japanese source for the English Scarlet & Violet Base Set (SV1).' },
      { q: 'What is the English equivalent of Violet ex?', a: 'Violet ex (SV1V) is one of the two Japanese source sets for the English Scarlet & Violet Base Set (SV1). Browse the English card list and prices on TCG Watchtower.' },
      { q: 'What is the top chase card in Violet ex?', a: 'The top chase card in Violet ex is Miraidon ex SAR (#102/078) — the box legendary of the Scarlet & Violet era and one of the most sought-after JP singles from the first generation of the era.' },
      { q: 'How many cards are in Violet ex?', a: 'Violet ex contains 108 cards in total — 78 main set cards plus 30 secret rares across Art Rare, Super Rare, Special Art Rare, and Ultra Rare tiers.' },
      { q: 'Are Japanese Violet ex cards worth buying?', a: 'Japanese Violet ex cards are popular with collectors targeting Miraidon ex and other Scarlet & Violet era chase cards at lower prices than their English counterparts. Each booster box contains 30 packs of 5 cards.' },
      { q: 'Where can I buy Violet ex Japanese booster boxes?', a: 'Violet ex Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards. Check the Sealed Products section above for current prices.' },
    ],
  },
  'sv1a_ja': {
    metaTitle: `Triplet Beat Card List (SV1a): Japanese Pokémon TCG Prices & Guide | TCG Watchtower`,
    metaDesc:  `Complete Triplet Beat (SV1a) Japanese card list — 103 JP cards with English translations, Meowscarada ex SAR chase pulls, and live prices on TCG Watchtower.`,
    intro: `Triplet Beat (SV1a) is the first subset of the Japanese Scarlet & Violet era, released March 10, 2023. The set is built around the three Paldean starter final evolutions — Meowscarada ex, Skeledirge ex, and Quaquaval ex — and is the Japanese source for the English <a href="/pokemon/sets/scarlet-violet/paldea-evolved/cards" style="color:var(--accent);">Paldea Evolved (SV2)</a>. Triplet Beat contains 103 cards with Meowscarada ex SAR (#096) as the top pull and the iconic Magikarp AR as one of the most beloved Art Rares of the era. This complete Triplet Beat card list covers all 103 JP cards with English name translations, rarity filters, and live prices on TCG Watchtower.`,
    faq: [
      { q: 'What is Triplet Beat?', a: 'Triplet Beat (SV1a) is the first Japanese subset of the Scarlet & Violet era, released March 10, 2023. It features the three Paldean starter final evolutions and is the Japanese source for the English Paldea Evolved (SV2).' },
      { q: 'What is the English equivalent of Triplet Beat?', a: 'Triplet Beat (SV1a) is the Japanese source for Paldea Evolved (SV2), which released in English on June 9, 2023. Browse the English card list and prices on TCG Watchtower.' },
      { q: 'What is the top chase card in Triplet Beat?', a: 'The top chase card in Triplet Beat is Meowscarada ex SAR (#096/073) — one of the most popular starter Pokémon SARs of the generation. The Magikarp AR (#080/073) is also a beloved and sought-after pull.' },
      { q: 'How many cards are in Triplet Beat?', a: 'Triplet Beat contains 103 cards in total — 73 main set cards plus 30 secret rares across Art Rare, Super Rare, Special Art Rare, and Ultra Rare tiers.' },
      { q: 'Are Japanese Triplet Beat cards worth buying?', a: 'Japanese Triplet Beat cards are popular with collectors targeting Meowscarada ex SAR and the starter trio at lower prices than their English Paldea Evolved equivalents. Each booster box contains 30 packs of 5 cards.' },
      { q: 'Where can I buy Triplet Beat Japanese booster boxes?', a: 'Triplet Beat Japanese booster boxes are available on TCGplayer, Amazon, and eBay from Japanese import sellers. Each box contains 30 packs of 5 cards. Check the Sealed Products section above for current prices.' },
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

// Dedicated JP pages don't need the "Japanese Set Preview" banner — strip it
// Dedicated JP pages don't need the "Japanese Set Preview" banner — strip it (runs after template is read below)

// ── Fill template ──────────────────────────────────────────────────────────────
let html = readFileSync('set-template.html', 'utf8');
const SET_PAGE_CSS = readFileSync('static/set-page.css', 'utf8').trim().replace(/\$/g, '$$$$');
const SET_PAGE_JS  = readFileSync('static/set-page.js',  'utf8').trim().replace(/\$/g, '$$$$');


// ── Per-set short description ─────────────────────────────────────────────────
const SET_DESCRIPTIONS = {
  'm1l_ja': `Browse the complete Mega Brave card list — 92 JP cards with English name translations, live prices on TCG Watchtower, and a buying guide for the Japanese Mega Evolution series.`,
  'm1s_ja': `Browse the complete Mega Symphonia card list — 92 JP cards with English name translations, live prices on TCG Watchtower, and a buying guide for the Japanese Mega Evolution series.`,
  'm2_ja':  `Browse the complete Inferno X card list — 116 JP cards headlined by Mega Charizard X ex, with English translations, live prices, and sealed product guide on TCG Watchtower.`,
  'm2a_ja': `Browse the complete MEGA Dream ex card list — all 250 JP High Class Pack cards with English translations, live prices, and where to buy booster boxes on TCG Watchtower.`,
  'm3_ja':  `Browse the complete Nihil Zero card list — JP cards headlined by Mega Zygarde ex, with English translations, live prices, and sealed product guide on TCG Watchtower.`,
  'm4_ja':  `Browse the complete Ninja Spinner card list — 120 JP cards headlined by Mega Greninja ex, with English translations, live prices, and sealed product guide on TCG Watchtower.`,
  'm5_ja':  `Browse the complete Abyss Eye card list — 118 JP cards headlined by Mega Darkrai ex, with English translations, live prices, and sealed product guide on TCG Watchtower.`,
};
const SET_DESCRIPTION_TEXT = SET_DESCRIPTIONS[SET_ID] || `Browse the complete ${SET_FULL_NAME} card list — Japanese Pokémon TCG cards with English translations, live prices, and sealed product guide.`;

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
  '{{SET_DESCRIPTION}}':       SET_DESCRIPTION_TEXT,
  '{{SET_OFFICIAL_COUNT}}':    String(officialCount),
  '{{SET_SEARCH_NAME}}':       SET_SEARCH_NAME,
  '{{SET_TCGP_SLUG}}':         SET_TCGP_SLUG,
  '{{TCGP_GROUP_ID}}':         setConfig.tcgpGroupId || '0',
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
// Dedicated JP pages strip the JP preview banner — it's designed for EN pages showing JP cards
html = html.replace(/\{\{#IF_JP_PHASE\}\}[\s\S]*?\{\{\/IF_JP_PHASE\}\}/g, '');

// Inject const PRODUCT_META right before renderProductCard in the JS section.
// We cannot use the /* ===== PRODUCTS ===== */ comment as anchor because it
// exists in BOTH set-page.css and set-page.js — replacing it puts PRODUCT_META
// inside <style> where the browser ignores it. renderProductCard only exists
// once, in the JS section, making it a safe unique anchor.
html = html.replace(
  'function renderProductCard(',
  'const PRODUCT_META = ' + productMetaJson + ';\n\nfunction renderProductCard('
);
// ── Replace stat cards to match EN page structure ─────────────────────────────
const secretRares  = officialCount && printedTotal && officialCount > printedTotal ? officialCount - printedTotal : 0;
const releaseMonth = setConfig.releaseDate
  ? new Date(setConfig.releaseDate).toLocaleString('en-US', { month: 'short' })
  : '???';
const releaseYear  = setConfig.releaseDate
  ? new Date(setConfig.releaseDate).getFullYear()
  : '';

const jpLogoUrl = jpLogoR2Url || setData.logo || null;

const jpStatCards = `<div class="set-stats">
          ${jpLogoUrl ? `<div class="stat-card stat-card-logo">
            <img id="set-logo-hero" src="${jpLogoUrl}" alt="${SET_FULL_NAME} Logo" width="150" height="60" style="width: 100%; max-width: 150px; height: auto; object-fit: contain;" onerror="this.closest('.stat-card-logo').style.display='none'">
            <div class="stat-label">${SET_SHORT_NAME}</div>
          </div>` : ''}
          <div class="stat-card">
            <div class="stat-value">${printedTotal || officialCount || '—'}</div>
            <div class="stat-label">Main Set</div>
          </div>
          ${secretRares > 0 ? `<div class="stat-card">
            <div class="stat-value" style="color:#fbbf24;">${secretRares}</div>
            <div class="stat-label">Secret Rares</div>
          </div>` : ''}
          <div class="stat-card">
            <div class="stat-value">${releaseMonth}</div>
            <div class="stat-label">${releaseYear}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${setConfig.packsPerBox || 30}</div>
            <div class="stat-label">${setConfig.isHighClassPack ? 'Packs / Box' : 'Packs / Box'}</div>
          </div>
        </div>`;

html = html.replace(/(<div class="set-stats">)[\s\S]*?(<\/div>\s*<\/div>\s*<div class="hero-visual">)/, jpStatCards + '\n      </div>\n      <div class="hero-visual">');

const enEquivalent = setConfig.enEquivalent || SET_ID;
const scrydexJpPatch = `
<script>
  // Register Scrydex JP ID for client-side price/card fetching
  if (window.SCRYDEX_JP_ID_MAP) {
    window.SCRYDEX_JP_ID_MAP[${JSON.stringify(SET_ID)}] = ${JSON.stringify(SCRYDEX_ID)};
  } else {
    window.SCRYDEX_JP_ID_MAP = { ${JSON.stringify(SET_ID)}: ${JSON.stringify(SCRYDEX_ID)} };
  }

  // Override cardImg for JP sets to use Scrydex CDN — must run before set-page.js uses it
  (function() {
    var style = document.createElement('style');
    style.textContent = '.set-stats { display: grid !important; grid-template-columns: repeat(5, 1fr) !important; gap: 12px !important; } .stat-card { min-width: 0 !important; }';
    document.head.appendChild(style);
  })();
  (function() {
    var _orig = window.cardImg;
    window.cardImg = function(setId, localId) {
      if (setId && setId.indexOf('_ja') !== -1) {
        var id = parseInt(localId, 10) || 1;
        return 'https://images.scrydex.com/pokemon/' + setId + '-' + id + '/medium';
      }
      return _orig ? _orig(setId, localId) : '';
    };
  })();

  // Override fetch to serve JP sets when sets.json is requested on JP pages
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/sets.json')) {
      return _origFetch('/sets-jp.json', opts).then(function(res) {
        if (!res.ok) return _origFetch(url, opts);
        return res.json().then(function(jpSets) {
          var mapped = jpSets.filter(function(s) { return s.live; }).map(function(s) {
            return Object.assign({}, s, {
              slug: 'pokemon/sets/mega-evolution-jp/' + s.slug + '/cards',
              series: 'Mega Evolution JP',
            });
          });
          var blob = new Blob([JSON.stringify(mapped)], {type: 'application/json'});
          return new Response(blob, {status: 200, headers: {'Content-Type': 'application/json'}});
        });
      });
    }
    return _origFetch.apply(this, arguments);
  };
  // For SV JP sets, fetch hero images from API (Scrydex CDN requires auth)
  var heroImgs = document.querySelectorAll('#hero-stack img[data-set]');
  if (heroImgs.length) {
    var setIdForHero = heroImgs[0].dataset.set;
    if (setIdForHero && setIdForHero.indexOf('_ja') !== -1) {
      fetch('/api/cards?set=' + setIdForHero)
        .then(function(r) { return r.json(); })
        .then(function(d) {
          var cards = d.cards || [];
          var byId = {};
          cards.forEach(function(c) { byId[String(c.localId).replace(/^0+/,'')] = c; });
          heroImgs.forEach(function(img) {
            var id = String(img.dataset.id || '').replace(/^0+/,'');
            var card = byId[id];
            if (card && card.image) img.src = card.image;
          });
        }).catch(function() {});
    } else {
      heroImgs.forEach(function(img) {
        img.src = window.cardImg(img.dataset.set, img.dataset.id);
      });
    }
  }

  // Filter buttons: hide EN-only product types not in JP sets
  var jpValidFilters = ['all', 'box', 'pack', 'ptb'];
  document.querySelectorAll('#product-filters .filter-btn').forEach(function(btn) {
    var filter = btn.dataset.filter;
    if (filter && !jpValidFilters.includes(filter)) {
      btn.style.display = 'none';
    }
  });

  // Sealed products section header: update to JP-appropriate copy
  var sealedTitle = document.querySelector('#section-products h2');
  if (sealedTitle && sealedTitle.textContent.includes('ETBS')) {
    sealedTitle.innerHTML = sealedTitle.innerHTML.replace('BOOSTER BOXES &amp; ETBS', 'BOOSTER BOXES &amp; PACKS');
  }
</script>`;
// Inject JP patch right before </body> so it runs after set-page.js defines cardImg
html = html.replace('</body>', scrydexJpPatch + '\n</body>');

// Add EN equivalent link in <head> for SEO cross-referencing
const enPageUrl = setConfig.enSlug
  ? `https://tcgwatchtower.com/pokemon/sets/mega-evolution/${setConfig.enSlug}/cards`
  : `https://tcgwatchtower.com/pokemon/sets/mega-evolution/${EN_SET_ID}/cards`;
const enLinkTag = `<link rel="alternate" hreflang="en" href="${enPageUrl}">\n<link rel="alternate" hreflang="ja-x-jp" href="https://tcgwatchtower.com/${SET_SEO_PATH}">`;
html = html.replace('</head>', enLinkTag + '\n</head>');

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

// ── Upload card data JSON to R2 for SEO table ──────────────────────────────────
if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID && process.env.CF_R2_ENDPOINT && R2_PUBLIC_URL) {
  try {
    const r2 = new S3Client({
      region: 'auto',
      endpoint: process.env.CF_R2_ENDPOINT,
      credentials: { accessKeyId: process.env.CF_R2_ACCESS_KEY, secretAccessKey: process.env.CF_R2_SECRET_KEY },
    });
    const dataKey = `data/${SET_ID}.json`;
    // Check if already uploaded
    let dataExists = false;
    try {
      await r2.send(new HeadObjectCommand({ Bucket: process.env.CF_R2_BUCKET, Key: dataKey }));
      dataExists = true;
      console.log(`✅  Card data already in R2: ${dataKey}`);
    } catch {}

    if (!dataExists) {
      console.log(`\n📋 Fetching all JP cards from Scrydex for R2 data upload...`);
      let allJpCards = [];
      let page = 1;
      while (true) {
        const res = await fetch(
          `https://api.scrydex.com/pokemon/v1/ja/expansions/${SCRYDEX_ID}/cards?select=id,name,translation,rarity&pageSize=100&page=${page}`,
          { headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID } }
        );
        if (!res.ok) break;
        const data = await res.json();
        const cards = data.data || [];
        allJpCards = allJpCards.concat(cards.map(c => {
          const rawId = c.id ? c.id.split('-').slice(1).join('-') : '';
          const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
          return {
            localId: String(localId).padStart(3, '0'),
            name: c.translation?.en?.name || c.name || '',
            nameJP: c.name || '',
            rarity: c.translation?.en?.rarity || c.rarity || '',
          };
        }));
        if (cards.length < 100) break;
        page++;
      }
      if (allJpCards.length > 0) {
        const jsonData = JSON.stringify({ cards: allJpCards, setId: SET_ID, total: allJpCards.length });
        await r2.send(new PutObjectCommand({
          Bucket: process.env.CF_R2_BUCKET,
          Key: dataKey,
          Body: jsonData,
          ContentType: 'application/json',
          CacheControl: 'public, max-age=86400',
        }));
        console.log(`✅  Uploaded ${allJpCards.length} cards to R2: ${dataKey}`);
      }
    }
  } catch (dataErr) {
    console.warn(`⚠️  Card data R2 upload failed: ${dataErr.message}`);
  }
}

// ── Inject static SEO card table ───────────────────────────────────────────────
// Uses JP set ID namespaced under ja: prefix in R2
try {
  const metaUrl = `${R2_PUBLIC_URL}/data/${SET_ID}.json`;
  console.log(`\n📋 Fetching card metadata for SEO table from ${metaUrl}...`);
  const metaRes = await fetch(metaUrl);
  if (metaRes.ok) {
    const contentType = metaRes.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(`⚠️  SEO table: unexpected content-type (${contentType}) — skipping`);
    } else {
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
