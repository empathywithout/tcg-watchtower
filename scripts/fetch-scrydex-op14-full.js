// scripts/fetch-scrydex-op14-full.js
//
// Pulls the COMPLETE card list for OP14 from Scrydex (paginating
// automatically), and saves it to op14-scrydex-full.json in the repo
// root for review. This is the real, clean source data we'll use to
// rebuild the generator against, replacing the current broken R2 data
// that collapses cross-expansion reprints (like King/EB04-031) into
// colliding bare numbers.
//
// Usage:
//   SCRYDEX_API_KEY=xxx SCRYDEX_TEAM_ID=tcgwatchtower node scripts/fetch-scrydex-op14-full.js

const SCRYDEX_BASE    = 'https://api.scrydex.com/onepiece/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
  console.error('Missing SCRYDEX_API_KEY / SCRYDEX_TEAM_ID in env.');
  process.exit(1);
}

const headers = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };

async function main() {
  const fs = await import('fs');
  let allCards = [];
  let page = 1;
  let totalCount = null;

  while (true) {
    const url = `${SCRYDEX_BASE}/cards?q=${encodeURIComponent('printings:OP14')}&pageSize=100&page=${page}`;
    console.log(`Fetching page ${page}...`);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`❌ Page ${page} failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error(text.slice(0, 500));
      process.exit(1);
    }
    const data = await res.json();
    if (totalCount === null) totalCount = data.totalCount;
    const rows = data.data || [];
    allCards = allCards.concat(rows);
    console.log(`  got ${rows.length} cards (running total: ${allCards.length} / ${totalCount})`);
    if (rows.length === 0 || allCards.length >= totalCount) break;
    page++;
    if (page > 20) { console.warn('⚠️  Safety cap hit at 20 pages, stopping.'); break; }
  }

  fs.writeFileSync('op14-scrydex-full.json', JSON.stringify(allCards, null, 2));
  console.log(`\n✅ Saved ${allCards.length} cards to op14-scrydex-full.json`);

  // Quick summary: how many cards have printings from more than one expansion
  // (i.e. cross-expansion reprints like King/EB04-031, appearing in OP14 too)
  const crossExpansion = allCards.filter(c => (c.printings || []).length > 1);
  console.log(`\n${crossExpansion.length} of ${allCards.length} cards are cross-expansion reprints (printings.length > 1):`);
  crossExpansion.slice(0, 20).forEach(c => {
    console.log(`  ${c.id} (${c.name}) — printings: ${c.printings.join(', ')}`);
  });
  if (crossExpansion.length > 20) console.log(`  ...and ${crossExpansion.length - 20} more`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
