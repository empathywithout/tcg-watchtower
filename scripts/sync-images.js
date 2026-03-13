// scripts/sync-images.js
// Run via GitHub Actions — downloads all card images for a set and uploads to Cloudflare R2
// Trigger manually from Actions tab, pass set_id e.g. sv1, sv2, sv3a etc.

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fetch from "node-fetch";

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

// Check if a file already exists in R2 — skip if so (makes re-runs safe)
async function existsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Upload a single image buffer to R2
async function uploadToR2(key, buffer, contentType = "image/webp") {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable", // cache forever — card images never change
  }));
}

// Download image from URL and return as buffer
async function downloadImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "TCGWatchtower/1.0 (card image sync)" },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = await res.buffer();
  return buffer;
}

// Sleep helper for rate limiting
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`\n🚀 Starting image sync for set: ${SET_ID}\n`);

  // Step 1: Fetch card list from TCGdex
  console.log(`📋 Fetching card list from TCGdex...`);
  const listRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${SET_ID}`, {
    headers: { "Accept": "application/json" }
  });

  if (!listRes.ok) {
    console.error(`❌ TCGdex returned ${listRes.status} for set ${SET_ID}`);
    process.exit(1);
  }

  const setData = await listRes.json();
  const cards = setData.cards || [];
  console.log(`✅ Found ${cards.length} cards in ${SET_ID}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  // Step 2: Download and upload each card image
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const localId = card.localId;
    const r2Key = `cards/${SET_ID}/${localId}.webp`;
    const imageUrl = `https://assets.tcgdex.net/en/sv/${SET_ID}/${localId}/high.webp`;

    process.stdout.write(`[${i + 1}/${cards.length}] ${card.name} (#${localId})... `);

    // Skip if already uploaded
    if (await existsInR2(r2Key)) {
      console.log(`⏭️  already exists`);
      skipped++;
      continue;
    }

    // Download and upload with retry
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

    // Rate limit — don't hammer TCGdex
    if (success) await sleep(200);
  }

  // Step 3: Summary
  console.log(`\n📊 Sync complete for ${SET_ID}:`);
  console.log(`   ✅ Uploaded: ${uploaded}`);
  console.log(`   ⏭️  Skipped (already existed): ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);

  if (failures.length > 0) {
    console.log(`\n⚠️  Failed cards:`);
    failures.forEach(f => console.log(`   #${f.localId} ${f.name}: ${f.error}`));
  }

  console.log(`\n🌐 Images available at:`);
  console.log(`   ${process.env.CF_R2_PUBLIC_URL || "your-r2-public-url"}/cards/${SET_ID}/{cardNumber}.webp`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
