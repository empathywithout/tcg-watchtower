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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ── Inputs ─────────────────────────────────────────────────────────────────────
const SET_ID           = process.env.SET_ID;
const SET_FULL_NAME    = process.env.SET_FULL_NAME;
const SET_SLUG         = process.env.SET_SLUG || `${SET_ID}-card-list`;
const SET_SERIES       = process.env.SET_SERIES || 'Scarlet & Violet';
const SET_SHORT_NAME   = process.env.SET_SHORT_NAME || SET_ID?.toUpperCase();
const SET_RELEASE_DATE = process.env.SET_RELEASE_DATE || null;
const SET_DESCRIPTION  = process.env.SET_DESCRIPTION  || null;
const HERO_CARD_1      = process.env.HERO_CARD_1 || '001';
const HERO_CARD_2      = process.env.HERO_CARD_2 || '002';
const HERO_CARD_3      = process.env.HERO_CARD_3 || '003';
const HERO_ALT_1       = process.env.HERO_ALT_1  || 'Card 1';
const HERO_ALT_2       = process.env.HERO_ALT_2  || 'Card 2';
const HERO_ALT_3       = process.env.HERO_ALT_3  || 'Card 3';

if (!SET_ID || !SET_FULL_NAME) {
  console.error('❌  SET_ID and SET_FULL_NAME are required');
  process.exit(1);
}

// ── Fetch set metadata from TCGdex ──────────────────────────────────────────────
console.log(`📋 Fetching set metadata for ${SET_ID}…`);
const tcgRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${SET_ID}`);
if (!tcgRes.ok) {
  console.error(`❌  TCGdex ${tcgRes.status} for set ${SET_ID}`);
  process.exit(1);
}
const setData = await tcgRes.json();
const officialCount = setData.cardCount?.official || setData.cards?.length || 0;
const releaseDate   = SET_RELEASE_DATE
  || (setData.releaseDate
      ? new Date(setData.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : '???');

// SET_SUBTITLE: the short display name shown in the big hero heading
const SET_SUBTITLE = process.env.SET_SUBTITLE || setData.name || SET_FULL_NAME;

// SET_SEARCH_NAME: appended to card names when building eBay/Amazon search queries
// e.g. "Paldea Evolved" → queries like "Mewtwo 193 Paldea Evolved"
const SET_SEARCH_NAME = process.env.SET_SEARCH_NAME || SET_SUBTITLE;

// SET_TCGP_SLUG: used in TCGplayer search URLs
// e.g. "paldea-evolved" → https://www.tcgplayer.com/search/pokemon/paldea-evolved
const SET_TCGP_SLUG = process.env.SET_TCGP_SLUG
  || SET_SUBTITLE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log(`✅  ${setData.name} — ${officialCount} official cards, released ${releaseDate}`);
console.log(`    subtitle="${SET_SUBTITLE}", search="${SET_SEARCH_NAME}", tcgp="${SET_TCGP_SLUG}"`);

// ── PRODUCT_META: per-set sealed product definitions ───────────────────────────
// Pass as a JSON string via env var. Keys are Amazon ASINs.
// Example:
//   PRODUCT_META_JSON='{"B0CF7YNQ7T":{"type":"Booster Box","filterKey":"box","badgeClass":"badge-box","name":"Paldea Evolved Booster Box","q":"Pokemon Paldea Evolved Booster Box"}}'
let productMetaJson = process.env.PRODUCT_META_JSON || '{}';
try { JSON.parse(productMetaJson); } catch(e) {
  console.warn('⚠️  PRODUCT_META_JSON is not valid JSON — using empty object');
  productMetaJson = '{}';
}

// ── CHASE_CARDS: optional hardcoded fallback shown before cards load ───────────
// If omitted, chase section starts empty and auto-populates from rarity on page load.
// Example:
//   CHASE_CARDS_JSON='[{"id":"215","name":"Charizard ex","rarity":"Hyper Rare","rarityClass":"rarity-hr","label":"HR","searchName":"Charizard ex 215 Obsidian Flames"}]'
let chaseCardsJson = process.env.CHASE_CARDS_JSON || '[]';
try { JSON.parse(chaseCardsJson); } catch(e) {
  console.warn('⚠️  CHASE_CARDS_JSON is not valid JSON — using empty array');
  chaseCardsJson = '[]';
}

// ── Fill template ──────────────────────────────────────────────────────────────
let html = readFileSync('set-template.html', 'utf8');

const vars = {
  '{{SET_ID}}':             SET_ID,
  '__R2_PUBLIC_URL__':      process.env.CF_R2_PUBLIC_URL || '',
  '{{SET_FULL_NAME}}':      SET_FULL_NAME,
  '{{SET_SERIES}}':         SET_SERIES,
  '{{SET_SUBTITLE}}':       SET_SUBTITLE,
  '{{SET_SHORT_NAME}}':     SET_SHORT_NAME,
  '{{SET_RELEASE_DATE}}':   releaseDate,
  '{{SET_DESCRIPTION}}':    SET_DESCRIPTION || `Complete guide to ${SET_FULL_NAME} — full card list, chase cards ranked by market price, and where to buy sealed product.`,
  '{{SET_OFFICIAL_COUNT}}': String(officialCount),
  '{{SET_SEARCH_NAME}}':    SET_SEARCH_NAME,
  '{{SET_TCGP_SLUG}}':      SET_TCGP_SLUG,
  '{{SET_SLUG}}':           SET_SLUG,
  '{{HERO_CARD_1}}':        HERO_CARD_1,
  '{{HERO_CARD_2}}':        HERO_CARD_2,
  '{{HERO_CARD_3}}':        HERO_CARD_3,
  '{{HERO_ALT_1}}':         HERO_ALT_1,
  '{{HERO_ALT_2}}':         HERO_ALT_2,
  '{{HERO_ALT_3}}':         HERO_ALT_3,
  '{{PRODUCT_META_JSON}}':  productMetaJson,
  '{{CHASE_CARDS_JSON}}':   chaseCardsJson,
};

for (const [placeholder, value] of Object.entries(vars)) {
  html = html.replaceAll(placeholder, value);
}

// Warn if any placeholders remain unreplaced
const remaining = [...html.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m => m[0]);
if (remaining.length) {
  console.warn(`⚠️  Unreplaced placeholders: ${[...new Set(remaining)].join(', ')}`);
}

// ── Write output file ──────────────────────────────────────────────────────────
const outFile = `${SET_SLUG}.html`;
writeFileSync(outFile, html);
console.log(`\n✅  Generated ${outFile}`);

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
const setsPath = 'sets.json';
const existingSets = existsSync(setsPath) ? JSON.parse(readFileSync(setsPath, 'utf8')) : [];

const existing = existingSets.find(s => s.slug === SET_SLUG);
if (existing) {
  existing.live   = true;
  existing.name   = SET_FULL_NAME;
  existing.series = SET_SERIES;
  existing.short  = SET_SHORT_NAME;
  existing.setId  = SET_ID;           // ← needed for logo images in nav
  writeFileSync(setsPath, JSON.stringify(existingSets, null, 2));
  console.log(`\n📋 Updated ${SET_SLUG} in sets.json`);
} else {
  existingSets.push({
    slug:   SET_SLUG,
    name:   SET_FULL_NAME,
    series: SET_SERIES,
    short:  SET_SHORT_NAME,
    setId:  SET_ID,
    live:   true,
  });
  writeFileSync(setsPath, JSON.stringify(existingSets, null, 2));
  console.log(`\n📋 Added ${SET_SLUG} to sets.json`);
}

// ── Update sitemap.xml ─────────────────────────────────────────────────────────
const SITE_URL    = 'https://tcgwatchtower.com';
const sitemapPath = 'sitemap.xml';
const newUrl      = `${SITE_URL}/${SET_SLUG}`;

let sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
if (sitemap.includes(newUrl)) {
  console.log(`\n📍 Sitemap already contains ${newUrl}`);
} else {
  const newEntry = `  <url>\n    <loc>${newUrl}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
  sitemap = sitemap.replace('</urlset>', `${newEntry}\n</urlset>`);
  writeFileSync(sitemapPath, sitemap);
  console.log(`\n📍 Added ${newUrl} to sitemap.xml`);
}

console.log(`\n🎉 Done! Deploy ${outFile} — it will be live at ${newUrl}`);
console.log(`\n── Quick reference for common sets ──────────────────────────────────────────`);
console.log(`# Obsidian Flames (SV3)`);
console.log(`SET_ID=sv03 SET_FULL_NAME="Obsidian Flames (SV3)" SET_SHORT_NAME=SV3 \\`);
console.log(`  SET_SUBTITLE="Obsidian Flames" HERO_CARD_1=215 HERO_CARD_2=230 HERO_CARD_3=197 \\`);
console.log(`  node scripts/generate-set-page.js`);
console.log(``);
console.log(`# Paradox Rift (SV4)`);
console.log(`SET_ID=sv04 SET_FULL_NAME="Paradox Rift (SV4)" SET_SHORT_NAME=SV4 \\`);
console.log(`  SET_SUBTITLE="Paradox Rift" HERO_CARD_1=182 HERO_CARD_2=245 HERO_CARD_3=197 \\`);
console.log(`  node scripts/generate-set-page.js`);
