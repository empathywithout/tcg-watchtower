#!/usr/bin/env node
/**
 * fix-me03-r2.mjs
 * Uses productId offset to map JP card numbers to EN names.
 * JP card N → productId = 674320 + (N - 1) → EN name from TCGCSV
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SET_ID        = 'me03';
const JP_ID         = 'm3_ja';
const TCGCSV_GROUP  = '24587';
const FIRST_PID     = 674320; // card 001 = product 674320 (confirmed from The Hobby Bin)

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

async function fetchEnNamesByProductId() {
  console.log('📋 Fetching EN names from TCGCSV (by productId)...');
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${TCGCSV_GROUP}/products`);
  const { results = [] } = await res.json();
  // Map productId → clean name
  const map = {};
  for (const p of results) {
    const name = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
    if (name) map[p.productId] = name;
  }
  console.log(`✅ Got ${Object.keys(map).length} products from TCGCSV`);
  // Show a few to verify
  [674320, 674321, 674430, 674431, 674432].forEach(pid => {
    if (map[pid]) console.log(`  pid ${pid}: ${map[pid]}`);
  });
  return map;
}

async function fetchJPCards() {
  console.log('📋 Fetching JP cards from Scrydex...');
  const headers = {
    'X-Api-Key': process.env.SCRYDEX_API_KEY,
    'X-Team-ID': process.env.SCRYDEX_TEAM_ID,
  };
  let page = 1, all = [];
  while (true) {
    const res = await fetch(
      `https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}/cards?select=id,name,rarity,images&pageSize=100&language=JA&page=${page}`,
      { headers }
    );
    const data = await res.json();
    const cards = data.data || [];
    all = all.concat(cards);
    console.log(`  Page ${page}: ${cards.length} cards (total: ${all.length})`);
    if (cards.length < 100) break;
    page++;
  }
  console.log(`✅ Got ${all.length} JP cards`);
  return all;
}

async function fetchLogo() {
  console.log('🎨 Fetching set logo...');
  try {
    const headers = { 'X-Api-Key': process.env.SCRYDEX_API_KEY, 'X-Team-ID': process.env.SCRYDEX_TEAM_ID };
    const res = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${JP_ID}`, { headers });
    const raw = await res.json();
    const exp = raw.data || raw;
    const logoUrl = exp.logo || exp.images?.logo || exp.images?.symbol || exp.logoUrl || null;
    if (logoUrl) {
      const imgRes = await fetch(logoUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        await upload(`logos/${SET_ID}.png`, buf, 'image/png');
        return;
      }
    }
  } catch (e) { console.warn(`  Scrydex logo failed: ${e.message}`); }

  // Fallback: The Hobby Bin EN logo
  try {
    const url = 'https://thehobbybin.com/cdn/shop/files/Perfect-Order-Pokemon-TCG-Set-Logo.png';
    const imgRes = await fetch(url);
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      await upload(`logos/${SET_ID}.png`, buf, 'image/png');
      return;
    }
  } catch (e) { console.warn(`  Fallback logo failed: ${e.message}`); }
  console.warn('⚠️  Logo skipped');
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
  console.log(`\n🔧 fix-me03-r2 — fixing data/${SET_ID}.json and logo in R2\n`);

  const [pidToName, jpCards] = await Promise.all([fetchEnNamesByProductId(), fetchJPCards()]);

  const cards = jpCards.map(c => {
    const rawId   = c.id ? c.id.split('-').slice(1).join('-') : '';
    const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
    const cardNum = parseInt(localId, 10);
    // productId = FIRST_PID + (cardNum - 1)
    const pid     = FIRST_PID + (cardNum - 1);
    const name    = pidToName[pid]
                 || (c.name || '').replace(/\s*[-–—]\s*\d+\/\d+\s*$/, '').trim();
    const rarity  = norm(c.rarity);
    return { localId, name, rarity };
  });

  console.log('\nSample mappings (verify):');
  [1, 21, 97, 111, 112, 113, 114, 115, 116].forEach(n => {
    const c = cards.find(x => parseInt(x.localId) === n);
    if (c) console.log(`  #${String(n).padStart(3,'0')}: ${c.name} (${c.rarity})`);
  });

  const metadata = { setId: SET_ID, phase: 'jp', cardCount: { official: 88 }, cards };
  await upload(`data/${SET_ID}.json`, JSON.stringify(metadata), 'application/json');
  await fetchLogo();

  console.log(`\n🎉 Done! ${cards.length} cards written to R2.`);
  console.log('   Trigger a Vercel redeploy to flush the in-memory cache.');
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
