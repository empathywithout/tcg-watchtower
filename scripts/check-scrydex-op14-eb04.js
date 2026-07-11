// scripts/check-scrydex-op14-eb04.js
//
// One-off diagnostic script: confirms whether OP14 and EB04 exist as
// separate expansions on Scrydex, and pulls Nami/King specifically to see
// their REAL variants structure (per Scrydex's documented model: a card
// is one object per official number, e.g. OP14-031, with all its
// collectible versions -- Normal, Alt Art, Special Alt Art, Manga Alt Art
// -- nested in a `variants` array, rather than each variant being its own
// separate top-level record).
//
// Usage:
//   SCRYDEX_API_KEY=xxx SCRYDEX_TEAM_ID=tcgwatchtower node scripts/check-scrydex-op14-eb04.js

const SCRYDEX_BASE    = 'https://api.scrydex.com/onepiece/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
  console.error('Missing SCRYDEX_API_KEY / SCRYDEX_TEAM_ID in env.');
  process.exit(1);
}

const headers = { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID };

async function getExpansion(id) {
  const res = await fetch(`${SCRYDEX_BASE}/expansions/${id}`, { headers });
  if (!res.ok) {
    console.log(`  ❌ ${id}: ${res.status} ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  console.log(`  ✅ ${id}: "${data.name}" — ${data.total} cards, released ${data.release_date}`);
  return data;
}

async function searchCard(nameQuery, expansionId) {
  const q = encodeURIComponent(`name:"${nameQuery}" printings:${expansionId}`);
  const res = await fetch(`${SCRYDEX_BASE}/cards?q=${q}&pageSize=10`, { headers });
  if (!res.ok) {
    console.log(`  ❌ search "${nameQuery}" in ${expansionId}: ${res.status} ${res.statusText}`);
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

async function main() {
  console.log('=== Step 1: Do OP14 and EB04 exist as separate expansions? ===');
  const op14 = await getExpansion('OP14');
  const eb04 = await getExpansion('EB04');

  console.log('\n=== Step 2: Nami — searched within OP14 printings ===');
  const namiResults = await searchCard('Nami', 'OP14');
  console.log(JSON.stringify(namiResults, null, 2));

  console.log('\n=== Step 3: King — searched within EB04 printings ===');
  const kingResults = await searchCard('King', 'EB04');
  console.log(JSON.stringify(kingResults, null, 2));

  console.log('\nDone. Paste all of the above back for review.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
