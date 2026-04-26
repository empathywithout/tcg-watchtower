#!/usr/bin/env node
/**
 * sync-op-images.mjs
 * Syncs One Piece TCG card images and metadata to R2
 *
 * Strategy:
 * - Fetches TCGCSV to detect all card numbers in the TCGplayer group
 * - Primary expansion only (e.g. OP15): full Scrydex fetch
 * - Everything else (EB04, PRB02, OP11 SPs etc): fetch only the specific cards present in the group
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

function parseLocalId(rawId) {
  if (!rawId) return '';
  const stripped = rawId.split('-').slice(1).join('-');
  return stripped.includes('/') ? stripped.split('/')[0].trim() : stripped;
}

function pickImage(images) {
  if (!images || !images.length) return null;
  return images[0]?.large || images[0]?.medium || images[0]?.small || null;
}

function extractPrefix(numberStr) {
  if (!numberStr) return null;
  const match = numberStr.match(/^([A-Z]+\d+)-/);
  return match ? match[1] : null;
}

/**
 * Fetch TCGplayer group from TCGCSV.
 * Returns { prefix -> Set<cardNumber> } for all non-primary expansions.
 * e.g. { EB04: Set{'042','043','044',...}, PRB02: Set{'006'}, OP11: Set{'106'} }
 */
async function getGroupInfo(groupId, primaryId) {
  const url = `https://tcgcsv.com/tcgplayer/68/${groupId}/products`;
  console.log(`🔍 Fetching TCGplayer group ${groupId} from TCGCSV...`);

  let data;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TCGWatchtower/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.warn(`⚠️  TCGCSV fetch failed: ${e.message} — will use primary expansion only`);
    return {};
  }

  const products = data.results || [];
  const prefixMap = {};

  for (const product of products) {
    const extData = product.extendedData || [];
    const numberEntry = extData.find(d => d.name === 'Number');
    if (!numberEntry) continue;
    const fullNumber = numberEntry.value;
    const prefix = extractPrefix(fullNumber);
    // Skip primary — it gets a full fetch separately
    if (!prefix || prefix === primaryId || !SCRYDEX_KNOWN_EXPANSIONS.has(prefix)) continue;
    const cardNum = fullNumber.split('-')[1];
    if (!prefixMap[prefix]) prefixMap[prefix] = new Set();
    prefixMap[prefix].add(cardNum);
  }

  const summary = Object.entries(prefixMap)
    .sort((a,b) => b[1].size - a[1].size)
    .map(([p, s]) => `${p}(${s.size})`)
    .join(', ');
  console.log(`✅ Non-primary expansions: ${summary || 'none'}`);
  return prefixMap;
}

/**
 * Fetch all cards from a Scrydex expansion (primary set only).
 */
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

  // Fallback to expansion endpoint
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

/**
 * Fetch only specific card numbers from a Scrydex expansion.
 * Used for EB04, PRB02, cross-set SPs etc — only pulls the cards
 * that actually appear in the TCGplayer group.
 */
async function fetchSpecificCards(expansionId, cardNumbers) {
  console.log(`\n📋 Individual fetch: ${expansionId} — ${cardNumbers.size} card(s): ${[...cardNumbers].slice(0,10).join(', ')}${cardNumbers.size > 10 ? '...' : ''}`);
  const results = [];

  for (const num of [...cardNumbers].sort()) {
    const cardId = `${expansionId}-${num}`;
    try {
      const url = `${SCRYDEX_BASE}/cards/${cardId}?select=id,name,rarity,variants,images`;
      const data = await fetchWithRetry(url, { headers: HEADERS });
      if (data.data) {
        results.push(data.data);
        process.stdout.write('.');
      }
    } catch (e) {
      process.stdout.write('✗');
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(` (${results.length}/${cardNumbers.size} found)`);
  return results;
}

/**
 * Expand raw Scrydex cards into base + variant entries.
 */
function expandCards(rawCards, expansionId) {
  const cards = [];

  for (const c of rawCards) {
    const baseLocalId = parseLocalId(c.id);
    const baseRarity  = normalizeRarity(c.rarity);
    const baseImage   = pickImage(c.images);
    const variants    = c.variants || [];

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
      if (vPrintings.length > 0 && !vPrintings.includes(expansionId.toUpperCase())) continue;

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

      const variantImage   = pickImage(v.images) || baseImage;
      const suffix         = variantSuffix(vType);
      const variantLocalId = `${baseLocalId}_${suffix}`;
      const variantName    = `${(c.name||'').trim()} (${vType})`;

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

  return cards;
}

async function main() {
  if (!SET_ID || !SET_FULL_NAME) {
    console.error('❌ SET_ID and SET_FULL_NAME are required');
    process.exit(1);
  }

  const primaryScrydexId = SCRYDEX_ID_MAP[SET_ID.toLowerCase()] || SET_ID.toUpperCase();
  console.log(`\n🏴‍☠️ Syncing One Piece: ${SET_FULL_NAME} (${SET_ID}) — Primary: ${primaryScrydexId}\n`);

  // Step 1: Get non-primary card numbers from TCGCSV
  let individualFetchMap = {};
  if (TCGP_GROUP_ID) {
    individualFetchMap = await getGroupInfo(TCGP_GROUP_ID, primaryScrydexId);
  }

  // Step 2: Full fetch for primary expansion
  const seenLocalIds = new Set();
  let allCards = [];

  let primaryRaw;
  try { primaryRaw = await fetchFullExpansion(primaryScrydexId); }
  catch (e) { console.error(`❌ Primary expansion fetch failed: ${e.message}`); process.exit(1); }

  const primaryExpanded = expandCards(primaryRaw, primaryScrydexId);
  for (const card of primaryExpanded) {
    if (!seenLocalIds.has(card.localId)) { seenLocalIds.add(card.localId); allCards.push(card); }
  }
  console.log(`  Added ${primaryExpanded.length} cards from ${primaryScrydexId} (${seenLocalIds.size} total)`);

  // Step 3: Individual fetches for all other expansions
  for (const [expId, cardNums] of Object.entries(individualFetchMap)) {
    let rawCards;
    try { rawCards = await fetchSpecificCards(expId, cardNums); }
    catch (e) { console.warn(`⚠️  ${expId} failed: ${e.message}`); continue; }

    const expanded = expandCards(rawCards, expId);
    let added = 0;
    for (const card of expanded) {
      if (!seenLocalIds.has(card.localId)) { seenLocalIds.add(card.localId); allCards.push(card); added++; }
    }
    console.log(`  Added ${added} unique cards from ${expId}`);
  }

  // Rarity breakdown
  const rarityCounts = {};
  allCards.forEach(c => { rarityCounts[c.rarity] = (rarityCounts[c.rarity] || 0) + 1; });
  const officialCount = allCards.filter(c => !c.isVariant).length;
  console.log(`\n✅ ${allCards.length} total entries (${officialCount} base + ${allCards.length - officialCount} variants):`);
  Object.entries(rarityCounts).sort((a,b) => b[1]-a[1]).forEach(([r,n]) => console.log(`   ${r}: ${n}`));

  // Step 4: Upload metadata JSON
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

  if (SKIP_IMAGES) {
    console.log('\n⏭️  Skipping image sync');
    console.log('\n🎉 Done!');
    return;
  }

  // Step 5: Sync images
  console.log(`\n🖼️  Syncing ${allCards.length} card images...`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const card of allCards) {
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

  // Step 6: Logo
  try {
    const res = await fetchWithRetry(`${SCRYDEX_BASE}/expansions/${primaryScrydexId}`, { headers: HEADERS });
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
