// scripts/patch-group-id.js
// Automatically adds/updates a TCGplayer group ID entry in api/cards.js SET_TO_GROUP.
// Called during presale or EN set generation when TCGP_GROUP_ID is provided.
//
// Usage:
//   SET_ID=me06 TCGP_GROUP_ID=24999 node scripts/patch-group-id.js
//
// Safe to re-run — updates existing entry rather than duplicating.

import { readFileSync, writeFileSync } from 'fs';

const SET_ID       = (process.env.SET_ID        || '').trim();
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID || '').trim();

if (!SET_ID || !TCGP_GROUP_ID) {
  console.error('❌ SET_ID and TCGP_GROUP_ID required');
  process.exit(1);
}

if (!/^\d+$/.test(TCGP_GROUP_ID)) {
  console.error(`❌ TCGP_GROUP_ID must be numeric, got: ${TCGP_GROUP_ID}`);
  process.exit(1);
}

const filePath = 'api/cards.js';
let content = readFileSync(filePath, 'utf8');

const mapRegex = /(const SET_TO_GROUP\s*=\s*\{)([\s\S]*?)(\};)/;
const match = content.match(mapRegex);

if (!match) {
  console.error('❌ Could not find SET_TO_GROUP in api/cards.js');
  process.exit(1);
}

let mapBody = match[2];

// Check if entry already exists
const entryRegex = new RegExp(`'${SET_ID}'\\s*:\\s*'[^']*'`);
if (entryRegex.test(mapBody)) {
  const existing = mapBody.match(entryRegex)?.[0];
  if (existing?.includes(`'${TCGP_GROUP_ID}'`)) {
    console.log(`ℹ️  Entry already correct: '${SET_ID}': '${TCGP_GROUP_ID}' — no change needed`);
    process.exit(0);
  }
  mapBody = mapBody.replace(entryRegex, `'${SET_ID}':'${TCGP_GROUP_ID}'`);
  console.log(`✅ Updated existing entry: '${SET_ID}': '${TCGP_GROUP_ID}'`);
} else {
  // Find last entry in the me-series block and append after it
  const lastMeEntry = mapBody.match(/'me\d+[^']*':\s*'\d+',?\s*\/\/[^\n]*/g);
  if (lastMeEntry) {
    const last = lastMeEntry[lastMeEntry.length - 1];
    mapBody = mapBody.replace(last, `${last}\n  '${SET_ID}':'${TCGP_GROUP_ID}',`);
  } else {
    mapBody = mapBody.trimEnd() + `\n  '${SET_ID}':'${TCGP_GROUP_ID}',\n`;
  }
  console.log(`✅ Added new entry: '${SET_ID}': '${TCGP_GROUP_ID}'`);
}

content = content.replace(mapRegex, `${match[1]}${mapBody}${match[3]}`);
writeFileSync(filePath, content);
console.log(`   api/cards.js SET_TO_GROUP updated`);
