// scripts/find-scrydex-jp-id.js
//
// One-off helper to find a Scrydex JP expansion ID by (partial) name, so you
// can confirm the correct ID before adding it to SCRYDEX_JP_ID_MAP in
// api/scrydex-cards.js and api/cards.js. Never guess these — a wrong ID can
// silently attach the wrong set's prices to the wrong cards.
//
// Usage:
//   SCRYDEX_API_KEY=xxx SCRYDEX_TEAM_ID=xxx node scripts/find-scrydex-jp-id.js "Abyss Eye"
//
// Prints all JA-language expansions whose name includes the search term
// (case-insensitive), with their id/name/series/release_date.

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

const searchTerm = process.argv[2];
if (!searchTerm) {
  console.error('Usage: node scripts/find-scrydex-jp-id.js "<set name or partial name>"');
  process.exit(1);
}
if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
  console.error('Missing SCRYDEX_API_KEY / SCRYDEX_TEAM_ID in env.');
  process.exit(1);
}

async function main() {
  let allExpansions = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${SCRYDEX_BASE}/expansions?page_size=100&page=${page}&select=id,name,series,release_date,language_code`,
      { headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID } }
    );
    if (!res.ok) {
      console.error(`Scrydex ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const data = await res.json();
    const rows = data.data || [];
    allExpansions = allExpansions.concat(rows);
    if (rows.length === 0 || rows.length < 100) break;
    page++;
  }

  const term = searchTerm.toLowerCase();
  const matches = allExpansions.filter(e => {
    const isJP = e.language_code === 'JA' || e.language_code === 'ja';
    return isJP && (e.name || '').toLowerCase().includes(term);
  });

  if (matches.length === 0) {
    console.log(`No JA expansions matched "${searchTerm}". Showing all JA expansions instead:\n`);
    allExpansions
      .filter(e => e.language_code === 'JA' || e.language_code === 'ja')
      .forEach(e => console.log(`${e.id.padEnd(14)} ${e.name}  (${e.series || '?'}, ${e.release_date || '?'})`));
    return;
  }

  console.log(`Matches for "${searchTerm}":\n`);
  matches.forEach(e => {
    console.log(`  id: ${e.id}`);
    console.log(`  name: ${e.name}`);
    console.log(`  series: ${e.series || '?'}`);
    console.log(`  release_date: ${e.release_date || '?'}`);
    console.log('');
  });
  console.log('Add the confirmed id above to SCRYDEX_JP_ID_MAP in both:');
  console.log('  - api/scrydex-cards.js');
  console.log('  - api/cards.js');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
