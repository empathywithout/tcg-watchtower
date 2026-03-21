#!/usr/bin/env node
/**
 * sync-op-images.mjs
 * Syncs One Piece TCG card images and metadata to R2
 * Uses Scrydex API: https://api.scrydex.com/onepiece/v1/
 *
 * Usage (via GitHub Actions):
 *   SET_ID=op01 SET_FULL_NAME="Romance Dawn" node scripts/sync-op-images.mjs
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const SET_ID        = (process.env.SET_ID || '').trim();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || '').trim();
const PHASE         = (process.env.PHASE || 'en').trim();
const FORCE_RESYNC  = (process.env.FORCE_RESYNC || '').toLowerCase() === 'true';
const SKIP_IMAGES   = (process.env.SKIP_IMAGES || '').toLowerCase() === 'true';

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE    = 'https://api.scrydex.com/onepiece/v1';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});
const BUCKET     = process.env.CF_R2_BUCKET;
const R2_BASE    = process.env.CF_R2_PUBLIC_URL;
const CARD_WIDTH  = 400;
const CARD_HEIGHT = 558;

const HEADERS = {
  'X-Api-Key': SCRYDEX_API_KEY,
  'X-Team-ID': SCRYDEX_TEAM_ID,
};

// Scrydex expansion ID map — One Piece uses OP01, OP02 etc.
// The Scrydex ID matches the set code directly for One Piece EN sets
const SCRYDEX_ID_MAP = {
  'op01': 'OP01', 'op02': 'OP02', 'op03': 'OP03', 'op04': 'OP04',
  'op05': 'OP05', 'op06': 'OP06', 'op07': 'OP07', 'op08': 'OP08',
  'op09': 'OP09', 'op10': 'OP10', 'op11': 'OP11', 'op12': 'OP12',
  'op13': 'OP13', 'op14': 'OP14', 'op15': 'OP15',
  'eb01': 'EB01', 'eb02': 'EB02', 'eb03': 'EB03', 'eb04': 'EB04',
  'st01': 'ST01', 'st02': 'ST02', 'st03': 'ST03', 'st04': 'ST04',
  'st10': 'ST10', 'st13': 'ST13',
};

const RARITY_MAP = {
  'C':'Common','UC':'Uncommon','R':'Rare','SR':'Super Rare',
  'SEC':'Secret Rare','L':'Leader','TR':'Treasure Rare',
  'Common':'Common','Uncommon':'Uncommon','Rare':'Rare',
  'Super Rare':'Super Rare','Secret Rare':'Secret Rare',
  'Leader':'Leader','Treasure Rare':'Treasure Rare',
};
function normalizeRarity(r) { return RARITY_MAP[r?.trim()] || r || ''; }

async function uploadToR2(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=86400',
  }));
}

async function existsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function fetchWithRetry(url, opts = {}, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, ...opts });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

async function resizeImage(buffer) {
  return sharp(buffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 }, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

async function main() {
  if (!SET_ID || !SET_FULL_NAME) {
    console.error('❌ SET_ID and SET_FULL_NAME are required');
    process.exit(1);
  }

  const scrydexId = SCRYDEX_ID_MAP[SET_ID.toLowerCase()] || SET_ID.toUpperCase();
  console.log(`\n🏴‍☠️ Syncing One Piece: ${SET_FULL_NAME} (${SET_ID}) — Scrydex ID: ${scrydexId}\n`);

  // Fetch cards from Scrydex
  console.log('📋 Fetching cards from Scrydex...');
  let allCards = [], page = 1, total = null;
  while (true) {
    const url = `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,rarity,images&pageSize=100&page=${page}`;
    const data = await fetchWithRetry(url, { headers: HEADERS });
    const cards = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allCards = allCards.concat(cards);
    console.log(`  Page ${page}: ${cards.length} cards (${allCards.length}${total ? `/${total}` : ''})`);
    if (cards.length === 0 || cards.length < 100) break;
    if (total !== null && allCards.length >= total) break;
    page++;
  }
  console.log(`✅ ${allCards.length} cards fetched`);

  const cards = allCards.map(c => {
    const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
    const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
    return {
      localId,
      name:   (c.name || '').trim(),
      rarity: normalizeRarity(c.rarity),
      image:  c.images?.[0]?.large || c.images?.[0]?.medium || c.images?.[0]?.small || null,
    };
  });

  // Upload metadata JSON
  console.log('\n📦 Uploading metadata JSON...');
  await uploadToR2(`data/op/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, game: 'onepiece', phase: PHASE,
    cardCount: { official: cards.length, total: cards.length },
    cards: cards.map(c => ({ localId: c.localId, name: c.name, rarity: c.rarity })),
  }), 'application/json');
  console.log(`✅ data/op/${SET_ID}.json uploaded`);

  if (SKIP_IMAGES) {
    console.log('\n⏭️  Skipping image sync (SKIP_IMAGES=true)');
    console.log('\n🎉 Done!');
    return;
  }

  // Sync card images
  console.log(`\n🖼️  Syncing ${cards.length} card images...`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const card of cards) {
    const r2Key = `cards/op/${SET_ID}/${card.localId}.webp`;
    if (!FORCE_RESYNC && await existsInR2(r2Key)) {
      process.stdout.write('.');
      skipped++;
      continue;
    }
    if (!card.image) { failed++; continue; }
    try {
      const res = await fetch(card.image);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await resizeImage(Buffer.from(await res.arrayBuffer()));
      await uploadToR2(r2Key, buf, 'image/webp');
      process.stdout.write('+');
      uploaded++;
    } catch(e) {
      process.stdout.write('✗');
      failed++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`\n✅ ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);

  // Logo
  try {
    const res = await fetchWithRetry(`${SCRYDEX_BASE}/expansions/${scrydexId}`, { headers: HEADERS });
    const exp = (res.data) || {};
    const logoUrl = exp.logo || exp.images?.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) {
        await uploadToR2(`logos/op/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png');
        console.log(`✅ Logo uploaded`);
      }
    }
  } catch(e) { console.warn('⚠️ Logo failed:', e.message); }

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
