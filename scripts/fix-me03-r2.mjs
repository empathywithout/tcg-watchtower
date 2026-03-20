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

// Convert URL slug to display name
// "mega-starmie-ex" → "Mega Starmie ex"
// "rosas-encouragement" → "Rosa's Encouragement"
// "pok-pad" → "Poké Pad"
function slugToName(slug) {
  const OVERRIDES = {
    'pok-pad': 'Poké Pad',
    'rosas-encouragement': "Rosa's Encouragement",
    'chien-pao': 'Chien-Pao',
    'antique-jaw-fossil': 'Antique Jaw Fossil',
    'antique-sail-fossil': 'Antique Sail Fossil',
    'grow-grass-energy': 'Grow Grass Energy',
    'telepath-psychic-energy': 'Telepath Psychic Energy',
    'rock-fighting-energy': 'Rock Fighting Energy',
    'forest-of-vitality': 'Forest of Vitality',
    'lumiose-galette': 'Lumiose Galette',
    'lumiose-city': 'Lumiose City',
    'core-memory': 'Core Memory',
    'energy-swatter': 'Energy Swatter',
    'energy-recycler': 'Energy Recycler',
    'sacred-ash': 'Sacred Ash',
    'wondrous-patch': 'Wondrous Patch',
  };
  if (OVERRIDES[slug]) return OVERRIDES[slug];
  // Capitalize each word, keep "ex" lowercase
  return slug.split('-').map((w, i) => {
    if (w === 'ex') return 'ex';
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

const RARITY_MAP = {
  'C':'Common','コモン':'Common',
  'U':'Uncommon','アンコモン':'Uncommon','非':'Uncommon',
  'R':'Rare','レア':'Rare','希少':'Rare',
  'RR':'Double Rare','スーパーレア':'Double Rare','ダブルレア':'Double Rare',
  'SR':'Ultra Rare','ウルトラレア':'Ultra Rare',
  'AR':'Illustration Rare','アートレア':'Illustration Rare',
  'SAR':'Special Illustration Rare','スペシャルアートレア':'Special Illustration Rare',
  'HR':'Hyper Rare','ハイパーレア':'Hyper Rare','ゴールデンレア':'Hyper Rare',
  'MUR':'Mega Ultra Rare','超ウルトラレア':'Mega Ultra Rare',
};
function norm(r) { return RARITY_MAP[r?.trim()] || r || ''; }

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  // Fetch cards with slug field — the slug contains the EN name
  console.log('📋 Fetching cards with slug field...');
  let page = 1, all = [];
  while (true) {
    const res = await fetch(
      `https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}/cards?select=id,name,translations,rarity,images&pageSize=100&language=JA&page=${page}`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    const sample = cards[0];
    console.log(`  Page ${page}: ${cards.length} cards`);
    if (sample) console.log(`  First card fields: ${Object.keys(sample).join(', ')}`);
    if (sample) console.log(`  First card: id="${sample.id}" name="${sample.name}" slug="${sample.slug}"`);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`\n✅ ${all.length} cards`);

  const cards = all.map(c => {
    const localId = extractLocalId(c.id);
    // Use EN translation
    const name = c.translations?.en || c.name || '';
    return { localId, name, rarity: norm(c.rarity) };
  });

  console.log('\nSample:');
  [1, 21, 23, 111, 112, 115].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: "${c.name}" (${c.rarity})`);
  });

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

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
