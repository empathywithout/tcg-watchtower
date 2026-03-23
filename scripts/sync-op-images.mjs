#!/usr/bin/env node
/**
 * sync-op-images.mjs
 * Syncs One Piece TCG card images and metadata to R2
 * Uses printings filter to get all cards in a set including reprints
 * Expands variants (Alt Art, Manga Alt Art, Special Alt Art) as separate entries
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
const CARD_WIDTH  = 400;
const CARD_HEIGHT = 558;

const HEADERS = {
  'X-Api-Key': SCRYDEX_API_KEY,
  'X-Team-ID': SCRYDEX_TEAM_ID,
};

const SCRYDEX_ID_MAP = {
  'op01':'OP01','op02':'OP02','op03':'OP03','op04':'OP04','op05':'OP05',
  'op06':'OP06','op07':'OP07','op08':'OP08','op09':'OP09','op10':'OP10',
  'op11':'OP11','op12':'OP12','op13':'OP13','op14':'OP14','op15':'OP15',
  'eb01':'EB01','eb02':'EB02','eb03':'EB03','eb04':'EB04',
  'st01':'ST01','st02':'ST02','st03':'ST03','st04':'ST04','st10':'ST10','st13':'ST13',
};

// Manual card overrides — cards in the TCGplayer group but not in Scrydex
// (cross-set SP reprints with non-standard set numbers)
const SET_OVERRIDES = {
  'op14': [
    {
      localId: '108',
      name: 'Donquixote Rosinante',
      rarity: 'Treasure Rare',
      isVariant: false,
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/670876_400w.jpg',
    },
    {
      localId: 'prb02006_specialaltart',
      name: 'Roronoa Zoro',
      displayName: 'Roronoa Zoro (SP Alt Art)',
      rarity: 'Special',
      isVariant: true,
      variantType: 'specialAltArt',
      baseLocalId: 'prb02006',
      imageUrl: 'https://images.scrydex.com/onepiece/PRB02-006/large',
    },
  ],
};

const RARITY_MAP = {
  'C':'Common','UC':'Uncommon','R':'Rare','SR':'Super Rare',
  'SEC':'Secret Rare','L':'Leader','TR':'Treasure Rare',
  'SP':'Special','MR':'Manga Rare','ALT':'Alternate Art',
  'Common':'Common','Uncommon':'Uncommon','Rare':'Rare',
  'Super Rare':'Super Rare','Secret Rare':'Secret Rare',
  'Leader':'Leader','Treasure Rare':'Treasure Rare',
  'Special':'Special','Manga Rare':'Manga Rare',
  'Alternate Art':'Alternate Art','Special Rare':'Special',
};
function normalizeRarity(r) { return RARITY_MAP[r?.trim()] || r?.trim() || ''; }

// Variant name → rarity mapping (API uses camelCase names like "mangaAltArt", "altArt", "redMangaAltArt")
const VARIANT_RARITY = {
  'normal':          null,           // use base card rarity
  'altart':          'Alternate Art',
  'mangaaltart':     'Manga Rare',
  'specialaltart':   'Special',
  'parallel':        'Special',
  'fullart':         'Alternate Art',
  'promo':           'Special',
};

function normalizeVariantName(name) {
  // Strip color prefixes like "red", "blue", "black" from names like "redMangaAltArt"
  return (name || '').toLowerCase().replace(/^(red|blue|green|black|purple|yellow|pink|white)/, '');
}

function variantRarityFromName(variantName) {
  const normalized = normalizeVariantName(variantName);
  // Try exact match first, then partial matches
  if (VARIANT_RARITY[normalized] !== undefined) return VARIANT_RARITY[normalized];
  if (normalized.includes('mangaalt') || normalized.includes('mangaart')) return 'Manga Rare';
  if (normalized.includes('specialalt') || normalized.includes('specialart')) return 'Special';
  if (normalized.includes('alt')) return 'Alternate Art';
  if (normalized.includes('parallel') || normalized.includes('promo')) return 'Special';
  return undefined; // unknown — use base rarity
}

function variantSuffix(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function uploadToR2(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=2592000, immutable',
  }));
}

async function existsInR2(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

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
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 }, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

function parseLocalId(rawId) {
  if (!rawId) return '';
  const stripped = rawId.split('-').slice(1).join('-');
  return stripped.includes('/') ? stripped.split('/')[0].trim() : stripped;
}

function pickImage(images) {
  if (!images || !images.length) return null;
  return images[0]?.large || images[0]?.medium || images[0]?.small || null;
}

async function main() {
  if (!SET_ID || !SET_FULL_NAME) {
    console.error('❌ SET_ID and SET_FULL_NAME are required');
    process.exit(1);
  }

  const scrydexId = SCRYDEX_ID_MAP[SET_ID.toLowerCase()] || SET_ID.toUpperCase();
  console.log(`\n🏴‍☠️ Syncing One Piece: ${SET_FULL_NAME} (${SET_ID}) — Scrydex ID: ${scrydexId}\n`);

  // Fetch all cards printed in this set using the printings filter
  console.log('📋 Fetching cards from Scrydex (using printings filter)...');
  let allRaw = [], page = 1, total = null;
  while (true) {
    const url = `${SCRYDEX_BASE}/cards?q=printings:${scrydexId}&select=id,name,rarity,variants,images&pageSize=100&page=${page}`;
    const data = await fetchWithRetry(url, { headers: HEADERS });
    const batch = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allRaw = allRaw.concat(batch);
    console.log(`  Page ${page}: ${batch.length} cards (${allRaw.length}${total ? `/${total}` : ''})`);
    if (batch.length === 0 || batch.length < 100) break;
    if (total !== null && allRaw.length >= total) break;
    page++;
  }

  // If printings filter returned nothing, fall back to expansion endpoint
  if (allRaw.length === 0) {
    console.log('⚠️  printings filter returned 0 cards — trying expansion endpoint as fallback...');
    page = 1; total = null;
    while (true) {
      const url = `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,rarity,variants,images&pageSize=100&page=${page}`;
      const data = await fetchWithRetry(url, { headers: HEADERS });
      const batch = data.data || [];
      if (total === null) total = data.totalCount || data.total || null;
      allRaw = allRaw.concat(batch);
      console.log(`  Fallback page ${page}: ${batch.length} cards (${allRaw.length}${total ? `/${total}` : ''})`);
      if (batch.length === 0 || batch.length < 100) break;
      if (total !== null && allRaw.length >= total) break;
      page++;
    }
  }
  console.log(`✅ ${allRaw.length} base cards fetched`);

  // Expand each base card + its variants printed in this set
  const cards = [];
  for (const c of allRaw) {
    const baseLocalId = parseLocalId(c.id);
    const baseRarity  = normalizeRarity(c.rarity);
    const baseImage   = pickImage(c.images);

    const variants = c.variants || [];

    if (!variants.length) {
      cards.push({ localId: baseLocalId, name: (c.name||'').trim(), rarity: baseRarity, image: baseImage, isVariant: false });
      continue;
    }

    const normalV = variants.find(v => normalizeVariantName(v.name||'') === 'normal');
    if (normalV) {
      const img = pickImage(normalV.images) || baseImage;
      cards.push({ localId: baseLocalId, name: (c.name||'').trim(), rarity: baseRarity, image: img, isVariant: false });
    } else {
      cards.push({ localId: baseLocalId, name: (c.name||'').trim(), rarity: baseRarity, image: baseImage, isVariant: false });
    }

    for (const v of variants) {
      const vPrintings = (v.printings || []).map(p => p.toUpperCase());
      if (vPrintings.length > 0 && !vPrintings.includes(scrydexId.toUpperCase())) continue;

      const vType = (v.name || '').trim();
      const normalizedVType = normalizeVariantName(vType);
      if (normalizedVType === 'normal' || normalizedVType === 'foil') continue;

      const nameRarity = variantRarityFromName(vType);
      let variantRarity;
      if (nameRarity !== undefined) {
        variantRarity = nameRarity || baseRarity;
      } else if (v.rarity) {
        variantRarity = normalizeRarity(v.rarity);
      } else {
        variantRarity = baseRarity;
      }

      const variantImage = pickImage(v.images) || baseImage;
      const suffix = variantSuffix(vType);
      const variantLocalId = `${baseLocalId}_${suffix}`;
      const variantName = `${(c.name||'').trim()} (${vType})`;

      cards.push({
        localId: variantLocalId,
        name: variantName,
        rarity: variantRarity,
        image: variantImage,
        isVariant: true,
        variantType: vType,
        baseLocalId,
      });
    }
  }

  // Debug: show first few variants to verify structure
  const sampleVariants = cards.filter(c => c.isVariant).slice(0, 5);
  if (sampleVariants.length) {
    console.log('\n🔍 Sample variants:');
    sampleVariants.forEach(v => console.log(`   ${v.localId} | ${v.name} | rarity: ${v.rarity} | type: ${v.variantType}`));
  }

  // Log rarity breakdown
  const rarityCounts = {};
  cards.forEach(c => { rarityCounts[c.rarity] = (rarityCounts[c.rarity] || 0) + 1; });
  const officialCount = cards.filter(c => !c.isVariant).length;
  console.log(`✅ ${cards.length} total entries (${officialCount} base + ${cards.length - officialCount} variants):`);
  Object.entries(rarityCounts).sort((a,b) => b[1]-a[1]).forEach(([r,n]) => console.log(`   ${r}: ${n}`));

  // Upload metadata JSON
  console.log('\n📦 Uploading metadata JSON...');
  await uploadToR2(`data/op/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, game: 'onepiece', phase: PHASE,
    cardCount: { official: officialCount, total: cards.length },
    cards: cards.map(c => ({
      localId: c.localId,
      name: c.name,
      rarity: c.rarity,
      isVariant: c.isVariant || false,
      variantType: c.variantType || null,
      baseLocalId: c.baseLocalId || null,
    })),
  }), 'application/json');
  console.log(`✅ data/op/${SET_ID}.json uploaded`);

  // Apply set-specific overrides (cross-set reprints not in Scrydex expansion)
  const overrides = SET_OVERRIDES[SET_ID.toLowerCase()] || [];
  if (overrides.length > 0) {
    console.log(`\n📎 Applying ${overrides.length} manual override(s)...`);
    const allCards = cards.map(c => ({ localId: c.localId, name: c.name, rarity: c.rarity, isVariant: c.isVariant || false, variantType: c.variantType || null, baseLocalId: c.baseLocalId || null }));
    const existingIds = new Set(allCards.map(c => c.localId));
    let added = 0;
    for (const ov of overrides) {
      const existingIdx = allCards.findIndex(c => c.localId === ov.localId);
      if (existingIdx === -1) {
        // Card doesn't exist — add it
        allCards.push({ localId: ov.localId, name: ov.displayName || ov.name, rarity: ov.rarity, isVariant: ov.isVariant || false, variantType: ov.variantType || null, baseLocalId: ov.baseLocalId || null });
        existingIds.add(ov.localId);
        console.log(`  Added: ${ov.localId} | ${ov.displayName || ov.name}`);
        added++;
        if (!SKIP_IMAGES && ov.imageUrl) {
          try {
            const img = await fetch(ov.imageUrl);
            if (img.ok) {
              const buf = await resizeImage(Buffer.from(await img.arrayBuffer()));
              await uploadToR2(`cards/op/${SET_ID}/${ov.localId}.webp`, buf, 'image/webp');
              console.log(`  Image uploaded: ${ov.localId}`);
            }
          } catch(e) { console.warn(`  Image failed for ${ov.localId}:`, e.message); }
        }
      } else {
        // Card exists — force-update name and rarity from override
        const existing = allCards[existingIdx];
        const changed = existing.rarity !== ov.rarity || existing.name !== (ov.displayName || ov.name);
        if (changed) {
          allCards[existingIdx] = { ...existing, name: ov.displayName || ov.name, rarity: ov.rarity };
          console.log(`  Updated: ${ov.localId} | rarity: ${existing.rarity} → ${ov.rarity}`);
          added++;
        } else {
          console.log(`  Skipped (already correct): ${ov.localId} | ${ov.displayName || ov.name}`);
        }
      }
    }
    if (added > 0) {
      // Re-upload updated JSON
      await uploadToR2(`data/op/${SET_ID}.json`, JSON.stringify({
        setId: SET_ID, game: 'onepiece', phase: PHASE,
        cardCount: { official: allCards.filter(c => !c.isVariant).length, total: allCards.length },
        cards: allCards,
      }), 'application/json');
      console.log(`✅ data/op/${SET_ID}.json re-uploaded with ${added} override(s)`);
    }
  }

  if (SKIP_IMAGES) {
    console.log('\n⏭️  Skipping image sync');
    console.log('\n🎉 Done!');
    return;
  }

  // Sync images
  console.log(`\n🖼️  Syncing ${cards.length} card images...`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const card of cards) {
    const r2Key = `cards/op/${SET_ID}/${card.localId}.webp`;
    if (!FORCE_RESYNC && await existsInR2(r2Key)) { process.stdout.write('.'); skipped++; continue; }
    if (!card.image) { process.stdout.write('-'); failed++; continue; }
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
    const exp = res.data || {};
    const logoUrl = exp.logo || exp.images?.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) {
        const rawBuf = Buffer.from(await img.arrayBuffer());
        const resizedLogo = await sharp(rawBuf)
          .resize(300, null, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        await uploadToR2(`logos/op/${SET_ID}.webp`, resizedLogo, 'image/webp');
        await uploadToR2(`logos/op/${SET_ID}.png`, rawBuf, 'image/png');
        console.log(`✅ Logo uploaded (WebP + PNG)`);
      }
    }
  } catch(e) { console.warn('⚠️ Logo failed:', e.message); }

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
