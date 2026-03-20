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

async function fetchCards(language) {
  // Try different field combinations to get English names
  const selects = [
    'id,name,nameEn,localName,rarity,images',
    'id,name,rarity,images',
  ];
  
  let all = [];
  for (const select of selects) {
    let page = 1;
    all = [];
    while (true) {
      // Try with and without language param
      const langParam = language ? `&language=${language}` : '';
      const url = `https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}/cards?select=${select}&pageSize=100${langParam}&page=${page}`;
      const res = await fetch(url, { headers: HEADERS });
      const data = await res.json();
      const cards = data.data || [];
      all = all.concat(cards);
      if (cards.length < 100) break;
      page++;
    }
    
    // Check if we got English names
    const sample = all[0];
    if (sample) {
      const fields = Object.keys(sample);
      console.log(`  select="${select}" lang="${language||'none'}" → fields: ${fields.join(', ')}`);
      console.log(`  sample card: name="${sample.name}" nameEn="${sample.nameEn}" localName="${sample.localName}"`);
      // If any field has English, use this
      const hasEn = all.some(c => !isJapanese(c.nameEn || c.localName || ''));
      if (hasEn) {
        console.log(`  ✅ Found English names!`);
        return all;
      }
    }
  }
  return all;
}

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  // Try different language params
  let bestCards = [];
  for (const lang of ['EN', 'JA', null]) {
    console.log(`\n📋 Trying language=${lang||'none'}...`);
    const cards = await fetchCards(lang);
    if (cards.length > 0) {
      bestCards = cards;
      const sample = cards[0];
      // Check all name fields
      const nameFields = ['name','nameEn','localName','title','nameJa'];
      console.log('  Name fields on first card:');
      nameFields.forEach(f => { if (sample[f]) console.log(`    ${f}: "${sample[f]}"`); });
      break;
    }
  }

  console.log(`\n✅ Got ${bestCards.length} cards total`);

  // Build card list — find the best English name field
  const sample = bestCards[0] || {};
  const enField = ['nameEn','localName'].find(f => sample[f] && !isJapanese(sample[f])) || 'name';
  console.log(`Using name field: "${enField}"`);

  const cards = bestCards.map(c => {
    const localId = extractLocalId(c.id);
    const rawName = c[enField] || c.name || '';
    const name    = rawName.replace(/\s*[-–—]\s*\d+\/\d+\s*$/, '').replace(/\s*\(.*?\)\s*$/, '').trim();
    return { localId, name, rarity: norm(c.rarity) };
  });

  console.log('\nSample:');
  [1, 21, 23, 111, 112, 113].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: ${c.name} (${c.rarity})`);
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

  console.log(`\n🎉 Done! ${cards.length} cards written.`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
