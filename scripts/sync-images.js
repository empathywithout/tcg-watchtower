// scripts/sync-images.js
// Run via GitHub Actions — downloads all card images for a set and uploads to Cloudflare R2
// Uses native fetch (Node 18+) — no node-fetch needed

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const SET_ID = process.env.SET_ID;
if (!SET_ID) {
  console.error("❌ SET_ID environment variable is required");
  process.exit(1);
}

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
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToR2(key, buffer) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000, immutable",
  }));
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TCGWatchtower/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n🚀 Starting image sync for set: ${SET_ID}\n`);

  console.log(`📋 Fetching card list from TCGdex...`);
  const listRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${SET_ID}`, {
    headers: { "Accept": "application/json" }
  });

  if (!listRes.ok) {
    const body = await listRes.text();
    console.error(`❌ TCGdex returned ${listRes.status} for set "${SET_ID}"`);
    console.error(`Tip: Scarlet & Violet Base = sv01, Paldea Evolved = sv02, Obsidian Flames = sv03`);
    console.error(`Response: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const setData = await listRes.json();
  const cards = setData.cards || [];

  if (cards.length === 0) {
    console.error(`❌ No cards found for set "${SET_ID}"`);
    process.exit(1);
  }

  console.log(`✅ Found ${cards.length} cards — Set: ${setData.name}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const localId = card.localId;
    const r2Key = `cards/${SET_ID}/${localId}.webp`;
    const imageUrl = card.image ? `${card.image}/high.webp` : null;

    if (!imageUrl) {
      console.log(`[${i + 1}/${cards.length}] ${card.name} (#${localId})... ⚠️  no image, skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${cards.length}] ${card.name} (#${localId})... `);

    if (await existsInR2(r2Key)) {
      console.log(`⏭️  already exists`);
      skipped++;
      continue;
    }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const buffer = await downloadImage(imageUrl);
        await uploadToR2(r2Key, buffer);
        console.log(`✅ uploaded`);
        uploaded++;
        success = true;
        break;
      } catch (err) {
        if (attempt < 3) {
          process.stdout.write(`⚠️  retry ${attempt}... `);
          await sleep(2000 * attempt);
        } else {
          console.log(`❌ failed: ${err.message}`);
          failures.push({ localId, name: card.name, error: err.message });
          failed++;
        }
      }
    }

    if (success) await sleep(150);
  }

  console.log(`\n📊 Sync complete for ${SET_ID}:`);
  console.log(`   ✅ Uploaded: ${uploaded}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);

  if (failures.length > 0) {
    console.log(`\n⚠️  Failed cards:`);
    failures.forEach(f => console.log(`   #${f.localId} ${f.name}: ${f.error}`));
  }

  console.log(`\n🌐 Images live at: ${process.env.CF_R2_PUBLIC_URL}/cards/${SET_ID}/{localId}.webp`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
