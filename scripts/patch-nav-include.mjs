/**
 * patch-nav-include.mjs
 * Replaces the inline nav block in all generated *-card-list.html files
 * with the nav.html fetch include. Run once — idempotent.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// The new nav placeholder + fetch loader to inject
const NAV_PLACEHOLDER = `<!-- ===== NAV ===== -->
<div id="site-nav"></div>
<script>
fetch('/nav.html').then(r => r.text()).then(html => {
  const placeholder = document.getElementById('site-nav');
  if (!placeholder) return;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  while (temp.firstChild) placeholder.parentNode.insertBefore(temp.firstChild, placeholder);
  placeholder.remove();
  requestAnimationFrame(() => {
    if (typeof initNav === 'function') initNav();
  });
});
</script>`;

// Patterns that mark the start/end of the nav block in generated pages
const NAV_START = '<!-- ===== NAV ===== -->';
const NAV_END_MARKERS = [
  '<!-- ===== HERO ===== -->',
  '<!-- Hamburger Menu Overlay -->',  // fallback if no hero comment
];

// Find all *-card-list.html files
const files = readdirSync(ROOT).filter(f => f.endsWith('-card-list.html'));
console.log(`Found ${files.length} card-list HTML files`);

let patched = 0;
let skipped = 0;

for (const file of files) {
  const path = join(ROOT, file);
  let content = readFileSync(path, 'utf8');

  // Already patched?
  if (content.includes('<div id="site-nav"></div>')) {
    console.log(`  SKIP (already patched): ${file}`);
    skipped++;
    continue;
  }

  const navStart = content.indexOf(NAV_START);
  if (navStart === -1) {
    console.log(`  SKIP (no nav marker): ${file}`);
    skipped++;
    continue;
  }

  // Find where the nav block ends
  let navEnd = -1;
  for (const marker of NAV_END_MARKERS) {
    const idx = content.indexOf(marker, navStart + NAV_START.length);
    if (idx !== -1) {
      navEnd = idx;
      break;
    }
  }

  if (navEnd === -1) {
    console.log(`  SKIP (no nav end found): ${file}`);
    skipped++;
    continue;
  }

  // Replace the nav block
  const before = content.slice(0, navStart);
  const after = content.slice(navEnd);
  content = before + NAV_PLACEHOLDER + '\n\n' + after;

  // Also wrap the hamburger IIFE in initNav() if not already done
  if (content.includes('/* ===== HAMBURGER MENU ===== */\n(async function()') && 
      !content.includes('function initNav()')) {
    content = content.replace(
      '/* ===== HAMBURGER MENU ===== */\n(async function() {',
      '/* ===== HAMBURGER MENU ===== */\nfunction initNav() {\n(async function() {'
    );
    // Find the closing of the IIFE and add end of initNav
    content = content.replace(
      '  await fetchSets();\n})();\n\n/* ===== SECTION NAV ACTIVE STATE ===== */',
      '  await fetchSets();\n})();\n} // end initNav\n\n/* ===== SECTION NAV ACTIVE STATE ===== */'
    );
  }

  // Also fix nav CSS to sticky
  content = content.replace(
    'nav.container {\n  padding: 24px 0;\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  position: relative;\n  z-index: 10;\n}',
    'nav.container {\n  padding: 24px 0;\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  position: sticky;\n  top: 0;\n  z-index: 1000;\n  background: linear-gradient(to bottom, rgba(15,23,42,0.98) 80%, transparent);\n}'
  );

  writeFileSync(path, content, 'utf8');
  console.log(`  PATCHED: ${file}`);
  patched++;
}

console.log(`\nDone — ${patched} patched, ${skipped} skipped`);
