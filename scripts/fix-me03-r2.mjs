#!/usr/bin/env node
/**
 * fix-me03-r2.mjs
 * Fetches m3_ja cards WITHOUT language param (returns EN names by default).
 * Card IDs are m3_ja-1, m3_ja-21 etc (no slash suffix).
 */
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
  // id = "m3_ja-21" → "21", or "m3_ja-111/088" → "111"
  const raw = id ? id.split('-').slice(1).join('-') : '';
  return raw.includes('/') ? raw.split('/')[0].trim() : raw;
}

const RARITY_MAP = {
  'C':'Common','コモン':'Common',
  'U':'Uncommon','アンコモン':'Uncommon',
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

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  // Fetch WITHOUT language param — Scrydex returns EN names by default
  console.log('📋 Fetching cards (no language param = EN names)...');
  let page = 1, all = [];
  while (true) {
    const res = await fetch(
      `https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}/cards?select=id,name,rarity,images&pageSize=100&page=${page}`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    console.log(`  Page ${page}: ${cards.length} cards — first name: "${cards[0]?.name}"`);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`\n✅ ${all.length} cards total`);

  const cards = all.map(c => {
    const localId = extractLocalId(c.id);
    const name    = isJapanese(c.name) ? c.name : c.name; // log either way
    return { localId, name: c.name || '', rarity: norm(c.rarity) };
  });

  console.log('\nSample:');
  [1, 21, 23, 24, 111, 112, 113].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: "${c.name}" (${c.rarity}) — JP? ${isJapanese(c.name)}`);
  });

  const jpCount   = cards.filter(c => isJapanese(c.name)).length;
  const enCount   = cards.filter(c => !isJapanese(c.name)).length;
  console.log(`\n📊 EN names: ${enCount}, JP names: ${jpCount}`);

  await upload(`data/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards
  }), 'application/json');

  // Logo
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers: HEADERS });
    const exp = ((await res.json()).data) || {};
    const logoUrl = exp.logo || exp.images?.logo || null;
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) { await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png'); return; }
    }
  } catch(e) {}
  const img = await fetch('https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png');
  if (img.ok) await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png');

  console.log(`\n🎉 Done!`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
