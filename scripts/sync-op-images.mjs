#!/usr/bin/env node
/**
 * sync-op-images.mjs
 * Syncs One Piece TCG card images and metadata to R2
 *
 * Strategy:
 * - Primary expansion (e.g. OP15): full Scrydex fetch using printings filter
 *   This naturally includes cross-set SP reprints with correct SP art
 * - EB04: individual fetch for only the specific card numbers in the TCGplayer group
 *   because EB04 is split across OP14 and OP15 English releases
 * - SET_OVERRIDES: force specific image URLs for cards Scrydex gets wrong (e.g. Koby MR)
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const SET_ID        = (process.env.SET_ID || '').trim();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || '').trim();
const PHASE         = (process.env.PHASE || 'en').trim();
const FORCE_RESYNC  = (process.env.FORCE_RESYNC || '').toLowerCase() === 'true';
const SKIP_IMAGES   = (process.env.SKIP_IMAGES || '').toLowerCase() === 'true';
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID || '').trim();

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
const BUCKET      = process.env.CF_R2_BUCKET;
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
  'op16':'OP16',
  'eb01':'EB01','eb02':'EB02','eb03':'EB03','eb04':'EB04',
  'st01':'ST01','st02':'ST02','st03':'ST03','st04':'ST04','st10':'ST10','st13':'ST13',
};

/**
 * For sets where Scrydex splits EB cards between two English releases,
 * specify which EB card numbers belong to this set's TCGplayer group.
 * These are fetched individually from Scrydex and stored with full IDs (e.g. "EB04-044").
 */
const EB_SPLIT = {
  'op14': { 'EB04': { start: 1,  end: 41 } },
  'op15': { 'EB04': { start: 42, end: 61 } },
};

/**
 * Image overrides — direct Scrydex CDN URLs for cards where the API returns wrong art.
 * localId = as stored in JSON (short number for primary, full ID for EB split cards)
 */
const SET_OVERRIDES = {
  'op15': {
    // Koby Manga Rare — Scrydex API returns wrong image for this variant
    'EB04-044_mangaaltart': 'https://images.scrydex.com/onepiece/EB04-044C/medium',
  },
};

// Rarity overrides — correct rarities where Scrydex returns wrong value
const RARITY_OVERRIDES = {
  'op15': {
    'OP13-037': 'Treasure Rare',
  },
};

const SCRYDEX_KNOWN_EXPANSIONS = new Set([
  'OP01','OP02','OP03','OP04','OP05','OP06','OP07','OP08','OP09','OP10',
  'OP11','OP12','OP13','OP14','OP15','OP16',
  'EB01','EB02','EB03','EB04',
  'ST01','ST02','ST03','ST04','ST05','ST06','ST07','ST08','ST09','ST10',
  'ST11','ST12','ST13','ST14','ST15','ST16','ST17','ST18','ST19','ST20',
  'ST21','ST22','ST23','ST24','ST25','ST26','ST27','ST28','ST29','ST30',
  'PRB01','PRB02',
]);

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

const VARIANT_RARITY = {
  'normal':        null,
  'altart':        'Alternate Art',
  'mangaaltart':   'Manga Rare',
  'specialaltart': 'Special',
  'parallel':      'Special',
  'fullart':       'Alternate Art',
  'promo':         'Special',
};

function normalizeVariantName(name) {
  return (name || '').toLowerCase().replace(/^(red|blue|green|black|purple|yellow|pink|white)/, '');
}

function variantRarityFromName(variantName) {
  const normalized = normalizeVariantName(variantName);
  if (VARIANT_RARITY[normalized] !== undefined) return VARIANT_RARITY[normalized];
  if (normalized.includes('mangaalt') || normalized.includes('mangaart')) return 'Manga Rare';
  if (normalized.includes('specialalt') || normalized.includes('specialart')) return 'Special';
  if (normalized.includes('alt')) return 'Alternate Art';
  if (normalized.includes('parallel') || normalized.includes('promo')) return 'Special';
  return undefined;
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

function parseShortNum(rawId) {
  if (!rawId) return '';
  const parts = rawId.split('-');
  const num = parts[parts.length - 1];
  return num.includes('/') ? num.split('/')[0].trim() : num;
}

function pickImage(images) {
  if (!images || !images.length) return null;
  return images[0]?.large || images[0]?.medium || images[0]?.small || null;
}

/** Full Scrydex fetch for the primary expansion using printings filter. */
async function fetchFullExpansion(expansionId) {
  console.log(`\n📋 Full fetch: ${expansionId}...`);
  let allRaw = [], page = 1, total = null;
  while (true) {
    const url = `${SCRYDEX_BASE}/cards?q=printings:${expansionId}&select=id,name,rarity,variants,images&pageSize=100&page=${page}`;
    const data = await fetchWithRetry(url, { headers: HEADERS });
    const batch = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allRaw = allRaw.concat(batch);
    console.log(`  Page ${page}: ${batch.length} cards (${allRaw.length}${total ? `/${total}` : ''})`);
    if (batch.length === 0 || batch.length < 100) break;
    if (total !== null && allRaw.length >= total) break;
    page++;
  }
  if (allRaw.length === 0) {
    console.log(`  ⚠️  printings filter returned 0 — trying expansion endpoint...`);
    page = 1; total = null;
    while (true) {
      const url = `${SCRYDEX_BASE}/expansions/${expansionId}/cards?select=id,name,rarity,variants,images&pageSize=100&page=${page}`;
      const data = await fetchWithRetry(url, { headers: HEADERS });
      const batch = data.data || [];
      if (total === null) total = data.totalCount || data.total || null;
      allRaw = allRaw.concat(batch);
      if (batch.length === 0 || batch.length < 100) break;
      if (total !== null && allRaw.length >= total) break;
      page++;
    }
  }
  console.log(`  ✅ ${allRaw.length} raw cards`);
  return allRaw;
}

/** Fetch specific EB cards by card number. Returns { raw, cardNum, expansionId } entries. */
async function fetchEBCards(expansionId, start, end) {
  const nums = [];
  for (let i = start; i <= end; i++) nums.push(String(i).padStart(3, '0'));
  console.log(`\n📋 EB split fetch: ${expansionId} cards ${start.toString().padStart(3,'0')}–${end.toString().padStart(3,'0')} (${nums.length} cards)...`);
  const results = [];
  for (const num of nums) {
    const cardId = `${expansionId}-${num}`;
    try {
      const url = `${SCRYDEX_BASE}/cards/${cardId}?select=id,name,rarity,variants,images`;
      const data = await fetchWithRetry(url, { headers: HEADERS });
      if (data.data) { results.push({ raw: data.data, cardNum: num, expansionId }); process.stdout.write('.'); }
    } catch (e) { process.stdout.write('✗'); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(` (${results.length}/${nums.length} found)`);
  return results;
}

/** Expand primary expansion cards. localId = short number e.g. "118" */
function expandPrimaryCards(rawCards, expansionId) {
  const cards = [];
  for (const c of rawCards) {
    const baseNum    = parseShortNum(c.id);
    const baseRarity = normalizeRarity(c.rarity);
    const baseImage  = pickImage(c.images);
    const variants   = c.variants || [];

    if (!variants.length) {
      cards.push({ localId: baseNum, name: (c.name||'').trim(), rarity: baseRarity, image: baseImage, isVariant: false });
      continue;
    }
    const normalV = variants.find(v => normalizeVariantName(v.name||'') === 'normal');
    cards.push({ localId: baseNum, name: (c.name||'').trim(), rarity: baseRarity, image: (normalV ? pickImage(normalV.images) : null) || baseImage, isVariant: false });

    for (const v of variants) {
      const vPrintings = (v.printings || []).map(p => p.toUpperCase());
      if (vPrintings.length > 0 && !vPrintings.includes(expansionId.toUpperCase())) continue;
      const vType = (v.name || '').trim();
      const nVType = normalizeVariantName(vType);
      if (nVType === 'normal' || nVType === 'foil') continue;
      const nameRarity = variantRarityFromName(vType);
      const variantRarity = nameRarity !== undefined ? (nameRarity || baseRarity) : (v.rarity ? normalizeRarity(v.rarity) : baseRarity);
      const suffix = variantSuffix(vType);
      cards.push({
        localId: `${baseNum}_${suffix}`,
        name: `${(c.name||'').trim()} (${vType})`,
        rarity: variantRarity,
        image: pickImage(v.images) || baseImage,
        isVariant: true, variantType: vType, baseLocalId: baseNum,
      });
    }
  }
  return cards;
}

/** Expand EB split cards. localId = full card ID e.g. "EB04-044" */
function expandEBCards(rawCardEntries) {
  const cards = [];
  for (const { raw: c, cardNum, expansionId } of rawCardEntries) {
    const baseLocalId = `${expansionId}-${cardNum}`;
    const baseRarity  = normalizeRarity(c.rarity);
    const baseImage   = pickImage(c.images);
    const variants    = c.variants || [];

    if (!variants.length) {
      cards.push({ localId: baseLocalId, name: (c.name||'').trim(), rarity: baseRarity, image: baseImage, isVariant: false });
      continue;
    }
    const normalV = variants.find(v => normalizeVariantName(v.name||'') === 'normal');
    cards.push({ localId: baseLocalId, name: (c.name||'').trim(), rarity: baseRarity, image: (normalV ? pickImage(normalV.images) : null) || baseImage, isVariant: false });

    for (const v of variants) {
      const vPrintings = (v.printings || []).map(p => p.toUpperCase());
      if (vPrintings.length > 0 && !vPrintings.includes(expansionId.toUpperCase())) continue;
      const vType = (v.name || '').trim();
      const nVType = normalizeVariantName(vType);
      if (nVType === 'normal' || nVType === 'foil') continue;
      const nameRarity = variantRarityFromName(vType);
      const variantRarity = nameRarity !== undefined ? (nameRarity || baseRarity) : (v.rarity ? normalizeRarity(v.rarity) : baseRarity);
      const suffix = variantSuffix(vType);
      cards.push({
        localId: `${baseLocalId}_${suffix}`,
        name: `${(c.name||'').trim()} (${vType})`,
        rarity: variantRarity,
        image: pickImage(v.images) || baseImage,
        isVariant: true, variantType: vType, baseLocalId,
      });
    }
  }
  return cards;
}

async function main() {
  if (!SET_ID || !SET_FULL_NAME) { console.error('❌ SET_ID and SET_FULL_NAME are required'); process.exit(1); }

  const primaryScrydexId = SCRYDEX_ID_MAP[SET_ID.toLowerCase()] || SET_ID.toUpperCase();
  console.log(`\n🏴‍☠️ Syncing One Piece: ${SET_FULL_NAME} (${SET_ID}) — Primary: ${primaryScrydexId}\n`);

  const imageOverrides = SET_OVERRIDES[SET_ID.toLowerCase()] || {};
  if (Object.keys(imageOverrides).length > 0) {
    console.log(`📌 Image overrides: ${Object.keys(imageOverrides).join(', ')}`);
  }

  // Step 1: Full fetch for primary expansion
  // Scrydex's printings:OP15 filter returns OP15 cards + cross-set SP reprints with correct art
  let primaryRaw;
  try { primaryRaw = await fetchFullExpansion(primaryScrydexId); }
  catch (e) { console.error(`❌ Primary expansion fetch failed: ${e.message}`); process.exit(1); }

  const primaryExpanded = expandPrimaryCards(primaryRaw, primaryScrydexId);
  const seenLocalIds = new Set();
  let allCards = [];
  for (const card of primaryExpanded) {
    seenLocalIds.add(card.localId);
    allCards.push(card);
  }
  console.log(`  Added ${primaryExpanded.length} cards from ${primaryScrydexId} (${seenLocalIds.size} total)`);

  // Step 2: EB split cards — only fetch the specific range for this set
  const ebSplit = EB_SPLIT[SET_ID.toLowerCase()] || {};
  for (const [ebExpansionId, range] of Object.entries(ebSplit)) {
    const rawEntries = await fetchEBCards(ebExpansionId, range.start, range.end);
    const expanded = expandEBCards(rawEntries);
    let added = 0;
    for (const card of expanded) {
      if (seenLocalIds.has(card.localId)) continue;
      seenLocalIds.add(card.localId);
      allCards.push(card);
      added++;
    }
    console.log(`  Added ${added} unique cards from ${ebExpansionId} (${range.start}-${range.end})`);
  }

  // Apply rarity overrides
  const rarityOverrides = RARITY_OVERRIDES[SET_ID.toLowerCase()] || {};
  if (Object.keys(rarityOverrides).length > 0) {
    allCards.forEach(c => {
      if (rarityOverrides[c.localId]) {
        console.log(`  Rarity override: ${c.localId} ${c.rarity} -> ${rarityOverrides[c.localId]}`);
        c.rarity = rarityOverrides[c.localId];
      }
    });
  }

  // Rarity breakdown
  const rarityCounts = {};
  allCards.forEach(c => { rarityCounts[c.rarity] = (rarityCounts[c.rarity] || 0) + 1; });
  const officialCount = allCards.filter(c => !c.isVariant).length;
  console.log(`\n✅ ${allCards.length} total entries (${officialCount} base + ${allCards.length - officialCount} variants):`);
  Object.entries(rarityCounts).sort((a,b) => b[1]-a[1]).forEach(([r,n]) => console.log(`   ${r}: ${n}`));

  // Step 3: Upload metadata JSON
  console.log('\n📦 Uploading metadata JSON...');
  await uploadToR2(`data/op/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, game: 'onepiece', phase: PHASE,
    cardCount: { official: officialCount, total: allCards.length },
    cards: allCards.map(c => ({
      localId:     c.localId,
      name:        c.name,
      rarity:      c.rarity,
      isVariant:   c.isVariant || false,
      variantType: c.variantType || null,
      baseLocalId: c.baseLocalId || null,
    })),
  }), 'application/json');
  console.log(`✅ data/op/${SET_ID}.json uploaded`);

  if (SKIP_IMAGES) { console.log('\n⏭️  Skipping image sync\n🎉 Done!'); return; }

  // Step 4: Sync images
  console.log(`\n🖼️  Syncing ${allCards.length} card images...`);
  let uploaded = 0, skipped = 0, failed = 0;
  for (const card of allCards) {
    const r2Key = `cards/op/${SET_ID}/${card.localId}.webp`;
    const overrideUrl = imageOverrides[card.localId];
    const forceThis = overrideUrl ? true : FORCE_RESYNC;
    if (!forceThis && await existsInR2(r2Key)) { process.stdout.write('.'); skipped++; continue; }
    const imageUrl = overrideUrl || card.image;
    if (!imageUrl) { process.stdout.write('-'); failed++; continue; }
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await resizeImage(Buffer.from(await res.arrayBuffer()));
      await uploadToR2(r2Key, buf, 'image/webp');
      process.stdout.write(overrideUrl ? 'O' : '+');
      uploaded++;
    } catch(e) {
      console.error(`\n  ✗ FAILED: ${card.localId} | ${imageUrl} | ${e.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`\n✅ ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);

  // Step 5: Logo
  try {
    const res = await fetchWithRetry(`${SCRYDEX_BASE}/expansions/${primaryScrydexId}`, { headers: HEADERS });
    const exp = res.data || {};
    const logoUrl = exp.logo || exp.images?.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) {
        const rawBuf = Buffer.from(await img.arrayBuffer());
        const resizedLogo = await sharp(rawBuf).resize(300, null, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
        await uploadToR2(`logos/op/${SET_ID}.webp`, resizedLogo, 'image/webp');
        await uploadToR2(`logos/op/${SET_ID}.png`, rawBuf, 'image/png');
        console.log(`✅ Logo uploaded (WebP + PNG)`);
      }
    }
  } catch(e) { console.warn('⚠️ Logo failed:', e.message); }

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
