// scripts/sync-images.js
// Downloads card images + full card metadata for a set, uploads everything to Cloudflare R2
// After this runs: images at /cards/{setId}/{localId}.webp  (resized to 400×557px for perf)
//                  metadata at /data/{setId}.json

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const SET_ID      = (process.env.SET_ID || '').trim();
const FORCE_RESYNC = (process.env.FORCE_RESYNC || '').trim().toLowerCase() === 'true';
if (!SET_ID) { console.error("❌ SET_ID required"); process.exit(1); }

// Card display dimensions on the page: 200×279px (card list), 200×279px (chase cards)
// We store at 2× for retina: 400×557px
const CARD_WIDTH  = 400;
const CARD_HEIGHT = 557;

// TCGdex uses dot-notation IDs internally (sv03.5, me02.5) but our workflow uses
// pt-notation (sv3pt5, me02pt5) to avoid shell/env var issues with dots
const TCGDEX_ID_MAP = {
  'sv3pt5':  'sv03.5',
  'sv4pt5':  'sv04.5',
  'sv6pt5':  'sv06.5',
  'sv8pt5':  'sv08.5',
  'me02pt5': 'me02.5',   // ← fix: was missing, caused 404 for Ascended Heroes
};
const TCGDEX_SET_ID_RESOLVED = TCGDEX_ID_MAP[SET_ID] || SET_ID;
const TCGDEX_SET_OVERVIEW_ID = TCGDEX_SET_ID_RESOLVED;
const TCGDEX_CARD_ID_PREFIX  = TCGDEX_SET_ID_RESOLVED;
const TCGDEX_ASSET_ID        = TCGDEX_SET_ID_RESOLVED;

// Derive series prefix from set ID (e.g. 'sv01' -> 'sv', 'me01' -> 'me')
const TCGDEX_SERIES_PREFIX = TCGDEX_SET_ID_RESOLVED
  .replace(/[^a-z]/gi, '')
  .toLowerCase()
  .replace(/\d.*$/, '') || 'sv';

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});
const BUCKET = process.env.CF_R2_BUCKET;

async function existsInR2(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function uploadToR2(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "TCGWatchtower/1.0" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(timeout); }
}

async function resizeCardImage(buffer) {
  // fit: "contain" preserves aspect ratio and pads with transparent background
  // rather than stretching to fill — fixes hero card stretching on the page
  return sharp(buffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent padding
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();
}

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n🚀 Starting sync for set: ${SET_ID}`);
  console.log(`    TCGdex ID: ${TCGDEX_SET_ID_RESOLVED}`);
  if (FORCE_RESYNC) console.log(`    ⚠️  Force resync enabled — all images will be re-downloaded and re-uploaded`);
  console.log('');

  // Step 1 — Fetch set overview (card list with localIds)
  console.log(`📋 Fetching set overview...`);
  const setData = await fetchWithRetry(`https://api.tcgdex.net/v2/en/sets/${TCGDEX_SET_OVERVIEW_ID}`);
  const briefCards = setData.cards || [];
  const totalOfficial = setData.cardCount?.official || briefCards.length;
  const totalCards = setData.cardCount?.total || briefCards.length;

  console.log(`✅ Set: ${setData.name} — ${briefCards.length} cards (${totalOfficial} official / ${totalCards} total incl. secrets)\n`);

  // Step 2 — Fetch full card details for each card (needed for rarity)
  console.log(`🔍 Fetching full card details for rarity data...`);
  const fullCards = [];
  for (let i = 0; i < briefCards.length; i++) {
    const brief = briefCards[i];
    process.stdout.write(`[${i + 1}/${briefCards.length}] ${brief.name}... `);
    try {
      const cardId = brief.id || `${TCGDEX_CARD_ID_PREFIX}-${brief.localId}`;
      const card = await fetchWithRetry(`https://api.tcgdex.net/v2/en/cards/${cardId}`);
      fullCards.push({
        localId: brief.localId,
        name: card.name,
        rarity: card.rarity || null,
        image: brief.image ? `${brief.image}/high.webp` : null,
      });
      console.log(`✅ (${card.rarity || 'no rarity'})`);
    } catch (err) {
      console.log(`⚠️  metadata failed: ${err.message}`);
      fullCards.push({
        localId: brief.localId,
        name: brief.name,
        rarity: null,
        image: brief.image ? `${brief.image}/high.webp` : null,
      });
    }
    await sleep(100);
  }

  // Step 3 — Download and upload set logo
  console.log(`\n🎨 Uploading set logo to R2...`);
  const logoR2Key = `logos/${SET_ID}.png`;
  const logoBase = setData.logo || `https://assets.tcgdex.net/en/${TCGDEX_SERIES_PREFIX}/${TCGDEX_ASSET_ID}/logo`;
  const logoUrl = logoBase.replace(/\.png$|\.webp$|\.jpg$/, '') + '.png';
  const strippedId = TCGDEX_ASSET_ID.replace(/^([a-z]+)0(\d)$/, '$1$2');
  const logoUrlAlt = `https://assets.tcgdex.net/en/${TCGDEX_SERIES_PREFIX}/${strippedId}/logo.png`;
  const urlsToTry = [logoUrl, logoUrlAlt].filter(Boolean);
  console.log(`  🔗 Trying logo URLs: ${urlsToTry.join(', ')}`);
  let logoUploaded = false;
  for (const url of urlsToTry) {
    try {
      const logoBuffer = await downloadImage(url);
      await uploadToR2(logoR2Key, logoBuffer, "image/png");
      console.log(`✅ Logo uploaded to R2 at logos/${SET_ID}.png (from ${url})`);
      logoUploaded = true;
      break;
    } catch (err) {
      console.log(`  ⚠️  Logo failed at ${url}: ${err.message}`);
    }
  }
  if (!logoUploaded) console.log(`⚠️  Logo upload failed for ${SET_ID} — will use fallback`);

  // Step 4 — Build and upload the JSON metadata file to R2
  console.log(`\n📦 Uploading metadata JSON to R2...`);
  const metadata = {
    id: SET_ID,
    name: setData.name,
    releaseDate: setData.releaseDate || null,
    cardCount: { official: totalOfficial, total: totalCards },
    cards: fullCards,
  };
  await uploadToR2(
    `data/${SET_ID}.json`,
    JSON.stringify(metadata),
    "application/json"
  );
  console.log(`✅ Metadata saved to R2 at data/${SET_ID}.json`);

  // Step 5 — Download, resize, and upload card images
  console.log(`\n🖼️  Uploading card images to R2 (resized to ${CARD_WIDTH}×${CARD_HEIGHT}px)...`);
  let uploaded = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < briefCards.length; i++) {
    const card = briefCards[i];
    const localId = card.localId;
    const r2Key = `cards/${SET_ID}/${localId}.webp`;
    const imageUrl = card.image ? `${card.image}/high.webp` : null;

    if (!imageUrl) { skipped++; continue; }
    process.stdout.write(`[${i + 1}/${briefCards.length}] #${localId}... `);

    if (!FORCE_RESYNC && await existsInR2(r2Key)) { console.log(`⏭️  exists`); skipped++; continue; }
    if (FORCE_RESYNC) process.stdout.write(`🔄 force... `);

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const original = await downloadImage(imageUrl);
        const resized  = await resizeCardImage(original);
        await uploadToR2(r2Key, resized, "image/webp");
        console.log(`✅ (resized)`); uploaded++; success = true; break;
      } catch (err) {
        if (attempt < 3) { process.stdout.write(`⚠️  retry... `); await sleep(2000 * attempt); }
        else { console.log(`❌ ${err.message}`); failures.push(localId); failed++; }
      }
    }
    if (success) await sleep(150);
  }

  console.log(`\n📊 Done! ${SET_ID}: ✅ ${uploaded} uploaded / ⏭️ ${skipped} skipped / ❌ ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  console.log(`\n🎨 Logo:   ${process.env.CF_R2_PUBLIC_URL}/logos/${SET_ID}.png`);
  console.log(`🌐 Data:   ${process.env.CF_R2_PUBLIC_URL}/data/${SET_ID}.json`);
  console.log(`🌐 Images: ${process.env.CF_R2_PUBLIC_URL}/cards/${SET_ID}/{localId}.webp`);

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error("💥", err); process.exit(1); });
