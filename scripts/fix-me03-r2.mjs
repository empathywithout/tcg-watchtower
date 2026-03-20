#!/usr/bin/env node
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SET_ID = 'me03';
const JP_ID  = 'm3_ja';
const EN_ID  = 'me03';  // Scrydex EN expansion ID

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

const HEADERS = {
  'X-Api-Key': process.env.SCRYDEX_API_KEY,
  'X-Team-ID': process.env.SCRYDEX_TEAM_ID,
};

async function fetchCards(expansionId, language) {
  console.log(`📋 Fetching ${language} cards from Scrydex (${expansionId})...`);
  let page = 1, all = [];
  while (true) {
    const res = await fetch(
      `https://api.scrydex.com/pokemon/v1/expansions/${expansionId}/cards?select=id,name,rarity,images&pageSize=100&language=${language}&page=${page}`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    console.log(`  Page ${page}: ${cards.length} cards (total: ${all.length})`);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`✅ Got ${all.length} ${language} cards`);
  return all;
}

function extractLocalId(scrydexId) {
  const rawId = scrydexId ? scrydexId.split('-').slice(1).join('-') : '';
  return rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
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

async function fetchLogo() {
  try {
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers: HEADERS });
    const exp = (await res.json()).data || {};
    const logoUrl = exp.logo || exp.images?.logo || exp.images?.symbol || null;
    if (logoUrl) {
      const imgRes = await fetch(logoUrl);
      if (imgRes.ok) {
        await upload(`logos/${SET_ID}.png`, Buffer.from(await imgRes.arrayBuffer()), 'image/png');
        return;
      }
    }
  } catch (e) {}
  // Fallback logo
  try {
    const imgRes = await fetch('https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png');
    if (imgRes.ok) await upload(`logos/${SET_ID}.png`, Buffer.from(await imgRes.arrayBuffer()), 'image/png');
  } catch (e) { console.warn('⚠️  Logo failed'); }
}

async function main() {
  console.log(`\n🔧 fix-me03-r2\n`);

  // Fetch EN cards for names, JP cards for images/rarity
  const [enCards, jpCards] = await Promise.all([
    fetchCards(EN_ID, 'EN'),
    fetchCards(JP_ID, 'JA'),
  ]);

  // Build EN name map: localId → name
  const enByLocalId = {};
  for (const c of enCards) {
    const localId = extractLocalId(c.id);
    if (localId && c.name) enByLocalId[localId] = c.name;
  }
  console.log(`\n✅ EN name map: ${Object.keys(enByLocalId).length} entries`);

  // Merge: use JP images/rarity but EN names
  const cards = jpCards.map(c => {
    const localId = extractLocalId(c.id);
    const name    = enByLocalId[localId] || c.name || '';
    const rarity  = norm(c.rarity);
    return { localId, name, rarity };
  });

  console.log('\nSample mappings:');
  [1, 21, 97, 111, 112, 113, 115].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: ${c.name} (${c.rarity})`);
  });

  const metadata = { setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards };
  await upload(`data/${SET_ID}.json`, JSON.stringify(metadata), 'application/json');
  await fetchLogo();
  console.log(`\n🎉 Done! ${cards.length} cards written to R2.`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
