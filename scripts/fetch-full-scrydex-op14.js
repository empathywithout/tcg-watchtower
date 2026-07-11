// scripts/fetch-full-scrydex-op14.js
//
// Pulls the COMPLETE op14 card list from Scrydex (paginated — OP14 has
// ~198 unique variants across its cards, well over the 100-per-page max),
// saves it to op14-scrydex-full.json, and prints a summary so we don't
// have to dump a huge wall of JSON into chat.
//
// Usage:
//   SCRYDEX_API_KEY=xxx SCRYDEX_TEAM_ID=tcgwatchtower node scripts/fetch-full-scrydex-op14.js

import fs from 'fs';

const SCRYDEX_BASE    = 'https://api.scrydex.com/onepiece/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
  console.error('Missing SCRYDEX_API_KEY / SCRYDEX_TEAM_ID in env.');
  process.exit(1);
}

const headers = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };

async function main() {
  let allCards = [];
  let page = 1;
  let totalCount = null;

  while (true) {
    console.log(`Fetching page ${page}...`);
    const res = await fetch(`${SCRYDEX_BASE}/cards?q=printings:OP14&pageSize=100&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`❌ Page ${page} failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const data = await res.json();
    if (totalCount == null && data.totalCount != null) totalCount = data.totalCount;
    const rows = data.data || [];
    allCards = allCards.concat(rows);
    console.log(`  got ${rows.length} cards (running total: ${allCards.length}${totalCount != null ? ' / ' + totalCount : ''})`);
    // Stop only when a page comes back with fewer than a full page's worth
    // of results (the real signal we've reached the end) -- never rely on
    // totalCount alone, since it isn't always present in the response.
    if (rows.length < 100) break;
    page++;
    if (page > 10) { console.warn('⚠️  Safety cap hit at page 10 — stopping.'); break; }
  }

  fs.writeFileSync('op14-scrydex-full.json', JSON.stringify(allCards, null, 2));

  // Summary instead of dumping everything
  const byExpansion = {};
  for (const c of allCards) {
    for (const p of (c.printings || [])) {
      byExpansion[p] = (byExpansion[p] || 0) + 1;
    }
  }
  const collisionNumbers = {};
  for (const c of allCards) {
    collisionNumbers[c.number] = (collisionNumbers[c.number] || 0) + 1;
  }
  const collidingNumbers = Object.entries(collisionNumbers).filter(([, count]) => count > 1);

  console.log('\n=== SUMMARY ===');
  console.log(`Total cards saved: ${allCards.length}`);
  console.log(`Saved to: op14-scrydex-full.json`);
  console.log(`\nCards by original printings source:`);
  for (const [exp, count] of Object.entries(byExpansion)) {
    console.log(`  ${exp}: ${count}`);
  }
  console.log(`\nPlain numbers shared by 2+ different cards (the collision pattern): ${collidingNumbers.length}`);
  for (const [num, count] of collidingNumbers) {
    const names = allCards.filter(c => c.number === num).map(c => `${c.id} (${c.name})`);
    console.log(`  #${num}: ${names.join(' / ')}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
