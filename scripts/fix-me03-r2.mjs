#!/usr/bin/env node
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SET_ID       = 'me03';
const JP_ID        = 'm3_ja';
const TCGCSV_GROUP = '24587';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});

async function upload(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET,
    Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=3600',
  }));
  console.log(`✅ Uploaded ${key}`);
}

async function fetchEnNames() {
  console.log('📋 Fetching EN names from TCGCSV...');
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${TCGCSV_GROUP}/products`);
  const { results = [] } = await res.json();

  // Build BOTH maps: by productId AND by card number
  const byPid = {};
  const byNum = {};
  let minPid = Infinity, maxPid = 0;

  for (const p of results) {
    const name = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*[-\u2013]\s*\d+\/\d+\s*$/, '').trim();
    if (!name) continue;
    byPid[p.productId] = name;
    if (p.productId < minPid) minPid = p.productId;
    if (p.productId > maxPid) maxPid = p.productId;

    const numEntry = (p.extendedData || []).find(e => e.name === 'Number');
    if (numEntry) {
      const n = parseInt(numEntry.value.split('/')[0]);
      if (!isNaN(n)) byNum[n] = { name, productId: p.productId };
    }
  }

  console.log(`✅ ${results.length} products, productId range: ${minPid}–${maxPid}`);
  console.log(`   ${Object.keys(byNum).length} have card numbers`);

  // Show first and last few by productId order to understand the mapping
  const sorted = results
    .filter(p => (p.extendedData||[]).find(e=>e.name==='Number'))
    .sort((a,b) => a.productId - b.productId);

  console.log('\nFirst 5 numbered products:');
  sorted.slice(0,5).forEach(p => {
    const num = (p.extendedData||[]).find(e=>e.name==='Number');
    console.log(`  pid:${p.productId} card#:${num.value} → ${(p.name||'').substring(0,40)}`);
  });
  console.log('Last 5 numbered products:');
  sorted.slice(-5).forEach(p => {
    const num = (p.extendedData||[]).find(e=>e.name==='Number');
    console.log(`  pid:${p.productId} card#:${num.value} → ${(p.name||'').substring(0,40)}`);
  });

  return { byPid, byNum, minPid };
}

async function fetchJPCards() {
  console.log('\n📋 Fetching JP cards from Scrydex...');
  const headers = { 'X-Api-Key': process.env.SCRYDEX_API_KEY, 'X-Team-ID': process.env.SCRYDEX_TEAM_ID };
  let page = 1, all = [];
  while (true) {
    const res = await fetch(
      `https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}/cards?select=id,name,rarity,images&pageSize=100&language=JA&page=${page}`,
      { headers }
    );
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`✅ Got ${all.length} JP cards`);
  return all;
}

async function fetchLogo() {
  try {
    const headers = { 'X-Api-Key': process.env.SCRYDEX_API_KEY, 'X-Team-ID': process.env.SCRYDEX_TEAM_ID };
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers });
    const raw = await res.json();
    const exp = raw.data || raw;
    const logoUrl = exp.logo || exp.images?.logo || exp.images?.symbol || exp.logoUrl || null;
    if (logoUrl) {
      const imgRes = await fetch(logoUrl);
      if (imgRes.ok) {
        await upload(`logos/${SET_ID}.png`, Buffer.from(await imgRes.arrayBuffer()), 'image/png');
        return;
      }
    }
  } catch (e) {}
  try {
    const imgRes = await fetch('https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png');
    if (imgRes.ok) {
      await upload(`logos/${SET_ID}.png`, Buffer.from(await imgRes.arrayBuffer()), 'image/png');
    }
  } catch (e) { console.warn('⚠️  Logo failed'); }
}

const RARITY_MAP = {
  'C':'Common','コモン':'Common','通常':'Common',
  'U':'Uncommon','アンコモン':'Uncommon','非':'Uncommon',
  'R':'Rare','レア':'Rare',
  'RR':'Double Rare','スーパーレア':'Double Rare','ダブルレア':'Double Rare',
  'SR':'Ultra Rare','ウルトラレア':'Ultra Rare',
  'IR':'Illustration Rare','アートレア':'Illustration Rare',
  'SAR':'Special Illustration Rare','スペシャルアートレア':'Special Illustration Rare',
  'HR':'Hyper Rare','ハイパーレア':'Hyper Rare','ゴールデンレア':'Hyper Rare',
  'MHR':'Mega Hyper Rare','メガハイパーレア':'Mega Hyper Rare','超ウルトラレア':'Mega Hyper Rare',
};
function norm(r) { return RARITY_MAP[r?.trim()] || r || ''; }

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  const [{ byPid, byNum, minPid }, jpCards] = await Promise.all([fetchEnNames(), fetchJPCards()]);

  // Try all three strategies per card, log which works
  let byNumHits = 0, byPidHits = 0, fallbacks = 0;

  const cards = jpCards.map(c => {
    const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
    const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
    const cardNum = parseInt(localId, 10);

    // Strategy 1: direct card number match
    if (byNum[cardNum]) {
      byNumHits++;
      return { localId, name: byNum[cardNum].name, rarity: norm(c.rarity) };
    }

    // Strategy 2: productId offset (minPid + cardNum - 1)
    const pid = minPid + (cardNum - 1);
    if (byPid[pid]) {
      byPidHits++;
      return { localId, name: byPid[pid], rarity: norm(c.rarity) };
    }

    // Fallback: strip JP suffix
    fallbacks++;
    return {
      localId,
      name: (c.name || '').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*[-–—]\s*\d+\/\d+\s*$/, '').trim(),
      rarity: norm(c.rarity),
    };
  });

  console.log(`\nTranslation: ${byNumHits} by card#, ${byPidHits} by pid offset, ${fallbacks} fallbacks`);
  console.log('\nSample mappings:');
  [1, 21, 97, 111, 112, 113, 114, 115, 116].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: ${c.name} (${c.rarity})`);
  });

  const metadata = { setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards };
  await upload(`data/${SET_ID}.json`, JSON.stringify(metadata), 'application/json');
  await fetchLogo();
  console.log(`\n🎉 Done! ${cards.length} cards written.`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
