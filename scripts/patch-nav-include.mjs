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
  background: linear-gradient(to bottom right, #0f172a, #1e1b4b, #581c87);
}
nav.container {
  padding: 24px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}`;

// The new initNav with One Piece support
const NEW_INIT_NAV = `function initNav() {
(async function() {
  const hamburger = document.getElementById('hamburger');
  const hamburgerOverlay = document.getElementById('hamburger-overlay');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const pokemonMenuItem = document.getElementById('pokemon-menu-item');
  const onepieceMenuItem = document.getElementById('onepiece-menu-item');
  const pokemonSetsView = document.getElementById('pokemon-sets-view');
  const onepieceSetsView = document.getElementById('onepiece-sets-view');
  const backToMenu = document.getElementById('back-to-menu');
  const backToMenuOp = document.getElementById('back-to-menu-op');
  const setsGridContainer = document.getElementById('sets-grid-container');
  const setsGridContainerOp = document.getElementById('sets-grid-container-op');
  const filterTabs = document.querySelectorAll('#sets-filter-tabs .filter-tab');
  const filterTabsOp = document.querySelectorAll('#sets-filter-tabs-op .filter-tab');

  let allSets = [];
  let currentFilter = 'all';
  let currentFilterOp = 'all';

  function toggleHamburgerMenu() {
    const isOpen = hamburgerMenu.classList.contains('open');
    if (isOpen) { closeAllMenus(); }
    else {
      hamburgerMenu.classList.add('open');
      hamburgerOverlay.classList.add('open');
      hamburger.classList.add('open');
    }
  }

  function closeAllMenus() {
    hamburgerMenu.classList.remove('open');
    pokemonSetsView.classList.remove('open');
    if (onepieceSetsView) onepieceSetsView.classList.remove('open');
    hamburgerOverlay.classList.remove('open');
    hamburger.classList.remove('open');
  }

  function showPokemonSets() {
    hamburgerMenu.classList.remove('open');
    pokemonSetsView.classList.add('open');
  }

  function showOnePieceSets() {
    hamburgerMenu.classList.remove('open');
    if (onepieceSetsView) { onepieceSetsView.classList.add('open'); renderOnePieceSets(); }
  }

  function backToMainMenu() {
    pokemonSetsView.classList.remove('open');
    if (onepieceSetsView) onepieceSetsView.classList.remove('open');
    hamburgerMenu.classList.add('open');
  }

  hamburger.addEventListener('click', toggleHamburgerMenu);
  hamburgerOverlay.addEventListener('click', closeAllMenus);
  pokemonMenuItem.addEventListener('click', showPokemonSets);
  if (onepieceMenuItem) onepieceMenuItem.addEventListener('click', showOnePieceSets);
  backToMenu.addEventListener('click', backToMainMenu);
  if (backToMenuOp) backToMenuOp.addEventListener('click', backToMainMenu);

  hamburgerMenu.querySelectorAll('a[href^="#"], a[href^="/#"]').forEach(link => {
    link.addEventListener('click', closeAllMenus);
  });

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderSets();
    });
  });

  filterTabsOp.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabsOp.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilterOp = tab.dataset.filter;
      renderOnePieceSets();
    });
  });

  async function fetchSets() {
    try {
      const res = await fetch('/sets.json');
      if (!res.ok) return;
      allSets = await res.json();
      renderSets();
    } catch(e) { console.error('Error fetching sets:', e); }
  }

  function renderSets() {
    if (!setsGridContainer) return;
    const pokemonSets = allSets.filter(s => {
      const id = (s.setId || s.slug || '').toLowerCase();
      return !id.startsWith('op') && !id.startsWith('eb') && !id.startsWith('st');
    });
    let filtered = pokemonSets;
    if (currentFilter === 'live') filtered = pokemonSets.filter(s => s.live);
    else if (currentFilter !== 'all') {
      const nf = currentFilter.toLowerCase().replace(/[^a-z0-9]/g,'');
      filtered = pokemonSets.filter(s => s.series.toLowerCase().replace(/[^a-z0-9]/g,'') === nf);
    }
    const grouped = {};
    filtered.forEach(s => { if (!grouped[s.series]) grouped[s.series] = []; grouped[s.series].push(s); });
    let html = '';
    const r2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
    Object.keys(grouped).forEach(series => {
      html += \`<div class="series-label">\${series}</div><div class="sets-grid">\`;
      grouped[series].forEach(set => {
        const isDisabled = !set.live;
        const link = isDisabled ? 'javascript:void(0)' : '/' + set.slug;
        const logoUrl = set.setId ? \`\${r2}/logos/\${set.setId}.png\` : null;
        html += \`<a href="\${link}" class="\${isDisabled ? 'set-card disabled' : 'set-card'}">
          <div class="set-card-image">
            \${logoUrl ? \`<img src="\${logoUrl}" alt="\${set.name}" style="width:85%;max-width:130px;height:auto;object-fit:contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block'"><div style="font-size:3rem;display:none">🎴</div>\` : \`<div style="font-size:3rem">🎴</div>\`}
          </div>
          <div class="set-card-content">
            <div class="set-card-name">\${set.name}</div>
            <div class="set-card-info">\${set.short} • \${set.series}</div>
            \${isDisabled ? '<span class="set-card-soon">Coming Soon</span>' : ''}
          </div>
        </a>\`;
      });
      html += '</div>';
    });
    setsGridContainer.innerHTML = html || '<div style="color:var(--text-muted);text-align:center;padding:40px;">No sets found</div>';
  }

  function renderOnePieceSets() {
    if (!setsGridContainerOp) return;
    const opSets = allSets.filter(s => {
      const id = (s.setId || s.slug || '').toLowerCase();
      return id.startsWith('op') || id.startsWith('eb') || id.startsWith('st');
    });
    let filtered = currentFilterOp === 'live' ? opSets.filter(s => s.live) : opSets;
    if (!filtered.length) {
      setsGridContainerOp.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">No sets available</div>';
      return;
    }
    const r2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
    let html = '<div class="sets-grid">';
    filtered.forEach(set => {
      const isDisabled = !set.live;
      const link = isDisabled ? 'javascript:void(0)' : '/' + set.slug;
      const logoUrl = set.setId ? \`\${r2}/logos/op/\${set.setId}.png\` : null;
      html += \`<a href="\${link}" class="\${isDisabled ? 'set-card disabled' : 'set-card'}">
        <div class="set-card-image">
          \${logoUrl ? \`<img src="\${logoUrl}" alt="\${set.name}" style="width:85%;max-width:130px;height:auto;object-fit:contain;" onerror="this.style.display='none'">\` : \`<div style="font-size:3rem">🃏</div>\`}
        </div>
        <div class="set-card-content">
          <div class="set-card-name">\${set.name}</div>
          <div class="set-card-info">\${set.short || ''} • \${set.series || 'One Piece TCG'}</div>
          \${isDisabled ? '<span class="set-card-soon">Coming Soon</span>' : ''}
        </div>
      </a>\`;
    });
    html += '</div>';
    setsGridContainerOp.innerHTML = html;
  }

  await fetchSets();
})();
} // end initNav`;

const files = readdirSync(ROOT).filter(f => f.endsWith('-card-list.html'));
console.log(`Found ${files.length} card-list HTML files`);

let patched = 0, cssFixed = 0, navJsFixed = 0, skipped = 0;

for (const file of files) {
  const path = join(ROOT, file);
  let content = readFileSync(path, 'utf8');
  let changed = false;

  // 1. Fix nav CSS
  const cssBefore = content;
  content = content.replace(/nav\.container\s*\{[^}]+\}/gs, CORRECT_CSS);
  if (content === cssBefore) content = content.replace(/^nav\s*\{[^}]+\}/ms, CORRECT_CSS);
  if (content !== cssBefore) { changed = true; cssFixed++; }

  // 2. Fix nav HTML -> fetch
  if (!content.includes('<div id="site-nav"></div>')) {
    const navStart = content.indexOf(NAV_START);
    if (navStart === -1) { console.log(`  SKIP (no nav marker): ${file}`); if (changed) writeFileSync(path, content, 'utf8'); skipped++; continue; }
    let navEnd = -1;
    for (const marker of NAV_END_MARKERS) {
      const idx = content.indexOf(marker, navStart + NAV_START.length);
      if (idx !== -1) { navEnd = idx; break; }
    }
    if (navEnd === -1) { console.log(`  SKIP (no nav end): ${file}`); if (changed) writeFileSync(path, content, 'utf8'); skipped++; continue; }
    content = content.slice(0, navStart) + NAV_FETCH + '\n\n' + content.slice(navEnd);
    changed = true;
    patched++;
  }

  // 3. Always replace initNav with One Piece version
  const jsBefore = content;
  // Replace from "function initNav() {" to "} // end initNav"
  content = content.replace(/function initNav\(\) \{[\s\S]*?\} \/\/ end initNav/, NEW_INIT_NAV);
  if (content !== jsBefore) { changed = true; navJsFixed++; }

  if (changed) {
    writeFileSync(path, content, 'utf8');
    console.log(`  UPDATED: ${file}`);
  } else {
    console.log(`  SKIP (up to date): ${file}`);
    skipped++;
  }
}

console.log(`\nDone — ${patched} nav-patched, ${cssFixed} css-fixed, ${navJsFixed} js-fixed, ${skipped} skipped`);
