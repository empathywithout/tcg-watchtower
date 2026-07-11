// scripts/fix-tcgp-button-labels.js
//
// Renames the abbreviated "TCGp" button label to "TCGplayer" across every
// *-card-list.html file's in-page grid buttons (.buy-tcgp class), and adds
// a size override so the longer word doesn't get invisibly clipped by the
// existing white-space:nowrap;overflow:hidden rule on .buy-link (that rule
// was tuned for "TCGp" at 4 characters; "TCGplayer" is 9).
//
// Usage: node scripts/fix-tcgp-button-labels.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKIP_FILES = new Set(['fates-card-listtemporal-forces-card-list.html']);

const TCGP_SIZE_OVERRIDE = `.buy-tcgp{font-size:0.5rem}`;

function fixFile(file) {
  const filePath = path.join(ROOT, file);
  let src = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const labelCount = (src.match(/>TCGp</g) || []).length;
  if (labelCount > 0) {
    src = src.replace(/>TCGp</g, '>TCGplayer<');
    changed = true;
  }

  // Add a size override right after the last .buy-tcgp rule found, so it
  // wins by cascade order without needing !important. Only add if a
  // .buy-tcgp rule exists and no override is already present.
  const hasTcgpRule = /\.buy-tcgp\s*\{/.test(src);
  const hasOverride = src.includes(TCGP_SIZE_OVERRIDE);
  if (hasTcgpRule && !hasOverride) {
    // Insert right after the first .buy-tcgp{...} rule's closing brace
    const ruleMatch = src.match(/\.buy-tcgp\s*\{[^}]*\}/);
    if (ruleMatch) {
      src = src.replace(ruleMatch[0], `${ruleMatch[0]}\n${TCGP_SIZE_OVERRIDE}`);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(filePath, src);
  return { file, labelCount, addedOverride: hasTcgpRule && !hasOverride };
}

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('-card-list.html') && !SKIP_FILES.has(f));
let totalLabels = 0, totalOverrides = 0;
for (const file of files) {
  const result = fixFile(file);
  if (result.labelCount > 0 || result.addedOverride) {
    console.log(`${file}: ${result.labelCount} label(s) renamed${result.addedOverride ? ', size override added' : ''}`);
  }
  totalLabels += result.labelCount;
  if (result.addedOverride) totalOverrides++;
}
console.log(`\n${totalLabels} labels renamed across ${files.length} files, ${totalOverrides} size overrides added.`);
