// scripts/patch-jp-id-map.js
// Automatically adds/updates a JP set ID entry in api/cards.js SCRYDEX_JP_ID_MAP.
// Called by generate-set-page.js when PHASE=jp.
//
// Usage:
//   SET_ID=sv11 JP_SCRYDEX_ID=sv9b node scripts/patch-jp-id-map.js

import { readFileSync, writeFileSync } from 'fs';

const SET_ID       = (process.env.SET_ID        || '').trim();
const JP_SCRYDEX_ID = (process.env.JP_SCRYDEX_ID || '').trim();

if (!SET_ID || !JP_SCRYDEX_ID) {
  console.error('❌ SET_ID and JP_SCRYDEX_ID required');
  process.exit(1);
}

const filePath = 'api/cards.js';
let content    = readFileSync(filePath, 'utf8');

// Find the SCRYDEX_JP_ID_MAP object and add/update the entry
const mapRegex = /(const SCRYDEX_JP_ID_MAP\s*=\s*\{)([\s\S]*?)(\};)/;
const match    = content.match(mapRegex);

if (!match) {
  console.error('❌ Could not find SCRYDEX_JP_ID_MAP in api/cards.js');
  process.exit(1);
}

let mapBody = match[2];

// Check if entry already exists
const entryRegex = new RegExp(`'${SET_ID}'\\s*:\\s*'[^']*'`);
if (entryRegex.test(mapBody)) {
  // Update existing entry
  mapBody = mapBody.replace(entryRegex, `'${SET_ID}': '${JP_SCRYDEX_ID}'`);
  console.log(`✅ Updated existing entry: '${SET_ID}': '${JP_SCRYDEX_ID}'`);
} else {
  // Add new entry before closing brace
  // Remove trailing whitespace/newline before } and add entry
  mapBody = mapBody.trimEnd() + `\n  '${SET_ID}': '${JP_SCRYDEX_ID}',\n`;
  console.log(`✅ Added new entry: '${SET_ID}': '${JP_SCRYDEX_ID}'`);
}

content = content.replace(mapRegex, `${match[1]}${mapBody}${match[3]}`);
writeFileSync(filePath, content);
console.log(`   api/cards.js updated`);
