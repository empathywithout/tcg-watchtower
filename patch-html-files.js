#!/usr/bin/env node
// patch-html-files.js
// Run this from your repo root: node patch-html-files.js
// Patches all generated HTML files AND set-template.html in one shot.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';

const PATCHES = [
  // ── Rarity: add Mega Hyper Rare support ──────────────────────────────────
  [
    "  const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Ultra Rare', 'Illustration Rare'];",
    "  const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Ultra Rare', 'Illustration Rare'];"
  ],
  [
    "  const RARITY_TIER = { 'Hyper Rare': 0, 'Special Illustration Rare': 1, 'Ultra Rare': 2, 'Illustration Rare': 3 };",
    "  const RARITY_TIER = { 'Mega Hyper Rare': 0, 'Hyper Rare': 1, 'Special Illustration Rare': 2, 'Ultra Rare': 3, 'Illustration Rare': 4 };"
  ],
  [
    "  const RARITY_LABEL = { 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };",
    "  const RARITY_LABEL = { 'Mega Hyper Rare': 'MHR', 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };"
  ],
  [
    "  const RARITY_CLASS = { 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' };",
    "  const RARITY_CLASS = { 'Mega Hyper Rare': 'rarity-hr', 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' };"
  ],
  // ── RARITY_ORDER: add Mega Hyper Rare to filter dropdown ─────────────────
  [
    "      'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare'",
    "      'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare'"
  ],
  // ── Hero card stretch fix (CSS) ───────────────────────────────────────────
  [
    `.card-stack img {
  position:absolute; width:180px; border-radius:12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  transition: transform 0.3s;
}`,
    `.card-stack img {
  position:absolute; width:180px; height:auto; border-radius:12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  transition: transform 0.3s;
  object-fit: contain;
}`
  ],
];

// Per-file patches (keyed by filename)
const FILE_PATCHES = {
  'ascended-heroes-card-list.html': [
    ["const TCGP_GROUP_ID = '0';", "const TCGP_GROUP_ID = '24541';"],
  ],
  'phantasmal-flames-card-list.html': [
    // group ID should already be correct if generated properly, but ensure it
  ],
  'mega-evolution-base-set-card-list.html': [
    // group ID should already be correct
  ],
};

function patchFile(filepath, extraPatches = []) {
  if (!existsSync(filepath)) {
    console.log(`  ⏭  Skipped (not found): ${filepath}`);
    return;
  }
  let content = readFileSync(filepath, 'utf8');
  let changed = 0;

  for (const [find, replace] of [...PATCHES, ...extraPatches]) {
    if (content.includes(find)) {
      content = content.replaceAll(find, replace);
      changed++;
    }
  }

  if (changed > 0) {
    writeFileSync(filepath, content);
    console.log(`  ✅ Patched ${changed} occurrence(s): ${filepath}`);
  } else {
    console.log(`  ✓  Already up to date: ${filepath}`);
  }
}

console.log('\n🔧 Patching set-template.html...');
patchFile('set-template.html');

console.log('\n🔧 Patching generated card list HTML files...');
const htmlFiles = readdirSync('.').filter(f => f.endsWith('-card-list.html'));
for (const file of htmlFiles) {
  patchFile(file, FILE_PATCHES[file] || []);
}

console.log('\n✅ Done. Deploy the patched files.');
console.log('   No need to regenerate — patches are applied directly to the live HTML.\n');
