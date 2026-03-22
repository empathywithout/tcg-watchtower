#!/usr/bin/env node
/**
 * patch-generate-op-page.mjs
 * Applies two bug fixes to scripts/generate-op-page.js in-place:
 *
 * Fix 1 — renderCards(): wrong price cache key
 *   Was: priceCache[card.localId] || priceCache[`${SET_ID.toUpperCase()}-${card.localId}`]
 *   Now: priceKey(localId, name) with proper fallbacks (matches how the API stores OP prices)
 *
 * Fix 2 — renderCards(): no eBay/TCGplayer buy buttons on card grid items
 *   Adds .buy-links with eBay + TCGplayer anchors to every card item
 *
 * Fix 3 — loadTCGPlayerPrices(): update TCGplayer href after prices load
 *   After prices arrive, upgrades buy button URLs to direct product links
 *
 * Usage:
 *   node patch-generate-op-page.mjs
 *   node patch-generate-op-page.mjs --path ./scripts/generate-op-page.js
 */

import { readFileSync, writeFileSync } from 'fs';

const filePath = process.argv.includes('--path')
  ? process.argv[process.argv.indexOf('--path') + 1]
  : './scripts/generate-op-page.js';

console.log(`Patching ${filePath}...`);
let src = readFileSync(filePath, 'utf8');
const original = src;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 + 2: renderCards() — fix price lookup AND add buy buttons
// ─────────────────────────────────────────────────────────────────────────────

const OLD_RENDER_CARDS = `    const cached = priceCache[card.localId] || priceCache[\`\${SET_ID.toUpperCase()}-\${card.localId}\`];
    const priceText = cached?.price ? \`$\${cached.price.toFixed(2)}\` : '';
    const priceClass = !cached ? 'loading' : '';
    const displayName = (card.variantType || (card.localId && card.localId.includes('_')))
      ? cleanVariantName(card.name, card.variantType, card.localId)
      : card.name;
    const displayId = card.baseLocalId || (card.localId.includes('_') ? card.localId.split('_')[0] : card.localId);
    el.innerHTML = \`<img src="\${imgUrl}" alt="\${card.name} \${SET_FULL_NAME}" loading="lazy" onerror="this.style.background='#1e293b'" width="245" height="337">
      <div class="card-item-info">
        <div class="card-item-name">\${displayName}</div>
        <div class="card-item-num">\${displayId}</div>
        <div class="card-item-price \${priceClass}">\${priceText}</div>
        \${card.rarity && RARITY_CLASS[card.rarity] ? \`<div style="margin-top:3px"><span class="rarity-badge \${RARITY_CLASS[card.rarity]}" style="font-size:.6rem;padding:2px 6px">\${RARITY_LABEL[card.rarity] || card.rarity}</span></div>\` : ''}
      </div>\`;
    el.addEventListener('click', () => openModal(card.localId, card.name, card.rarity || '', imgUrl));`;

const NEW_RENDER_CARDS = `    // FIX: use name-based priceKey (matches how the OP price API stores keys) with number fallback
    const cached = priceCache[priceKey(card.localId, card.name)]
      || priceCache[priceKey(card.localId)]
      || priceCache[(card.localId.includes('_') ? card.localId.split('_')[0] : card.localId).padStart(3,'0')];
    const priceText = cached?.price ? \`$\${cached.price.toFixed(2)}\` : '';
    const priceClass = !cached ? 'loading' : '';
    const displayName = (card.variantType || (card.localId && card.localId.includes('_')))
      ? cleanVariantName(card.name, card.variantType, card.localId)
      : card.name;
    const displayId = card.baseLocalId || (card.localId.includes('_') ? card.localId.split('_')[0] : card.localId);
    // FIX: resolve direct TCGplayer product URL from cache, fall back to search link
    const tcgpUrl = cached?.url || tcgpLink(card.name, displayId);
    const ebayUrl = ebayLink(\`\${card.name} \${displayId} \${SET_FULL_NAME} One Piece\`);
    el.innerHTML = \`<img src="\${imgUrl}" alt="\${card.name} \${SET_FULL_NAME}" loading="lazy" onerror="this.style.background='#1e293b'" width="245" height="337">
      <div class="card-item-info">
        <div class="card-item-name">\${displayName}</div>
        <div class="card-item-num">\${displayId}</div>
        <div class="card-item-price \${priceClass}">\${priceText}</div>
        \${card.rarity && RARITY_CLASS[card.rarity] ? \`<div style="margin-top:3px"><span class="rarity-badge \${RARITY_CLASS[card.rarity]}" style="font-size:.6rem;padding:2px 6px">\${RARITY_LABEL[card.rarity] || card.rarity}</span></div>\` : ''}
        <div class="buy-links" style="margin-top:6px;justify-content:flex-start">
          <a class="buy-link buy-ebay" href="\${ebayUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">eBay</a>
          <a class="buy-link buy-tcgp" data-tcgp-href="\${tcgpUrl}" href="\${tcgpUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">TCGplayer</a>
        </div>
      </div>\`;
    el.addEventListener('click', () => openModal(card.localId, card.name, card.rarity || '', imgUrl));`;

if (!src.includes(OLD_RENDER_CARDS)) {
  console.error('❌  Fix 1+2: Could not find renderCards() target block. The file may have already been patched or has changed.');
  process.exit(1);
}
src = src.replace(OLD_RENDER_CARDS, NEW_RENDER_CARDS);
console.log('✅  Fix 1+2: renderCards() — price lookup fixed, buy buttons added');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: loadTCGPlayerPrices() — update buy button href after prices arrive
// ─────────────────────────────────────────────────────────────────────────────

const OLD_PRICE_DOM_UPDATE = `        const priceEl = el.querySelector('.card-item-price');
        if (priceEl) { priceEl.textContent = cached?.price ? \`$\${cached.price.toFixed(2)}\` : ''; priceEl.classList.remove('loading'); }
      });
      renderChaseHTML();`;

const NEW_PRICE_DOM_UPDATE = `        const priceEl = el.querySelector('.card-item-price');
        if (priceEl) { priceEl.textContent = cached?.price ? \`$\${cached.price.toFixed(2)}\` : ''; priceEl.classList.remove('loading'); }
        // FIX: upgrade TCGplayer buy button to direct product URL now that we have it
        if (cached?.url) {
          const tcgpBtn = el.querySelector('.buy-link.buy-tcgp[data-tcgp-href]');
          if (tcgpBtn) tcgpBtn.href = cached.url;
        }
      });
      renderChaseHTML();`;

if (!src.includes(OLD_PRICE_DOM_UPDATE)) {
  console.error('❌  Fix 3: Could not find loadTCGPlayerPrices() DOM update block. Skipping this fix.');
} else {
  src = src.replace(OLD_PRICE_DOM_UPDATE, NEW_PRICE_DOM_UPDATE);
  console.log('✅  Fix 3: loadTCGPlayerPrices() — buy button URL upgrade added');
}

// ─────────────────────────────────────────────────────────────────────────────
// Write output
// ─────────────────────────────────────────────────────────────────────────────

if (src === original) {
  console.warn('⚠️  No changes were made — file may already be patched.');
  process.exit(0);
}

writeFileSync(filePath, src);
console.log(`\n✅  Patched ${filePath} successfully.`);
console.log(`\nNext: re-run the generator for all live OP sets to rebuild their HTML pages.`);
console.log(`  node scripts/generate-op-page.js  (with appropriate env vars per set)`);
