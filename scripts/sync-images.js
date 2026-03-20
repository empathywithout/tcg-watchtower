// scripts/sync-images.js
// Downloads card images + full card metadata for a set, uploads everything to Cloudflare R2.
//
// EN phase (default):  pulls from TCGdex EN → uploads to R2 under setId
// JP phase:            pulls from Scrydex JP → uploads to R2 under setId
//                      (same R2 slot so the page works seamlessly after EN switch)
//
// Usage:
//   SET_ID=sv07 node scripts/sync-images.js
//   SET_ID=sv11 PHASE=jp JP_SCRYDEX_ID=sv9b node scripts/sync-images.js
//   SET_ID=sv11 PHASE=en node scripts/sync-images.js   ← after EN release

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const SET_ID           = (process.env.SET_ID      || '').trim();
const PHASE            = (process.env.PHASE        || 'en').trim();   // 'en' | 'jp'
const JP_SCRYDEX_ID    = (process.env.JP_SCRYDEX_ID || '').trim();    // e.g. 'sv9b'
const FORCE_RESYNC     = (process.env.FORCE_RESYNC  || '').toLowerCase() === 'true';

const SCRYDEX_API_KEY  = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID  = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE     = 'https://api.scrydex.com/pokemon/v1';

if (!SET_ID) { console.error('❌ SET_ID required'); process.exit(1); }
if (PHASE === 'jp' && !JP_SCRYDEX_ID) { console.error('❌ JP_SCRYDEX_ID required when PHASE=jp'); process.exit(1); }
if (PHASE === 'jp' && (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID)) { console.error('❌ SCRYDEX_API_KEY and SCRYDEX_TEAM_ID required when PHASE=jp'); process.exit(1); }

// Card display dimensions — 2× for retina
const CARD_WIDTH  = 400;
const CARD_HEIGHT = 557;

// TCGdex dot-notation map
const TCGDEX_ID_MAP = {
  'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5','me02pt5':'me02.5',
};
const TCGDEX_SET_ID  = TCGDEX_ID_MAP[SET_ID] || SET_ID;
const SERIES_PREFIX  = TCGDEX_SET_ID.replace(/[^a-z]/gi,'').toLowerCase().replace(/\d.*$/,'') || 'sv';

const s3 = new S3Client({
  region:      'auto',
  endpoint:    process.env.CF_R2_ENDPOINT,
  credentials: { accessKeyId: process.env.CF_R2_ACCESS_KEY, secretAccessKey: process.env.CF_R2_SECRET_KEY },
});
const BUCKET = process.env.CF_R2_BUCKET;

async function existsInR2(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function uploadToR2(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TCGWatchtower/1.0' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(timeout); }
}

async function resizeCardImage(buffer) {
  return sharp(buffer)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 }, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fetch cards from Scrydex (JP or EN) ─────────────────────────────────────
async function fetchCardsFromScrydex(scrydexId, language = 'JA') {
  console.log(`📋 Fetching ${language} card list from Scrydex (${scrydexId})…`);
  const headers   = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };
  const langParam = language === 'JA' ? '&languageCode=JA' : '';
  let allCards    = [];
  let page        = 1;
  let total       = null;

  while (true) {
    const url  = `${SCRYDEX_BASE}/expansions/${scrydexId}/cards?select=id,name,rarity,images&pageSize=100${langParam}&page=${page}`;
    const data = await fetchWithRetry(url, { headers });
    const pageCards = data.data || [];
    // Always read totalCount from first page
    if (total === null) total = data.totalCount || data.total || null;
    allCards = allCards.concat(pageCards);
    console.log(`  Page ${page}: got ${pageCards.length} cards (total so far: ${allCards.length}${total ? ` / ${total}` : ''})`);
    // Stop if: got fewer than pageSize, OR we've hit the total, OR got 0
    if (pageCards.length === 0) break;
    if (pageCards.length < 100) break;
    if (total !== null && allCards.length >= total) break;
    page++;
  }

  console.log(`✅ Scrydex returned ${allCards.length} ${language} cards`);
  return allCards.map(c => ({
    localId: c.id ? c.id.split('-').slice(1).join('-') : '',
    name:    c.name    || '',
    rarity:  c.rarity  || null,
    image:   c.images?.[0]?.large || c.images?.[0]?.medium || c.images?.[0]?.small || null,
  }));
}

// ── Fetch EN name map from TCGCSV (most reliable source post-release) ────────
async function fetchEnNameMapFromTCGCSV(setId) {
  const GROUP_ID_MAP = {
    'sv01':'22873','sv02':'23120','sv03':'23228','sv3pt5':'23237',
    'sv04':'23286','sv4pt5':'23353','sv05':'23381','sv06':'23473',
    'sv6pt5':'23529','sv07':'23537','sv08':'23651','sv8pt5':'23821',
    'sv09':'24073','sv10':'24269',
    'me01':'24380','me02':'24448','me02pt5':'24541','me03':'24587','me04':'24655',
  };
  const groupId = GROUP_ID_MAP[setId];
  if (!groupId) return {};
  try {
    const res      = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`);
    const products = res.results || [];
    const map      = {};

    for (const p of products) {
      const ext      = p.extendedData || [];
      const numEntry = ext.find(e => e.name === 'Number');
      const cleanName = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
      if (!cleanName) continue;

      if (numEntry) {
        // Has card number — use it for precise matching
        const num = numEntry.value.split('/')[0].trim();
        map[num.padStart(3, '0')]      = cleanName;
        map[String(parseInt(num, 10))] = cleanName;
        map[num]                       = cleanName;
      } else {
        // Pre-release set — no Number in extendedData yet
        // Store by productId so we can try matching later
        map[`pid_${p.productId}`] = { name: cleanName, productId: p.productId };
      }
    }

    // If no numbered entries found, TCGplayer hasn't assigned numbers yet
    // Fall back to ordered matching by product name only
    const numberedCount = Object.keys(map).filter(k => !k.startsWith('pid_')).length;
    console.log(`✅ EN name map from TCGCSV: ${numberedCount} numbered cards, ${products.length} total products`);
    return map;
  } catch (e) {
    console.warn(`⚠️  TCGCSV name map failed: ${e.message}`);
    return {};
  }
}

// ── EN phase: fetch cards from TCGdex ────────────────────────────────────────
async function fetchCardsFromTCGdex() {
  console.log(`📋 Fetching EN card list from TCGdex (${TCGDEX_SET_ID})…`);
  const setData    = await fetchWithRetry(`https://api.tcgdex.net/v2/en/sets/${TCGDEX_SET_ID}`);
  const briefCards = setData.cards || [];
  console.log(`✅ TCGdex: ${briefCards.length} cards in ${setData.name}`);

  const fullCards = [];
  for (let i = 0; i < briefCards.length; i++) {
    const brief = briefCards[i];
    process.stdout.write(`[${i+1}/${briefCards.length}] ${brief.name}… `);
    try {
      const cardId = brief.id || `${TCGDEX_SET_ID}-${brief.localId}`;
      const card   = await fetchWithRetry(`https://api.tcgdex.net/v2/en/cards/${cardId}`);
      const imgUrl = brief.image ? `${brief.image}/high.webp` : null;
      fullCards.push({ localId: brief.localId, name: card.name, rarity: card.rarity || null, image: imgUrl });
      console.log(`✅ (${card.rarity || 'no rarity'})`);
    } catch (err) {
      console.log(`⚠️  metadata failed: ${err.message}`);
      fullCards.push({ localId: brief.localId, name: brief.name, rarity: null, image: brief.image ? `${brief.image}/high.webp` : null });
    }
    await sleep(100);
  }
  return fullCards;
}

async function main() {
  console.log(`\n🚀 sync-images — SET_ID=${SET_ID} PHASE=${PHASE}`);
  if (PHASE === 'jp') console.log(`   JP Scrydex ID: ${JP_SCRYDEX_ID}`);
  if (FORCE_RESYNC)   console.log(`   ⚠️  Force resync — all images re-downloaded`);

  // Step 1 — Fetch card list
  // For JP: always Scrydex, then translate names to English
  // For EN: try Scrydex first (more complete, faster after release), fall back to TCGdex
  let cards = [];
  if (PHASE === 'jp') {
    cards = await fetchCardsFromScrydex(JP_SCRYDEX_ID);

    // Translate JP names → EN using TCGCSV
    console.log(`\n🔤 Fetching EN names from TCGCSV…`);
    const enMap = await fetchEnNameMapFromTCGCSV(SET_ID);
    const numberedEntries = Object.keys(enMap).filter(k => !k.startsWith('pid_'));

    if (numberedEntries.length > 0) {
      // TCGCSV has card numbers — match by localId
      let translated = 0;
      cards = cards.map(c => {
        const enName = enMap[c.localId] || enMap[String(parseInt(c.localId, 10))] || null;
        if (enName) { translated++; return { ...c, name: enName }; }
        return c;
      });
      console.log(`✅ Translated ${translated}/${cards.length} card names to English (by number)`);
    } else if (Object.keys(enMap).length > 0) {
      // Pre-release: no numbers yet — match by position order
      const pidEntries = Object.values(enMap)
        .filter(v => typeof v === 'object' && v.productId)
        .sort((a, b) => a.productId - b.productId);

      if (pidEntries.length > 0) {
        let translated = 0;
        cards = cards.map((c, i) => {
          if (pidEntries[i]) { translated++; return { ...c, name: pidEntries[i].name }; }
          return c;
        });
        console.log(`✅ Translated ${translated}/${cards.length} card names to English (by position)`);
      } else {
        console.warn(`⚠️  No EN names could be mapped — keeping JP names`);
      }
    } else {
      console.warn(`⚠️  No EN names available yet — keeping JP names as fallback`);
    }
  } else {
    // Try Scrydex EN first if we have credentials and a mapped ID
    const SCRYDEX_EN_ID_MAP = {
      'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
      'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
      'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
      'sv09':'sv09','sv10':'sv10',
      'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03','me04':'me04',
    };
    const scrydexEnId = SCRYDEX_EN_ID_MAP[SET_ID];
    if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID && scrydexEnId) {
      console.log(`📋 Trying Scrydex EN first for ${SET_ID} (${scrydexEnId})…`);
      try {
        cards = await fetchCardsFromScrydex(scrydexEnId, 'EN');
        if (cards.length > 0) {
          console.log(`✅ Scrydex EN returned ${cards.length} cards`);
        } else {
          console.warn(`⚠️  Scrydex EN returned 0 cards — falling back to TCGdex`);
          cards = await fetchCardsFromTCGdex();
        }
      } catch (e) {
        console.warn(`⚠️  Scrydex EN failed: ${e.message} — falling back to TCGdex`);
        cards = await fetchCardsFromTCGdex();
      }
    } else {
      cards = await fetchCardsFromTCGdex();
    }
  }

  if (!cards.length) { console.error('❌ No cards returned'); process.exit(1); }

  // Step 2 — Upload set logo
  console.log(`\n🎨 Uploading set logo…`);
  const logoR2Key = `logos/${SET_ID}.png`;
  let logoUploaded = false;

  if (PHASE === 'jp') {
    // Scrydex JP logo
    try {
      const headers   = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };
      const expansion = await fetchWithRetry(`${SCRYDEX_BASE}/expansions/${JP_SCRYDEX_ID}`, { headers });
      console.log(`  Scrydex expansion fields: ${Object.keys(expansion).join(', ')}`);
      const logoUrl = expansion.logo
        || expansion.images?.logo
        || expansion.images?.symbol
        || expansion.logoUrl
        || null;
      if (logoUrl) {
        const buf = await downloadImage(logoUrl);
        await uploadToR2(logoR2Key, buf, 'image/png');
        console.log(`✅ JP logo uploaded from ${logoUrl}`);
        logoUploaded = true;
      } else {
        console.warn(`⚠️  No logo URL found in Scrydex expansion response`);
      }
    } catch (e) { console.warn(`⚠️  JP logo failed: ${e.message}`); }
  } else if (SCRYDEX_API_KEY && SCRYDEX_TEAM_ID) {
    // Scrydex EN logo — try this first, more reliable than TCGdex for new sets
    const SCRYDEX_EN_ID_MAP_LOGO = {
      'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
      'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
      'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
      'sv09':'sv09','sv10':'sv10',
      'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03','me04':'me04',
    };
    const scrydexEnId = SCRYDEX_EN_ID_MAP_LOGO[SET_ID];
    if (scrydexEnId) {
      try {
        const headers   = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };
        const expansion = await fetchWithRetry(`${SCRYDEX_BASE}/expansions/${scrydexEnId}`, { headers });
        console.log(`  Scrydex expansion fields: ${Object.keys(expansion).join(', ')}`);
        const logoUrl = expansion.logo
          || expansion.images?.logo
          || expansion.images?.symbol
          || expansion.logoUrl
          || null;
        if (logoUrl) {
          const buf = await downloadImage(logoUrl);
          await uploadToR2(logoR2Key, buf, 'image/png');
          console.log(`✅ EN logo uploaded from Scrydex: ${logoUrl}`);
          logoUploaded = true;
        } else {
          console.warn(`⚠️  No logo URL found in Scrydex EN expansion response`);
        }
      } catch (e) { console.warn(`⚠️  Scrydex EN logo failed: ${e.message}`); }
    }
  }

  if (!logoUploaded) {
    // TCGdex EN logo fallback
    const stripped  = TCGDEX_SET_ID.replace(/^([a-z]+)0(\d)$/, '$1$2');
    const logoUrls  = [
      `https://assets.tcgdex.net/en/${SERIES_PREFIX}/${TCGDEX_SET_ID}/logo.png`,
      `https://assets.tcgdex.net/en/${SERIES_PREFIX}/${stripped}/logo.png`,
    ];
    for (const url of logoUrls) {
      try {
        const buf = await downloadImage(url);
        await uploadToR2(logoR2Key, buf, 'image/png');
        console.log(`✅ EN logo uploaded from TCGdex: ${url}`);
        logoUploaded = true;
        break;
      } catch (e) { console.warn(`  ⚠️  Logo failed at ${url}: ${e.message}`); }
    }
    if (!logoUploaded) console.warn(`⚠️  All logo sources failed — page will show no logo`);
  }

  // Step 3 — Upload metadata JSON
  console.log(`\n📦 Uploading metadata JSON…`);
  const metadata = {
    id: SET_ID, phase: PHASE,
    cardCount: { official: cards.length, total: cards.length },
    cards: cards.map(c => ({ localId: c.localId, name: c.name, rarity: c.rarity })),
  };
  await uploadToR2(`data/${SET_ID}.json`, JSON.stringify(metadata), 'application/json');
  console.log(`✅ Metadata saved to R2 data/${SET_ID}.json`);

  // Step 4 — Download, resize, upload card images
  console.log(`\n🖼️  Syncing ${cards.length} card images…`);
  let uploaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < cards.length; i++) {
    const card   = cards[i];
    const r2Key  = `cards/${SET_ID}/${card.localId}.webp`;
    process.stdout.write(`[${i+1}/${cards.length}] ${card.name} (${card.localId})… `);

    if (!FORCE_RESYNC && await existsInR2(r2Key)) {
      console.log('⏭️  skip (exists)');
      skipped++;
      continue;
    }

    if (!card.image) {
      // Build fallback URL for EN sets
      const fallbackUrl = `https://assets.tcgdex.net/en/${SERIES_PREFIX}/${TCGDEX_SET_ID}/${card.localId}/high.webp`;
      card.image = fallbackUrl;
    }

    try {
      const buf     = await downloadImage(card.image);
      const resized = await resizeCardImage(buf);
      await uploadToR2(r2Key, resized, 'image/webp');
      console.log('✅');
      uploaded++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      failed++;
    }
    await sleep(50);
  }

  console.log(`\n✅ Done — ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);
  console.log(`   R2 path: cards/${SET_ID}/*.webp`);
  if (PHASE === 'jp') {
    console.log(`\n💡 When EN releases:`);
    console.log(`   1. Update sets.json: "phase": "en", add tcgpGroupId`);
    console.log(`   2. Run: SET_ID=${SET_ID} PHASE=en node scripts/sync-images.js`);
    console.log(`   3. Redeploy — same URL, prices now load automatically`);
  }
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
