import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const NAV_FETCH = `<!-- ===== NAV ===== -->
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

const NAV_START = '<!-- ===== NAV ===== -->';
const NAV_END_MARKERS = ['<!-- ===== HERO ===== -->', '<!-- Hamburger Menu Overlay -->'];

const CORRECT_CSS = `nav:not(.section-nav) {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: linear-gradient(to bottom, rgba(15,23,42,0.98) 80%, transparent);
}
nav.container {
  padding: 24px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}`;

const files = readdirSync(ROOT).filter(f => f.endsWith('-card-list.html'));
console.log(`Found ${files.length} card-list HTML files`);

let patched = 0, cssFixed = 0, skipped = 0;

for (const file of files) {
  const path = join(ROOT, file);
  let content = readFileSync(path, 'utf8');
  let changed = false;

  // Fix nav CSS — handles both "nav {" and "nav.container {" patterns
  const before = content;

  // Pattern 1: nav.container with position
  content = content.replace(
    /nav\.container\s*\{[^}]+\}/gs,
    CORRECT_CSS
  );

  // Pattern 2: bare "nav {" with position (old template style)
  if (content === before) {
    content = content.replace(
      /^nav\s*\{[^}]+\}/ms,
      CORRECT_CSS
    );
  }

  if (content !== before) { changed = true; cssFixed++; }

  // Replace inline nav HTML if not already using fetch
  if (!content.includes('<div id="site-nav"></div>')) {
    const navStart = content.indexOf(NAV_START);
    if (navStart === -1) {
      console.log(`  SKIP (no nav marker): ${file}`);
      if (changed) writeFileSync(path, content, 'utf8');
      skipped++; continue;
    }
    let navEnd = -1;
    for (const marker of NAV_END_MARKERS) {
      const idx = content.indexOf(marker, navStart + NAV_START.length);
      if (idx !== -1) { navEnd = idx; break; }
    }
    if (navEnd === -1) {
      console.log(`  SKIP (no nav end): ${file}`);
      if (changed) writeFileSync(path, content, 'utf8');
      skipped++; continue;
    }
    content = content.slice(0, navStart) + NAV_FETCH + '\n\n' + content.slice(navEnd);
    changed = true;
    if (content.includes('/* ===== HAMBURGER MENU ===== */\n(async function()') &&
        !content.includes('function initNav()')) {
      content = content.replace(
        '/* ===== HAMBURGER MENU ===== */\n(async function() {',
        '/* ===== HAMBURGER MENU ===== */\nfunction initNav() {\n(async function() {'
      );
      content = content.replace(
        '  await fetchSets();\n})();\n\n/* ===== SECTION NAV ACTIVE STATE ===== */',
        '  await fetchSets();\n})();\n} // end initNav\n\n/* ===== SECTION NAV ACTIVE STATE ===== */'
      );
    }
    patched++;
    console.log(`  PATCHED: ${file}`);
  } else {
    if (changed) console.log(`  CSS-FIXED: ${file}`);
    else { console.log(`  SKIP (up to date): ${file}`); skipped++; continue; }
  }

  writeFileSync(path, content, 'utf8');
}

console.log(`\nDone — ${patched} nav-patched, ${cssFixed} css-fixed, ${skipped} skipped`);
