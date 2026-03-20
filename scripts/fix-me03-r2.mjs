#!/usr/bin/env node
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SET_ID = 'me03';
const JP_ID  = 'm3_ja';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});

const HEADERS = {
  'X-Api-Key': process.env.SCRYDEX_API_KEY,
  'X-Team-ID': process.env.SCRYDEX_TEAM_ID,
};

async function upload(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.CF_R2_BUCKET,
    Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=3600',
  }));
  console.log(`✅ Uploaded ${key}`);
}

function extractLocalId(id) {
  const raw = id ? id.split('-').slice(1).join('-') : '';
  return raw.includes('/') ? raw.split('/')[0].trim() : raw;
}

async function probeEnExpansion() {
  // Try different possible EN expansion IDs for Perfect Order
  const candidates = ['me03', 'm3', 'm3_en', 'perfect-order', 'nullifying-zero'];
  for (const id of candidates) {
    try {
      const res = await fetch(
        `https://api.scrydex.com/pokemon/v1/expansions/${id}/cards?pageSize=3&page=1`,
        { headers: HEADERS }
      );
      if (!res.ok) { console.log(`  ${id}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const cards = data.data || [];
      if (cards.length > 0) {
        console.log(`  ✅ ${id}: ${cards.length} cards, first name: "${cards[0].name}", id: "${cards[0].id}"`);
        return id;
      } else {
        console.log(`  ${id}: 0 cards returned`);
      }
    } catch(e) {
      console.log(`  ${id}: error - ${e.message}`);
    }
  }
  return null;
}

async function fetchAllCards(expansionId, language) {
  let page = 1, all = [];
  while (true) {
    const url = language
      ? `https://api.scrydex.com/pokemon/v1/expansions/${expansionId}/cards?select=id,name,rarity,images&pageSize=100&language=${language}&page=${page}`
      : `https://api.scrydex.com/pokemon/v1/expansions/${expansionId}/cards?select=id,name,rarity,images&pageSize=100&page=${page}`;
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    if (cards.length < 100) break;
    page++;
  }
  return all;
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
function isJapanese(s) { return /[\u3000-\u9fff\uff00-\uffef]/.test(s || ''); }
function stripSuffix(name) {
  return (name || '').replace(/\s*[-–—]\s*\d+\/\d+\s*$/, '').replace(/\s*\(.*?\)\s*$/, '').trim();
}

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  // Step 1: probe for EN expansion ID
  console.log('🔍 Probing Scrydex for EN expansion...');
  const enId = await probeEnExpansion();
  console.log(enId ? `\n✅ EN expansion found: ${enId}` : '\n⚠️  No EN expansion found — will use JP names stripped of suffix');

  // Step 2: fetch JP cards
  console.log('\n📋 Fetching JP cards (JA)...');
  const jpCards = await fetchAllCards(JP_ID, 'JA');
  console.log(`✅ ${jpCards.length} JP cards`);

  // Step 3: fetch EN names if found
  const enByLocalId = {};
  if (enId) {
    console.log(`\n📋 Fetching EN cards from ${enId}...`);
    const enCards = await fetchAllCards(enId, null); // no language param - use default
    console.log(`✅ ${enCards.length} EN cards`);
    // Log first 3 to verify names are English
    enCards.slice(0,3).forEach(c => console.log(`  sample: id="${c.id}" name="${c.name}"`));

    for (const c of enCards) {
      const localId = extractLocalId(c.id);
      if (localId && c.name && !isJapanese(c.name)) {
        enByLocalId[localId] = stripSuffix(c.name);
      }
    }
    console.log(`✅ ${Object.keys(enByLocalId).length} EN names mapped`);
  }

  // Step 4: build card list
  const cards = jpCards.map(c => {
    const localId = extractLocalId(c.id);
    const name    = enByLocalId[localId] || stripSuffix(c.name);
    return { localId, name, rarity: norm(c.rarity) };
  });

  console.log('\nSample:');
  [1, 21, 23, 24, 111, 112, 113].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: ${c.name} (${c.rarity})`);
  });

  // Step 5: upload
  await upload(`data/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards
  }), 'application/json');

  // Step 6: logo
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers: HEADERS });
    const exp = ((await res.json()).data) || {};
    const logoUrl = exp.logo || exp.images?.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) { await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png'); }
    } else {
      throw new Error('no logo url');
    }
  } catch(e) {
    const img = await fetch('https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png');
    if (img.ok) await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png');
  }

  console.log(`\n🎉 Done! ${cards.length} cards written.`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
