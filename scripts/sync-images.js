// scripts/sync-images.js
// Downloads card images + full card metadata for a set, uploads everything to Cloudflare R2
// After this runs: images at /cards/{setId}/{localId}.webp
//                  metadata at /data/{setId}.json

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const SET_ID = process.env.SET_ID;
if (!SET_ID) { console.error("❌ SET_ID required"); process.exit(1); }

// TCGdex uses different IDs in different contexts for special sets:
// - Set overview endpoint: uses '151' for the 151 set
// - Card detail endpoint: uses 'sv3pt5-{localId}'
// - Logo/image assets: uses 'sv3pt5'
const TCGDEX_SET_OVERVIEW_ID = SET_ID === 'sv3pt5' ? '151' : SET_ID;
const TCGDEX_CARD_ID_PREFIX  = SET_ID; // card IDs always use our internal ID (sv3pt5-1, sv4pt5-1 etc)
const TCGDEX_ASSET_ID        = SET_ID; // asset paths also use our internal ID

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
  console.log(`\n🚀 Starting sync for set: ${SET_ID}\n`);

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
      // Use the card's own id if available (e.g. sv3pt5-1), otherwise construct it
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
      fullCards.push({ localId: brief.localId, name: brief.name, rarity: null, image: brief.image ? `${brief.image}/high.webp` : null });
    }
    await sleep(100); // be polite to TCGdex
  }

  // Step 3 — Download and upload set logo
  console.log(`\n🎨 Uploading set logo to R2...`);
  const logoR2Key = `logos/${SET_ID}.png`;
  
  if (await existsInR2(logoR2Key)) {
    console.log(`⏭️  Logo already exists at logos/${SET_ID}.png`);
  } else {
    // Use the logo URL from the TCGdex set data if available, otherwise construct it
    const logoBase = setData.logo || `https://assets.tcgdex.net/en/sv/${TCGDEX_ASSET_ID}/logo`;
    // Ensure it ends without extension so we can append .png
    const logoUrl = logoBase.replace(/\.png$|\.webp$|\.jpg$/, '') + '.png';
    try {
      const logoBuffer = await downloadImage(logoUrl);
      await uploadToR2(logoR2Key, logoBuffer, "image/png");
      console.log(`✅ Logo uploaded to R2 at logos/${SET_ID}.png`);
    } catch (err) {
      console.log(`⚠️  Logo download failed (${err.message}) — will use fallback`);
    }
  }

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

  // Step 5 — Download and upload card images
  console.log(`\n🖼️  Uploading card images to R2...`);
  let uploaded = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < briefCards.length; i++) {
    const card = briefCards[i];
    const localId = card.localId;
    const r2Key = `cards/${SET_ID}/${localId}.webp`;
    const imageUrl = card.image ? `${card.image}/high.webp` : null;

    if (!imageUrl) { skipped++; continue; }
    process.stdout.write(`[${i + 1}/${briefCards.length}] #${localId}... `);

    if (await existsInR2(r2Key)) { console.log(`⏭️  exists`); skipped++; continue; }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await uploadToR2(r2Key, await downloadImage(imageUrl), "image/webp");
        console.log(`✅`); uploaded++; success = true; break;
      } catch (err) {
        if (attempt < 3) { process.stdout.write(`⚠️  retry... `); await sleep(2000 * attempt); }
        else { console.log(`❌ ${err.message}`); failures.push(localId); failed++; }
      }
    }
    if (success) await sleep(150);
  }

  console.log(`\n📊 Done! ${SET_ID}: ✅ ${uploaded} uploaded / ⏭️ ${skipped} skipped / ❌ ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  console.log(`\n🎨 Logo: ${process.env.CF_R2_PUBLIC_URL}/logos/${SET_ID}.png`);
  console.log(`🌐 Data: ${process.env.CF_R2_PUBLIC_URL}/data/${SET_ID}.json`);
  console.log(`🌐 Images: ${process.env.CF_R2_PUBLIC_URL}/cards/${SET_ID}/{localId}.webp`);

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error("💥", err); process.exit(1); });
