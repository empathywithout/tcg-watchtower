/**
 * clean-sitemap.mjs
 * Removes bad card page URLs from sitemap.xml
 * Bad pattern:  /pokemon/{series}/{set}/cards/{slug}  (missing /sets/)
 * Good pattern: /pokemon/sets/{series}/{set}/cards/{slug}
 * 
 * Run from repo root:
 *   node scripts/clean-sitemap.mjs
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';

const SITEMAP_PATH = 'sitemap.xml';

// Back up first
copyFileSync(SITEMAP_PATH, SITEMAP_PATH + '.bak');
console.log(`✅ Backed up to ${SITEMAP_PATH}.bak`);

const raw = readFileSync(SITEMAP_PATH, 'utf8');

// Split into <url>...</url> blocks
const urlBlocks = raw.match(/<url>[\s\S]*?<\/url>/g) || [];
console.log(`📋 Total URL blocks found: ${urlBlocks.length}`);

const BAD_PATTERNS = [
  // Missing /sets/ — e.g. /pokemon/scarlet-violet/base-set/cards/floette-092
  /\/pokemon\/(?!sets\/)[\w-]+\/[\w-]+\/cards\//,
  // Wrong set slug format — e.g. /pokemon/sets/scarlet-violet/scarlet-violet-base/cards/
  /\/pokemon\/sets\/scarlet-violet\/scarlet-violet-base\//,
  /\/pokemon\/sets\/scarlet-violet\/scarlet-violet-base-set\//,
  /\/pokemon\/sets\/scarlet-violet\/sv\//,
  // Any card URL where the series slug is wrong (chaos-rising/chaos-rising etc)
  /\/pokemon\/sets\/chaos-rising\//,
  /\/pokemon\/sets\/perfect-order\//,
];

let removed = 0;
let kept = 0;

const keptBlocks = urlBlocks.filter(block => {
  const locMatch = block.match(/<loc>(.*?)<\/loc>/);
  if (!locMatch) return true;
  const url = locMatch[1];
  
  const isBad = BAD_PATTERNS.some(pattern => pattern.test(url));
  if (isBad) {
    console.log(`  ❌ Removing: ${url}`);
    removed++;
    return false;
  }
  kept++;
  return true;
});

// Rebuild sitemap
const header = raw.match(/^[\s\S]*?(?=<url>)/)?.[0] || '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
const footer = '\n</urlset>';

const cleaned = header + keptBlocks.join('\n') + footer;
writeFileSync(SITEMAP_PATH, cleaned);

console.log(`\n✅ Done!`);
console.log(`   Removed: ${removed} bad URLs`);
console.log(`   Kept:    ${kept} good URLs`);
console.log(`   Backup:  ${SITEMAP_PATH}.bak`);
