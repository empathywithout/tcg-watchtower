// scripts/generate-set-page.js
// Generates a set guide HTML page from the template
// Called automatically by the GitHub Action after image sync
// Can also be run manually: SET_ID=sv02 SET_NAME="Paldea Evolved" ... node scripts/generate-set-page.js

import { readFileSync, writeFileSync } from 'fs';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── Inputs ────────────────────────────────────────────────────────────────────
const SET_ID            = process.env.SET_ID;            // e.g. sv02
const SET_SLUG          = process.env.SET_SLUG || `${process.env.SET_ID}-set-guide`;
const SET_FULL_NAME     = process.env.SET_FULL_NAME;     // e.g. Paldea Evolved (SV2)
const SET_SERIES        = process.env.SET_SERIES;        // e.g. Scarlet & Violet
const SET_SUBTITLE      = process.env.SET_SUBTITLE;      // e.g. Paldea Evolved
const SET_SHORT_NAME    = process.env.SET_SHORT_NAME;    // e.g. SV2
const SET_RELEASE_DATE  = process.env.SET_RELEASE_DATE;  // e.g. Jun 2023
const SET_DESCRIPTION   = process.env.SET_DESCRIPTION;   // 2-3 sentence description
const HERO_CARD_1       = process.env.HERO_CARD_1 || '001'; // localId of hero card 1
const HERO_CARD_2       = process.env.HERO_CARD_2 || '002';
const HERO_CARD_3       = process.env.HERO_CARD_3 || '003';
const HERO_ALT_1        = process.env.HERO_ALT_1  || 'Card 1';
const HERO_ALT_2        = process.env.HERO_ALT_2  || 'Card 2';
const HERO_ALT_3        = process.env.HERO_ALT_3  || 'Card 3';

if (!SET_ID || !SET_FULL_NAME) {
  console.error('❌ SET_ID and SET_FULL_NAME are required');
  process.exit(1);
}

// ── Fetch set metadata from TCGdex to get official card count + release date ─
console.log(`📋 Fetching set metadata for ${SET_ID}...`);
const tcgRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${SET_ID}`);
if (!tcgRes.ok) {
  console.error(`❌ TCGdex ${tcgRes.status} for set ${SET_ID}`);
  process.exit(1);
}
const setData = await tcgRes.json();
const officialCount = setData.cardCount?.official || setData.cards?.length || '???';
const releaseDate   = SET_RELEASE_DATE || (setData.releaseDate
  ? new Date(setData.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  : '???');

console.log(`✅ ${setData.name} — ${officialCount} official cards, released ${releaseDate}`);

// ── Fill in template ──────────────────────────────────────────────────────────
let html = readFileSync('set-template.html', 'utf8');

const vars = {
  '{{SET_ID}}':             SET_ID,
  '__R2_PUBLIC_URL__':      process.env.CF_R2_PUBLIC_URL || '',
  '{{SET_FULL_NAME}}':      SET_FULL_NAME,
  '{{SET_SERIES}}':         SET_SERIES        || 'Scarlet & Violet',
  '{{SET_SUBTITLE}}':       SET_SUBTITLE      || setData.name,
  '{{SET_SHORT_NAME}}':     SET_SHORT_NAME    || SET_ID.toUpperCase(),
  '{{SET_RELEASE_DATE}}':   releaseDate,
  '{{SET_DESCRIPTION}}':    SET_DESCRIPTION   || `Complete guide to ${SET_FULL_NAME} — including the full card list, chase cards, and where to buy sealed product.`,
  '{{SET_OFFICIAL_COUNT}}': String(officialCount),
  '{{HERO_CARD_1}}':        HERO_CARD_1,
  '{{HERO_CARD_2}}':        HERO_CARD_2,
  '{{HERO_CARD_3}}':        HERO_CARD_3,
  '{{HERO_ALT_1}}':         HERO_ALT_1,
  '{{HERO_ALT_2}}':         HERO_ALT_2,
  '{{HERO_ALT_3}}':         HERO_ALT_3,
};

for (const [placeholder, value] of Object.entries(vars)) {
  html = html.replaceAll(placeholder, value);
}

// ── Write output file ─────────────────────────────────────────────────────────
const outFile = `${SET_SLUG}.html`;
writeFileSync(outFile, html);
console.log(`✅ Generated ${outFile}`);

// ── Also upload to R2 so it's backed up ──────────────────────────────────────
if (process.env.CF_R2_ENDPOINT) {
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.CF_R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY,
      secretAccessKey: process.env.CF_R2_SECRET_KEY,
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET,
    Key: `pages/${outFile}`,
    Body: html,
    ContentType: 'text/html',
  }));
  console.log(`✅ Backed up to R2 at pages/${outFile}`);
}


// ── Update sets.json ─────────────────────────────────────────────────────────
import { readFileSync as readFS2, writeFileSync as writeFS2, existsSync as existsFS2 } from 'fs';

const setsPath = 'sets.json';
const existingSets = existsFS2(setsPath) ? JSON.parse(readFS2(setsPath, 'utf8')) : [];

const alreadyExists = existingSets.find(s => s.slug === SET_SLUG);
if (alreadyExists) {
  // Mark as live if it wasn't already
  if (!alreadyExists.live) {
    alreadyExists.live = true;
    writeFS2(setsPath, JSON.stringify(existingSets, null, 2));
    console.log(`\n📋 Marked ${SET_SLUG} as live in sets.json`);
  } else {
    console.log(`\n📋 ${SET_SLUG} already in sets.json`);
  }
} else {
  existingSets.push({
    slug: SET_SLUG,
    name: SET_FULL_NAME,
    series: SET_SERIES || 'Scarlet & Violet',
    short: SET_SHORT_NAME || SET_ID.toUpperCase(),
    live: true
  });
  writeFS2(setsPath, JSON.stringify(existingSets, null, 2));
  console.log(`\n📋 Added ${SET_SLUG} to sets.json`);
}
console.log(`\n🎉 Done! Add ${outFile} to your repo and it will auto-deploy on Vercel.`);

// ── Update sitemap.xml ────────────────────────────────────────────────────────
import { readFileSync as readFS, writeFileSync as writeFS, existsSync } from 'fs';

const SITE_URL = 'https://tcgwatchtower.com';
const sitemapPath = 'sitemap.xml';
const newUrl = `${SITE_URL}/${SET_ID}-set-guide`;

let sitemap = existsSync(sitemapPath) ? readFS(sitemapPath, 'utf8') : '';

if (sitemap.includes(newUrl)) {
  console.log(`\n📍 Sitemap already contains ${newUrl}`);
} else {
  const newEntry = `  <url>\n    <loc>${newUrl}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
  sitemap = sitemap.replace('</urlset>', `${newEntry}\n</urlset>`);
  writeFS(sitemapPath, sitemap);
  console.log(`\n📍 Added ${newUrl} to sitemap.xml`);
}
