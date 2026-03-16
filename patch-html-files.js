#!/usr/bin/env node
// patch-html-files.js  
// Run from repo root: node patch-html-files.js
// Patches set-template.html and all *-card-list.html files

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';

const RARITY_PATCHES = [
  [
    "['Special Illustration Rare', 'Hyper Rare', 'Ultra Rare', 'Illustration Rare']",
    "['Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Ultra Rare', 'Illustration Rare']"
  ],
  [
    "{ 'Hyper Rare': 0, 'Special Illustration Rare': 1, 'Ultra Rare': 2, 'Illustration Rare': 3 }",
    "{ 'Mega Hyper Rare': 0, 'Hyper Rare': 1, 'Special Illustration Rare': 2, 'Ultra Rare': 3, 'Illustration Rare': 4 }"
  ],
  [
    "{ 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' }",
    "{ 'Mega Hyper Rare': 'MHR', 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' }"
  ],
  [
    "{ 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' }",
    "{ 'Mega Hyper Rare': 'rarity-hr', 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' }"
  ],
  [
    "'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare'\n",
    "'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare'\n"
  ],
];

const FILE_PATCHES = {
  'ascended-heroes-card-list.html': [
    ["const TCGP_GROUP_ID = '0';", "const TCGP_GROUP_ID = '24541';"],
  ],
};

function patchFile(filepath, extra = []) {
  if (!existsSync(filepath)) { console.log(`  skip (not found): ${filepath}`); return 0; }
  let content = readFileSync(filepath, 'utf8');
  let n = 0;
  for (const [find, replace] of [...RARITY_PATCHES, ...extra]) {
    if (content.includes(find)) { content = content.replaceAll(find, replace); n++; }
  }
  if (n > 0) { writeFileSync(filepath, content); console.log(`  ✅ ${n} patches → ${filepath}`); }
  else { console.log(`  ✓  already up to date: ${filepath}`); }
  return n;
}

console.log('\n🔧 Patching set-template.html...');
patchFile('set-template.html');

console.log('\n🔧 Patching *-card-list.html files...');
for (const f of readdirSync('.').filter(f => f.endsWith('-card-list.html'))) {
  patchFile(f, FILE_PATCHES[f] || []);
}
console.log('\n✅ Done — commit and push to deploy.\n');
