#!/usr/bin/env node
/**
 * lookup-op-groups.mjs
 * Fetches One Piece TCG group IDs from TCGCSV and prints them.
 * Run this once to populate the TCGP_GROUP_MAP in generate-op-page.js
 *
 * Usage: node scripts/lookup-op-groups.mjs
 */

const OP_CATEGORY = 62;
const BASE = `https://tcgcsv.com/tcgplayer/${OP_CATEGORY}`;

async function main() {
  console.log(`Fetching One Piece groups from TCGCSV (category ${OP_CATEGORY})...\n`);
  const res = await fetch(`${BASE}/groups`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const groups = (data.results || []).sort((a, b) => a.groupId - b.groupId);

  console.log('GROUP ID MAP:\n');
  const map = {};
  groups.forEach(g => {
    // Convert name like "Romance Dawn" → op01, "Paramount War" → op02 etc.
    const name = g.name || '';
    console.log(`  ${String(g.groupId).padStart(6)}: "${name}"`);
    map[g.groupId] = name;
  });

  console.log('\nTotal groups:', groups.length);
  console.log('\nCopy the relevant IDs into TCGP_GROUP_MAP in generate-op-page.js');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
