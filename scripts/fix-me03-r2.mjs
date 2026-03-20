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

function localId(scrydexId) {
  const raw = scrydexId ? scrydexId.split('-').slice(1).join('-') : '';
  return raw.includes('/') ? raw.split('/')[0].trim() : raw;
}

const RARITY = {
  'C':'Common','U':'Uncommon','R':'Rare','RR':'Double Rare',
  'SR':'Ultra Rare','AR':'Illustration Rare','SAR':'Special Illustration Rare',
  'HR':'Hyper Rare','MUR':'Mega Ultra Rare',
  'Common':'Common','Uncommon':'Uncommon','Rare':'Rare',
  'Double Rare':'Double Rare','Ultra Rare':'Ultra Rare',
  'Art Rare':'Illustration Rare','Illustration Rare':'Illustration Rare',
  'Special Art Rare':'Special Illustration Rare','Special Illustration Rare':'Special Illustration Rare',
  'Super Rare':'Ultra Rare','Hyper Rare':'Hyper Rare','Mega Ultra Rare':'Mega Ultra Rare',
  'コモン':'Common','通常':'Common','アンコモン':'Uncommon','非':'Uncommon',
  'レア':'Rare','希少':'Rare','スーパーレア':'Double Rare','ダブルレア':'Double Rare',
  'ウルトラレア':'Ultra Rare','アートレア':'Illustration Rare',
  'スペシャルアートレア':'Special Illustration Rare',
  'ハイパーレア':'Hyper Rare','ゴールデンレア':'Hyper Rare','超ウルトラレア':'Mega Ultra Rare',
};

async function main() {
  console.log('\n🔧 fix-me03-r2\n');

  // Use /ja/ URL prefix — this enables the translation.en fields per Scrydex docs
  console.log('📋 Fetching JP cards via /ja/ endpoint (includes translation.en)...');
  let page = 1, all = [];
  while (true) {
    const url = `https://api.scrydex.com/pokemon/v1/ja/expansions/${JP_ID}/cards?select=id,name,translation,rarity,images&pageSize=100&page=${page}`;
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    if (page === 1 && cards[0]) {
      console.log(`  Fields on first card: ${Object.keys(cards[0]).join(', ')}`);
      console.log(`  name="${cards[0].name}" translation.en.name="${cards[0].translation?.en?.name}"`);
    }
    console.log(`  Page ${page}: ${cards.length} cards`);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`✅ ${all.length} cards fetched`);

  const cards = all.map(c => ({
    localId: localId(c.id),
    name:    c.translation?.en?.name || c.name || '',
    rarity:  RARITY[c.translation?.en?.rarity?.trim()] || RARITY[c.rarity?.trim()] || c.rarity || '',
  }));

  console.log('\nSample:');
  [1, 21, 111, 112, 113, 115, 117].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: "${c.name}" (${c.rarity})`);
  });

  const enCount = cards.filter(c => !/[\u3000-\u9fff]/.test(c.name)).length;
  console.log(`\n✅ ${enCount}/${cards.length} cards have EN names`);

  await upload(`data/${SET_ID}.json`, JSON.stringify({
    setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards,
  }), 'application/json');

  // Logo — fetch from Scrydex expansion
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers: HEADERS });
    const exp = (await res.json()).data || {};
    console.log(`  Logo fields: ${Object.keys(exp).join(', ')}`);
    const logoUrl = exp.logo || exp.images?.logo || exp.images?.symbol || null;
    console.log(`  Logo URL: ${logoUrl}`);
    if (logoUrl) {
      const img = await fetch(logoUrl);
      if (img.ok) {
        await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png');
        console.log('✅ Logo uploaded from Scrydex');
        console.log('\n🎉 Done!');
        return;
      }
    }
  } catch(e) { console.warn('  Scrydex logo failed:', e.message); }

  // Fallback logo
  try {
    const img = await fetch('https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png');
    if (img.ok) {
      await upload(`logos/${SET_ID}.png`, Buffer.from(await img.arrayBuffer()), 'image/png');
      console.log('✅ Logo uploaded from fallback');
    }
  } catch(e) { console.warn('⚠️ Logo failed'); }

  console.log('\n🎉 Done!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
