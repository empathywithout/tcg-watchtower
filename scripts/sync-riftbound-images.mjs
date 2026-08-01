#!/usr/bin/env node
/**
 * sync-riftbound-images.mjs
 * Syncs Riftbound TCG card images and metadata to R2
 *
 * Usage:
 *   SET_ID=ogn SET_FULL_NAME="Origins" node scripts/sync-riftbound-images.mjs
 *
 * Flags (env vars):
 *   DRY_RUN=true     — log what would happen, no Scrydex calls, no R2 writes
 *   FORCE_RESYNC=true — re-upload images even if already in R2
 *   SKIP_IMAGES=true  — upload metadata JSON only, skip image sync
 *
 * Riftbound is simpler than One Piece:
 * - No EB split cards, no cross-set SP reprints, no TCGCSV group fetch
 * - Variants are normal + foil — both stored as separate entries
 * - Card ID format: OGN-296 → localId "296"
 * - R2 paths: data/riftbound/{setId}.json, cards/riftbound/{setId}/{localId}.webp
 * - Scrydex IDs assumed: ogn→OGN, spf→SPF, unl→UNL — verify at credit reset
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const SET_ID        = (process.env.SET_ID || '').trim().toLowerCase();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || '').trim();
const DRY_RUN       = (process.env.DRY_RUN || '').toLowerCase() === 'true';
const FORCE_RESYNC  = (process.env.FORCE_RESYNC || '').toLowerCase() === 'true';
const SKIP_IMAGES   = (process.env.SKIP_IMAGES || '').toLowerCase() === 'true';

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE    = 'https://api.scrydex.com/riftbound/v1';

const BUCKET     = process.env.CF_R2_BUCKET;
const CARD_WIDTH  = 400;
const CARD_HEIGHT = 558;

// Scrydex expansion ID map — verify these at credit reset
const SCRYDEX_ID_MAP = {
  'ogn': 'OGN',
  'spf': 'SFD',
  'unl': 'UNL',
  'vnd': 'VEN',
  'rad': 'RAD',
};

// Riftbound rarity normalisation
const RARITY_MAP = {
  'Common':    'Common',
  'Uncommon':  'Uncommon',
  'Rare':      'Rare',
  'Epic':      'Epic',
  'Legendary': 'Legendary',
  'Showcase':  'Showcase',
  'Overnumbered': 'Overnumbered',
  'Signature': 'Signature',
};
function normalizeRarity(r) { return RARITY_MAP[r?.trim()] || r?.trim() || ''; }

function pickImage(images) {
  if (!images || !images.length) return null;
  return images[0]?.medium || images[0]?.large || images[0]?.small || null;
}

/* ── R2 helpers ──────────────────────────────────────────────────────────── */
let s3 = null;
function getS3() {
  if (!s3) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.CF_R2_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.CF_R2_ACCESS_KEY,
        secretAccessKey: process.env.CF_R2_SECRET_KEY,
      },
    });
  }
  return s3;
}

async function existsInR2(key) {
  if (DRY_RUN) return false; // always treat as missing in dry run
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function uploadToR2(key, body, contentType) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upload: ${key}`);
    return;
  }
  await getS3().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=2592000, immutable',
  }));
}

/* ── Scrydex helpers ─────────────────────────────────────────────────────── */
const HEADERS = {
  'X-Api-Key': SCRYDEX_API_KEY,
  'X-Team-ID': SCRYDEX_TEAM_ID,
};

async function fetchWithRetry(url, opts = {}, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, ...opts });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

async function resizeImage(buffer) {
  return sharp(buffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();
}

/* ── Scrydex fetch ───────────────────────────────────────────────────────── */
async function fetchFullExpansion(scrydexId) {
  console.log(`\n📋 Fetching ${scrydexId} from Scrydex...`);
  let allRaw = [], page = 1, total = null;

  while (true) {
    const url = `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,number,printed_number,rarity,domain,type,images,variants&pageSize=250&page=${page}&include=prices`;
    const data = await fetchWithRetry(url, { headers: HEADERS });
    const batch = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allRaw = allRaw.concat(batch);
    console.log(`  Page ${page}: ${batch.length} cards (${allRaw.length}${total ? `/${total}` : ''})`);
    if (batch.length === 0) break;
    if (total !== null && allRaw.length >= total) break;
    page++;
  }

  console.log(`  ✅ ${allRaw.length} raw cards fetched`);
  return allRaw;
}

/* ── Card expansion ──────────────────────────────────────────────────────── */
function expandCards(rawCards) {
  const cards = [];

  for (const c of rawCards) {
    // Extract localId from card ID: "OGN-296" → "296"
    const localId = c.number || (c.id ? c.id.split('-').slice(1).join('-') : '');
    if (!localId) { console.warn(`  ⚠️  Card with no localId: ${JSON.stringify(c.id)}`); continue; }

    // Riftbound rarity correction:
    // Scrydex labels Overnumbered AND Signature cards as "Showcase"
    // The asterisk suffix in the localId (e.g. "303*") identifies Signature cards
    const scrydexRarity = normalizeRarity(c.rarity);
    const isSigned = localId.endsWith('*');
    const baseRarity = isSigned ? 'Signature'
      : (scrydexRarity === 'Showcase' ? 'Overnumbered' : scrydexRarity);
    const baseImage   = pickImage(c.images);
    const domain      = c.domain || '';
    const cardType    = c.type || '';
    const printedNumber = c.printed_number || localId;

    // Extract normal and foil prices from variants
    const variants      = c.variants || [];
    const normalVariant = variants.find(v => v.name === 'normal');
    const foilVariant   = variants.find(v => v.name === 'foil');
    const normalPrice   = normalVariant?.prices?.find(p => p.condition === 'NM' && p.type === 'raw')?.market ?? null;
    const foilPrice     = foilVariant?.prices?.find(p => p.condition === 'NM' && p.type === 'raw')?.market ?? null;

    // Normal image: prefer variant-specific image, fall back to card-level image
    const normalImage = pickImage(normalVariant?.images) || baseImage;

    // Base (normal) entry — always added
    cards.push({
      localId,
      printedNumber,
      name: (c.name || '').trim(),
      rarity: baseRarity,
      domain,
      cardType,
      image: normalImage,
      normalPrice,
      foilPrice,
      hasFoil: !!foilVariant,
      isVariant: false,
      variantType: null,
      baseLocalId: null,
    });

    // Foil entry — added separately if foil variant has distinct image
    // Riftbound foil is a distinct collectible (separate TCGplayer listing)
    if (foilVariant) {
      const foilImage = pickImage(foilVariant.images) || normalImage;
      // Only add a separate foil entry if it has its own image
      if (foilImage && foilImage !== normalImage) {
        cards.push({
          localId: `${localId}_foil`,
          printedNumber,
          name: `${(c.name || '').trim()} (Foil)`,
          rarity: baseRarity,
          domain,
          cardType,
          image: foilImage,
          normalPrice: null,
          foilPrice,
          hasFoil: true,
          isVariant: true,
          variantType: 'foil',
          baseLocalId: localId,
        });
      }
    }
  }

  return cards;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  if (!SET_ID || !SET_FULL_NAME) {
    console.error('❌ SET_ID and SET_FULL_NAME are required');
    console.error('   Example: SET_ID=ogn SET_FULL_NAME="Origins" node scripts/sync-riftbound-images.mjs');
    process.exit(1);
  }

  const scrydexId = SCRYDEX_ID_MAP[SET_ID];
  if (!scrydexId) {
    console.error(`❌ Unknown SET_ID: ${SET_ID}. Known IDs: ${Object.keys(SCRYDEX_ID_MAP).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n⚡ Syncing Riftbound: ${SET_FULL_NAME} (${SET_ID}) — Scrydex: ${scrydexId}`);
  if (DRY_RUN)      console.log('🔍 DRY RUN — no Scrydex calls or R2 writes');
  if (FORCE_RESYNC) console.log('🔄 FORCE_RESYNC — re-uploading all images');
  if (SKIP_IMAGES)  console.log('⏭️  SKIP_IMAGES — metadata only');

  // Step 1: Fetch cards from Scrydex
  let rawCards = [];
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Skipping Scrydex fetch — would call:');
    console.log(`  GET ${SCRYDEX_BASE}/expansions/${scrydexId}/cards?pageSize=250&page=1&include=prices`);
    console.log('  (paginated until all cards fetched)');
  } else {
    if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
      console.error('❌ SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are required');
      process.exit(1);
    }
    rawCards = await fetchFullExpansion(scrydexId);
  }

  // Step 2: Expand cards (normal + foil variants)
  const allCards = DRY_RUN ? [] : expandCards(rawCards);

  if (!DRY_RUN) {
    // Rarity breakdown
    const rarityCounts = {};
    allCards.forEach(c => { rarityCounts[c.rarity] = (rarityCounts[c.rarity] || 0) + 1; });
    const baseCards    = allCards.filter(c => !c.isVariant);
    const variantCards = allCards.filter(c => c.isVariant);
    console.log(`\n✅ ${allCards.length} total entries (${baseCards.length} base + ${variantCards.length} foil variants):`);
    Object.entries(rarityCounts).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`   ${r}: ${n}`));
  }

  // Step 3: Upload metadata JSON to R2
  const metadataKey = `data/riftbound/${SET_ID}.json`;
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would upload metadata: ${metadataKey}`);
  } else {
    console.log('\n📦 Uploading metadata JSON...');
    const baseCards = allCards.filter(c => !c.isVariant);
    await uploadToR2(metadataKey, JSON.stringify({
      setId: SET_ID,
      scrydexId,
      game: 'riftbound',
      phase: 'en',
      cardCount: { official: baseCards.length, total: allCards.length },
      cards: allCards.map(c => ({
        localId:       c.localId,
        printedNumber: c.printedNumber,
        name:          c.name,
        rarity:        c.rarity,
        domain:        c.domain,
        cardType:      c.cardType,
        normalPrice:   c.normalPrice,
        foilPrice:     c.foilPrice,
        hasFoil:       c.hasFoil,
        isVariant:     c.isVariant,
        variantType:   c.variantType || null,
        baseLocalId:   c.baseLocalId || null,
      })),
    }), 'application/json');
    console.log(`✅ ${metadataKey} uploaded`);
  }

  if (SKIP_IMAGES) {
    console.log('\n⏭️  Skipping image sync');
    console.log('\n🎉 Done!');
    return;
  }

  // Step 4: Sync card images
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would sync images to: cards/riftbound/${SET_ID}/{localId}.webp`);
    console.log('[DRY RUN] Image source: Scrydex medium images');
    console.log('[DRY RUN] Resize: 400×558 WebP quality 85');
    console.log('\n🎉 Dry run complete — no credits consumed, no files written');
    return;
  }

  console.log(`\n🖼️  Syncing ${allCards.length} card images...`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const card of allCards) {
    const r2Key = `cards/riftbound/${SET_ID}/${card.localId}.webp`;

    if (!FORCE_RESYNC && await existsInR2(r2Key)) {
      process.stdout.write('.');
      skipped++;
      continue;
    }

    // Image URL: use Scrydex CDN directly (images are on scrydex's CDN)
    // For foil variants with distinct images, card.image is the foil URL
    // For base cards, card.image is the normal URL
    const imageUrl = card.image;
    if (!imageUrl) {
      process.stdout.write('-');
      failed++;
      continue;
    }

    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await resizeImage(Buffer.from(await res.arrayBuffer()));
      await uploadToR2(r2Key, buf, 'image/webp');
      process.stdout.write('+');
      uploaded++;
    } catch (e) {
      console.error(`\n  ✗ FAILED: ${card.localId} | ${imageUrl} | ${e.message}`);
      failed++;
    }

    // Small delay to avoid hammering Scrydex CDN
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n✅ ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);

  // Step 5: Upload set logo
  console.log('\n🏷️  Fetching set logo...');
  try {
    const expData = await fetchWithRetry(
      `${SCRYDEX_BASE}/expansions/${scrydexId}`,
      { headers: HEADERS }
    );
    const logoUrl = expData.data?.logo || expData.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) {
        const rawBuf    = Buffer.from(await img.arrayBuffer());
        const resizedLogo = await sharp(rawBuf)
          .resize(300, null, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        await uploadToR2(`logos/riftbound/${SET_ID}.webp`, resizedLogo, 'image/webp');
        await uploadToR2(`logos/riftbound/${SET_ID}.png`, rawBuf, 'image/png');
        console.log('✅ Logo uploaded (WebP + PNG)');
      }
    } else {
      console.log('⚠️  No logo URL in Scrydex response');
    }
  } catch (e) {
    console.warn('⚠️  Logo failed:', e.message);
  }

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
