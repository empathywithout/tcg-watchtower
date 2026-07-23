
const CONFIG = {
  amazon: { tag: 'cehutto01-20' },
  ebay: { campaign: 5339145069, mkrid: '711-53200-19255-0' },
  tcgplayer: { baseUrl: 'https://partner.tcgplayer.com/c/7068180/1830156/21018' },
  r2: 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev'  // ← paste your https://pub-xxxx.r2.dev URL here
};

// ─── FIX: derive TCGdex series prefix from any set ID ───────────────────────
// e.g. "sv1" → "sv", "sv8pt5" → "sv", "me1" → "me", "me2" → "me"
function tcgdexSeriesId(setId) {
  return (setId.match(/^([a-z]+)/i) || ['', 'sv'])[1].toLowerCase();
}
// ────────────────────────────────────────────────────────────────────────────

// Build card image URL — uses R2 if configured, falls back to TCGdex direct
function cardImg(setId, localId) {
  if (CONFIG.r2) {
    return `${CONFIG.r2}/cards/${setId}/${localId}.webp`;
  }
  // FIX 1: was hardcoded "/sv/" — now derives series from setId
  const series = tcgdexSeriesId(setId);
  return `https://assets.tcgdex.net/en/${series}/${setId}/${localId}/high.webp`;
}

// Build set logo URL — uses R2 if configured, falls back to TCGdex
function setLogoUrl(setId) {
  if (CONFIG.r2) {
    return `${CONFIG.r2}/logos/${setId}.png`;
  }
  const tcgdexId = {'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5','sv05':'sv05','me02pt5':'me02.5'}[setId] || setId;
  // FIX 2: was hardcoded "/sv/" — now derives series from the resolved tcgdexId
  const series = tcgdexSeriesId(tcgdexId);
  return `https://assets.tcgdex.net/en/${series}/${tcgdexId}/logo.png`;
}

// Wire up hero stack images
document.querySelectorAll('#hero-stack img[data-id]').forEach(img => {
  img.src = cardImg(img.dataset.set, img.dataset.id);
});

// Wire up set logo in hero stats
const setLogoHero = document.getElementById('set-logo-hero');
if (setLogoHero) {
  setLogoHero.src = setLogoUrl(SET_ID);
  setLogoHero.onerror = function() {
    // Hide logo stat card if image fails to load
    this.parentElement.style.display = 'none';
  };
}

/* ===== AFFILIATE LINK BUILDERS ===== */
function amazonLink(query) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}&linkCode=ll2&tag=${CONFIG.amazon.tag}&language=en_US`;
}
function ebayLink(query) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&mkcid=1&mkrid=${CONFIG.ebay.mkrid}&siteid=0&campid=${CONFIG.ebay.campaign}&customid=&toolid=10001&mkevt=1`;
}
function ebayLinkNew(query) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_ItemCondition=1000&mkcid=1&mkrid=${CONFIG.ebay.mkrid}&siteid=0&campid=${CONFIG.ebay.campaign}&customid=&toolid=10001&mkevt=1`;
}
function tcgplayerLink(query) {
  return `${CONFIG.tcgplayer.baseUrl}?u=${encodeURIComponent('https://www.tcgplayer.com/search/pokemon/' + SET_TCGP_SLUG + '?productLineName=pokemon&q=' + query + '&view=grid&productTypeName=Cards')}`;
}
function tcgplayerAffiliate(directUrl) {
  return `${CONFIG.tcgplayer.baseUrl}?u=${encodeURIComponent(directUrl)}`;
}
function tcgplayerCardLink(name, number, setSlug) {
  const q = encodeURIComponent(`${name} ${number}`);
  const url = `https://www.tcgplayer.com/search/pokemon/${setSlug}?productLineName=pokemon&q=${q}&view=grid&Language=English&productTypeName=Cards&sharedid=&irpid=7068180&afsrc=1`;
  return `${CONFIG.tcgplayer.baseUrl}?u=${encodeURIComponent(url)}`;
}

/* ===== CHASE CARDS ===== */

// Chase list stored at module scope so renderChaseCardsHTML can always read latest prices
let currentChaseList = [];

function renderChaseCards(cards) {
  const grid = document.getElementById('chase-grid');

  // Normalize TCGCSV rarity names to match our internal display names
  const RARITY_ALIAS = {
    'Special Art Rare': 'Special Illustration Rare',
    'Art Rare': 'Illustration Rare',
    'Super Rare': 'Ultra Rare',
    'Mega Attack Rare': 'Mega Attack Rare',
  };
  const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Mega Ultra Rare', 'Ultra Rare', 'Illustration Rare', 'Mega Attack Rare', 'Special Art Rare', 'Art Rare', 'Super Rare'];
  const RARITY_TIER = { 'Mega Ultra Rare': 0, 'Mega Hyper Rare': 0, 'Hyper Rare': 1, 'Special Illustration Rare': 2, 'Special Art Rare': 2, 'Ultra Rare': 3, 'Super Rare': 3, 'Illustration Rare': 4, 'Art Rare': 4, 'Mega Attack Rare': 2 };
  const RARITY_LABEL = { 'Mega Ultra Rare': 'MUR', 'Mega Hyper Rare': 'MHR', 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Special Art Rare': 'SAR', 'Ultra Rare': 'UR', 'Super Rare': 'SR', 'Illustration Rare': 'IR', 'Art Rare': 'AR', 'Mega Attack Rare': 'MA' };
  const RARITY_CLASS = { 'Mega Ultra Rare': 'rarity-hr', 'Mega Hyper Rare': 'rarity-hr', 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Special Art Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Super Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir', 'Art Rare': 'rarity-ir', 'Mega Attack Rare': 'rarity-sir' };

  if (cards && cards.length) {
    currentChaseList = cards
      .filter(c => {
        const nr = r => RARITY_ALIAS[r] || (r||'').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
        return CHASE_RARITIES.includes(nr(c.rarity||''));
      })
      .sort((a, b) => {
        const nr = r => RARITY_ALIAS[r] || (r||'').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
        return (RARITY_TIER[nr(a.rarity)] ?? 99) - (RARITY_TIER[nr(b.rarity)] ?? 99);
      })
      .map(c => {
        const nr = r => RARITY_ALIAS[r] || (r||'').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
        const rarity = nr(c.rarity);
        return {
          id: c.localId,
          name: c.name,
          rarity,
          rarityClass: RARITY_CLASS[rarity] || 'rarity-ir',
          label: RARITY_LABEL[rarity] || c.rarity,
          searchName: `${c.name} ${c.localId}/122 Chaos Rising Pokemon Card`,
          img: c.image || cardImg(SET_ID, c.localId),
        };
      });
  } else {
    currentChaseList = CHASE_CARDS.map(c => ({ ...c, img: cardImg(SET_ID, c.id) }));
  }

  // Render immediately — loadTCGPlayerPrices() re-renders once prices arrive
  renderChaseCardsHTML(grid);
}


function handleChaseClick(el) {
  const du = priceCache[el.dataset.id]?.url || null;
  openModal(el.dataset.id, el.dataset.name, el.dataset.rarity, el.dataset.search, el.dataset.img, du);
}

function renderChaseCardsHTML(grid) {
  const pricesKnown = Object.keys(priceCache).length > 0;
  const sorted = [...currentChaseList]
    .map(c => ({ ...c, price: priceCache[c.id]?.price ?? null, priceUrl: priceCache[c.id]?.url || null, priceIsEstimate: !!priceCache[c.id]?.estimate }))
    .sort((a, b) => {
      if (pricesKnown) {
        return (b.price ?? -1) - (a.price ?? -1);
      }
      return 0;
    });

  grid.innerHTML = sorted.map(c => {
    const priceHTML = c.price
      ? `<div class="chase-card-price-wrap"${
          c.priceIsEstimate ? ' title="Estimated from Japanese market price, converted to USD"' :
          SET_PHASE === 'presale' ? ' title="Presale price — may change at release"' : ''
        }><span class="price-value">${c.priceIsEstimate ? '~' : ''}$${c.price.toFixed(2)}${c.priceIsEstimate ? ' 〜' : SET_PHASE === 'presale' ? ' ❆' : ''}</span></div>`
      : `<div class="chase-card-price-wrap chase-card-price-loading">—</div>`;
    return `
    <div class="chase-card"
      data-id="${c.id}"
      data-name="${c.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}"
      data-rarity="${c.rarity}"
      data-search="${c.searchName.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}"
      data-img="${c.img}"
      onclick="handleChaseClick(this)">
      <img class="chase-card-img" src="${c.img}" alt="${c.name} ${c.id} Chaos Rising Pokemon Card" width="200" height="279" loading="lazy"
           onerror="this.style.background='#1e293b';this.style.minHeight='180px'">
      <div class="chase-card-info">
        <div class="chase-card-name">${c.name}</div>
        <div class="chase-card-number">#${c.id}/122</div>
        <div class="chase-card-rarity-wrap"><span class="rarity-badge ${c.rarityClass}">${c.label}</span></div>
        ${priceHTML}
        <div class="buy-links">
          <a class="buy-link buy-amazon" href="${amazonLink(c.searchName)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Amazon</a>
          <a class="buy-link buy-ebay" href="${ebayLink(c.searchName)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">eBay</a>
          <a class="buy-link buy-tcgp ${c.priceUrl ? 'buy-tcgp-featured' : ''}" href="${tcgplayerCardLink(c.name, c.id + '/' + SET_OFFICIAL_COUNT, SET_TCGP_SLUG)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">TCGp</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ===== PRODUCTS ===== */

function renderProductCard(p) {
  const fallbackHtml = `<div style="padding:40px 20px;text-align:center"><div style="font-size:2.5rem;margin-bottom:8px">📦</div><div style="font-size:0.8rem;color:var(--text-muted)">${p.type}</div></div>`;
  const imgHtml = p.image
    ? `<img src="${p.image}" alt="${p.name}" width="200" height="200" loading="lazy" onerror="this.onerror=null;this.style.display='none'">`
    : fallbackHtml;
  return `
    <div class="product-card" data-type="${p.filterKey}">
      <div class="product-img-wrap">${imgHtml}</div>
      <div class="product-info">
        <span class="rarity-badge ${p.badgeClass}" style="margin-bottom:10px;display:inline-flex">${p.type}</span>
        <div class="product-name">${p.name}</div>
        <div class="product-price" data-tcgp-id="${p.tcgpId}" style="font-size:1.1rem;font-weight:700;color:#22c55e;margin:6px 0;min-height:1.5rem;">${p.price ? '$' + p.price.toFixed(2) : ''}</div>

        <div class="product-links">
          ${!p.noAmazon && p.amazonUrl ? `<a class="product-link-row pl-amazon" href="${p.amazonUrl}" target="_blank" rel="noopener">
            <span>Amazon</span><span>→</span>
          </a>` : ''}
          <a class="product-link-row pl-ebay" href="${p.ebayUrl || ebayLink(p.q)}" target="_blank" rel="noopener">
            <span>eBay</span><span>→</span>
          </a>
          <a class="product-link-row pl-tcgp" href="${p.tcgpUrl || tcgplayerLink(p.q)}" target="_blank" rel="noopener">
            <span>TCGplayer</span><span>→</span>
          </a>
        </div>
      </div>
    </div>`;
}

function productImgUrl(q) {
  return `/api/product-image?q=${encodeURIComponent(q)}`;
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = Object.entries(PRODUCT_META).map(([asin, p]) => {
    const img = p.image || (CONFIG.r2 ? `${CONFIG.r2}/products/${SET_ID}/${asin}.jpg` : null);
    const amazonUrl = p.noAmazon ? null : `https://www.amazon.com/s?k=${encodeURIComponent(p.q)}&linkCode=ll2&tag=${CONFIG.amazon.tag}&language=en_US`;
    const tcgpUrl   = p.tcgpId ? tcgplayerAffiliate(`https://www.tcgplayer.com/product/${p.tcgpId}`) : tcgplayerLink(p.q);
    const ebayUrl   = ebayLinkNew(p.q);
    return renderProductCard({ ...p, image: img, price: null, amazonUrl, tcgpUrl, ebayUrl });
  }).join('');
}

// Product filter buttons
document.getElementById('product-filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('#product-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filter = btn.dataset.filter;
  document.querySelectorAll('#products-grid .product-card').forEach(card => {
    card.dataset.hidden = (filter !== 'all' && card.dataset.type !== filter) ? 'true' : 'false';
  });
});

/* ===== CARD LIST ===== */
let allCards = [];
let filteredCards = [];
let displayedCount = 0;
const PAGE_SIZE = 60;

// ── TCGplayer price system ───────────────────────────────────────────────────
const priceCache = {};
let _pricesFetchPromise = null;

function loadTCGPlayerPrices() {
  if (_pricesFetchPromise) return _pricesFetchPromise;
  _pricesFetchPromise = (async () => {
    try {
      const res = await fetch(`/api/tcgplayer-prices?groupId=${TCGP_GROUP_ID}`);
      if (!res.ok) throw new Error(`price fetch failed: ${res.status}`);
      const data = await res.json();

      const prices = data.prices || {};
      const urls   = data.tcgpUrls || {};

      Object.entries(prices).forEach(([num, price]) => {
        const withZeros    = num.padStart(3, '0');
        const withoutZeros = String(parseInt(num, 10));
        const url   = urls[num] || urls[withZeros] || urls[withoutZeros] || null;
        const entry = price != null ? { price, url } : null;
        priceCache[withZeros]    = entry;
        priceCache[withoutZeros] = entry;
      });
      Object.entries(urls).forEach(([num, url]) => {
        const withZeros    = num.padStart(3, '0');
        const withoutZeros = String(parseInt(num, 10));
        if (!priceCache[withZeros])    priceCache[withZeros]    = { price: null, url };
        if (!priceCache[withoutZeros]) priceCache[withoutZeros] = { price: null, url };
      });

      document.querySelectorAll('.card-item[data-local-id]').forEach(el => {
        const id     = el.dataset.localId;
        const cached = priceCache[id];
        const priceEl = el.querySelector('.card-item-price');
        if (!priceEl) return;
        if (cached?.price) {
          if (SET_PHASE === 'presale') {
            priceEl.textContent = `$${cached.price.toFixed(2)} ❆`;
            priceEl.title = 'Presale price — may change at release';
          } else {
            priceEl.textContent = `$${cached.price.toFixed(2)}`;
          }
          priceEl.classList.remove('loading');
        } else {
          priceEl.textContent = '';
          priceEl.classList.remove('loading');
        }
      });

      const grid = document.getElementById('chase-grid');
      if (grid && currentChaseList.length) renderChaseCardsHTML(grid);

      const sealedPrices = data.sealedPrices || {};
      document.querySelectorAll('[data-tcgp-id]').forEach(el => {
        const tid = el.dataset.tcgpId;
        const price = sealedPrices[tid];
        if (price != null) {
          el.textContent = '$' + price.toFixed(2);
        }
      });

      if (currentChaseList.length) {
        const top3 = [...currentChaseList]
          .map(c => ({ ...c, price: priceCache[c.id]?.price ?? -1 }))
          .sort((a, b) => b.price - a.price)
          .slice(0, 3);
        document.querySelectorAll('#hero-stack img').forEach((img, i) => {
          if (top3[i]) img.src = top3[i].img || cardImg(SET_ID, top3[i].id);
        });
      }

      if (document.getElementById('sort-select')?.value === 'price' && allCards.length) {
        applyFilters();
      }

    } catch(e) {
      console.warn('TCGplayer prices unavailable:', e.message);
      _pricesFetchPromise = null;
    }
  })();
  return _pricesFetchPromise;
}
// ── Scrydex JP price fallback (presale/jp phase) ────────────────────────────
// Only fills cards that don't already have a TCGplayer confirmed price.
// Shows ~$X 〜 with tooltip so users know it's a JP estimate, not a settled EN price.
let _scrydexPricesFetchPromise = null;
function loadScrydexJPPrices() {
  if (_scrydexPricesFetchPromise) return _scrydexPricesFetchPromise;
  _scrydexPricesFetchPromise = (async () => {
    try {
      const res = await fetch(`/api/scrydex-cards?set=${SET_ID}&phase=jp`);
      if (!res.ok) throw new Error(`Scrydex JP fetch failed: ${res.status}`);
      const data = await res.json();
      const cards = data.cards || [];
      if (!cards.length) return;
      cards.forEach(c => {
        if (c.market == null || !c.localId) return;
        const withZeros    = String(c.localId).padStart(3, '0');
        const withoutZeros = String(parseInt(c.localId, 10));
        // Only fill if TCGplayer doesn't already have a confirmed price
        if (priceCache[withZeros]?.price) return;
        const entry = { price: c.market, url: null, estimate: true };
        priceCache[withZeros]    = entry;
        priceCache[withoutZeros] = entry;
      });
      document.querySelectorAll('.card-item[data-local-id]').forEach(el => {
        const id      = el.dataset.localId;
        const cached  = priceCache[id];
        const priceEl = el.querySelector('.card-item-price');
        if (!priceEl || !cached?.estimate || !cached?.price) return;
        priceEl.textContent = `~$${cached.price.toFixed(2)} 〜`;
        priceEl.title = 'Estimated from Japanese market price, converted to USD';
        priceEl.classList.remove('loading');
      });
      const grid = document.getElementById('chase-grid');
      if (grid && currentChaseList.length) renderChaseCardsHTML(grid);
    } catch(e) {
      console.warn('Scrydex JP prices unavailable:', e.message);
      _scrydexPricesFetchPromise = null;
    }
  })();
  return _scrydexPricesFetchPromise;
}


async function loadCards() {
  document.getElementById('card-count').textContent = 'Loading cards…';
  try {
    let data = null;

    // Try R2 API first (passes phase so API uses Scrydex JP for JP sets)
    try {
      const phaseParam = (typeof SET_PHASE !== 'undefined' && SET_PHASE === 'jp') ? '&phase=jp' : '';
      const res = await fetch('/api/cards?set=' + SET_ID + phaseParam);
      if (res.ok && res.status !== 204) {
        const json = await res.json();
        if (json && (json.cards || json).length > 0) data = json;
      }
    } catch(e) {}

    // Fall back to TCGdex directly
    if (!data) {
      const setRes = await fetch('https://api.tcgdex.net/v2/en/sets/' + SET_ID);
      if (!setRes.ok) throw new Error('TCGdex failed');
      const setData = await setRes.json();
      const basicCards = setData.cards || [];
      const BATCH = 10;
      const fullCards = [];
      for (let i = 0; i < basicCards.length; i += BATCH) {
        const batch = basicCards.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(c => fetch(`https://api.tcgdex.net/v2/en/cards/${SET_ID}-${c.localId}`).then(r => r.json()))
        );
        results.forEach((result, idx) => {
          const basic = batch[idx];
          const detail = result.status === 'fulfilled' ? result.value : {};
          fullCards.push({
            localId: basic.localId,
            name: basic.name,
            // FIX 3: was hardcoded "/sv/" — now derives series from SET_ID at runtime
            image: cardImg(SET_ID, basic.localId),
            rarity: detail.rarity || ''
          });
        });
      }
      data = { cards: fullCards, cardCount: { total: setData.cardCount?.official || setData.cardCount?.total || fullCards.length } };
    }

    allCards = data.cards || data || [];
    if (allCards.length === 0) throw new Error('No cards returned');

    const total = allCards.length;
    const el = document.getElementById('stat-total-count');
    if (el) el.textContent = total;
    const subEl = document.getElementById('card-list-sub');
    if (subEl) subEl.textContent = `All ${total} cards — search, filter by rarity, or sort by price. Click any card to find it.`;

    const RARITY_ORDER = [
      'Common', 'Uncommon', 'Rare', 'Double Rare',
      'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Mega Ultra Rare'
    ];

    const raritySet = new Set(allCards.map(c => c.rarity).filter(Boolean));
    const sel = document.getElementById('rarity-filter');
    while (sel.options.length > 1) sel.remove(1);
    RARITY_ORDER.forEach(r => {
      if (raritySet.has(r)) {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        sel.appendChild(opt);
      }
    });
    raritySet.forEach(r => {
      if (!RARITY_ORDER.includes(r)) {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        sel.appendChild(opt);
      }
    });

    renderChaseCards(allCards);
    filteredCards = allCards;
    setTimeout(() => {
      renderCards(true);
      if (SET_PHASE === 'en' || SET_PHASE === 'presale') loadTCGPlayerPrices();
      if (SET_PHASE === 'presale' || SET_PHASE === 'jp') loadScrydexJPPrices();
    }, 0);
  } catch(e) {
    console.error('Card load failed:', e);
    document.getElementById('card-count').textContent = '⚠️ Could not load cards — try refreshing.';
  }
}

function renderCards(reset) {
  const grid = document.getElementById('card-grid');
  if (reset) { grid.innerHTML = ''; displayedCount = 0; }
  const slice = filteredCards.slice(displayedCount, displayedCount + PAGE_SIZE);
  slice.forEach(card => {
    const imgUrl = card.image || cardImg(SET_ID, card.localId);
    const el = document.createElement('div');
    el.className = 'card-item';
    el.dataset.localId = card.localId;
    el.dataset.name = card.name;

    const cached = priceCache[card.localId];
    const priceText = cached?.price ? (cached.estimate ? `~$${cached.price.toFixed(2)} 〜` : (SET_PHASE === 'presale' ? `$${cached.price.toFixed(2)} ❆` : `$${cached.price.toFixed(2)}`)) : '';
    const priceClass = cached === undefined || (!cached && !(card.localId in priceCache)) ? 'loading' : '';

    el.innerHTML = `
      <img src="${imgUrl}" alt="${SET_FULL_NAME} Card List ${card.localId}/${SET_OFFICIAL_COUNT} ${card.name} ${card.rarity || ''} Pokemon Card" width="245" height="337" loading="lazy"
           onerror="this.style.background='#1e293b'" width="245" height="337">
      <div class="card-item-info">
        <div class="card-item-name">${card.name}</div>
        <div class="card-item-num">#${card.localId}</div>
        <div class="card-item-price ${priceClass}">${priceText}</div>
      </div>`;
    el.addEventListener('click', () => {
      const sq = `${card.name} ${card.localId}/122 Chaos Rising Pokemon Card`;
      const directUrl = priceCache[card.localId]?.url || null;
      openModal(card.localId, card.name, card.rarity || '', sq, imgUrl, directUrl);
    });
    grid.appendChild(el);
  });
  displayedCount += slice.length;
  document.getElementById('card-count').textContent = `Showing ${Math.min(displayedCount, filteredCards.length)} of ${filteredCards.length} cards`;
  const btn = document.getElementById('load-more-btn');
  btn.style.display = displayedCount < filteredCards.length ? 'block' : 'none';
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const rarity = document.getElementById('rarity-filter').value;
  const sort   = document.getElementById('sort-select').value;

  let cards = allCards.filter(c => {
    const nameMatch = !search || c.name.toLowerCase().includes(search);
    const rarityMatch = !rarity || (c.rarity || '') === rarity;
    return nameMatch && rarityMatch;
  });

  if (sort === 'price') {
    cards = [...cards].sort((a, b) => {
      const pa = priceCache[a.localId]?.price ?? -1;
      const pb = priceCache[b.localId]?.price ?? -1;
      return pb - pa;
    });
  }

  filteredCards = cards;
  renderCards(true);
}

document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('rarity-filter').addEventListener('change', applyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);
document.getElementById('load-more-btn').addEventListener('click', () => renderCards(false));

// Analytics: search fires on every keystroke via applyFilters above, so
// tracking it directly there would flood GA4 with one event per character
// typed. Debounced separately here instead -- only fires ~800ms after the
// user stops typing, once per actual search "attempt" rather than per key.
let _searchTrackTimer = null;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(_searchTrackTimer);
  const value = e.target.value;
  _searchTrackTimer = setTimeout(() => {
    if (value && typeof gtag === 'function') {
      gtag('event', 'card_search_used', { search_term: value, page_path: location.pathname });
    }
  }, 800);
});
document.getElementById('rarity-filter').addEventListener('change', (e) => {
  if (typeof gtag === 'function') {
    gtag('event', 'rarity_filter_used', { rarity: e.target.value || '(all)', page_path: location.pathname });
  }
});
document.getElementById('sort-select').addEventListener('change', (e) => {
  if (typeof gtag === 'function') {
    gtag('event', 'sort_used', { sort_option: e.target.value, page_path: location.pathname });
  }
});

/* ===== MODAL ===== */

function toCardSlug(name, localId) {
  return name.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + localId;
}
function openModal(localId, name, rarity, searchQuery, imgUrl, directUrl) {
  if (!directUrl) directUrl = priceCache[localId]?.url || priceCache[localId.padStart(3,'0')]?.url || null;
  if (!imgUrl) imgUrl = cardImg(SET_ID, localId);
  const inner = document.getElementById('modal-inner');
  inner.innerHTML = `
    <img class="modal-img" src="${imgUrl}" alt="${name} Pokemon Card" loading="lazy" width="245" height="342">
    <div>
      <div class="modal-name">${name}</div>
      <div class="modal-meta">#${localId} / Chaos Rising</div>
      ${rarity ? `<div class="modal-meta" style="color:var(--accent-amber)">${rarity}</div>` : ''}
      <div class="modal-links">
        <a class="modal-buy-link pl-amazon" href="${amazonLink(searchQuery)}" target="_blank" rel="noopener">
          <span>🛒 Find on Amazon</span><span>→</span>
        </a>
        <a class="modal-buy-link pl-ebay" href="${ebayLink(searchQuery)}" target="_blank" rel="noopener">
          <span>🔍 Find on eBay</span><span>→</span>
        </a>
        <a class="modal-buy-link pl-tcgp" href="${tcgplayerCardLink(name, localId + '/' + SET_OFFICIAL_COUNT, SET_TCGP_SLUG)}" target="_blank" rel="noopener">
          <span>${directUrl ? 'TCGplayer' : '🔍 Find on TCGplayer'}</span><span>→</span>
        </a>
        <a class="modal-buy-link" href="/pokemon/sets/${SET_SERIES_SLUG}/${SET_URL_SLUG}/cards/${toCardSlug(name, localId)}" style="background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.25);color:#c084fc;">
          <span>📄 View Card Page</span><span>→</span>
        </a>
      </div>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay'))
    document.getElementById('modal-overlay').classList.remove('open');
});

/* ===== INIT ===== */
renderChaseCards();
renderProducts();
loadCards();

/* ===== HASH SCROLL ===== */
if (window.location.hash) {
  const target = document.querySelector(window.location.hash);
  if (target) {
    setTimeout(() => {
      const navHeight = document.getElementById('section-nav')?.offsetHeight || 60;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top, behavior: 'smooth' });
    }, 300);
  }
}

/* ===== HAMBURGER MENU ===== */
function initNav() {
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
    if (onepieceSetsView) {
      onepieceSetsView.classList.add('open');
      renderOnePieceSets();
    }
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
      if (!res.ok) {
        console.error('Failed to fetch sets');
        return;
      }
      allSets = await res.json();
      renderSets();
    } catch(e) {
      console.error('Error fetching sets:', e);
    }
  }
  
  function renderSets() {
    if (!allSets || allSets.length === 0) {
      setsGridContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px;">Loading sets...</div>';
      return;
    }
    
    let filteredSets = allSets;
    if (currentFilter === 'live') {
      filteredSets = allSets.filter(set => set.live);
    } else if (currentFilter !== 'all') {
      const normalizedFilter = currentFilter.toLowerCase().replace(/[^a-z0-9]/g, '');
      filteredSets = allSets.filter(set => {
        const normalizedSeries = set.series.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedSeries === normalizedFilter;
      });
    }
    
    const groupedSets = {};
    filteredSets.forEach(set => {
      if (!groupedSets[set.series]) {
        groupedSets[set.series] = [];
      }
      groupedSets[set.series].push(set);
    });
    
    let html = '';
    Object.keys(groupedSets).forEach(series => {
      html += `<div class="series-label">${series}</div>`;
      html += '<div class="sets-grid">';
      groupedSets[series].forEach(set => {
        const isDisabled = !set.live;
        const cardClass = isDisabled ? 'set-card disabled' : 'set-card';
        const link = isDisabled ? 'javascript:void(0)' : '/' + set.slug;
        const logoUrl = set.setId ? setLogoUrl(set.setId) : null;
        
        html += `
          <a href="${link}" class="${cardClass}">
            <div class="set-card-image">
              ${logoUrl ? `
                <img src="${logoUrl}" 
                     alt="${set.name}" 
                     style="width: 85%; max-width: 130px; height: auto; object-fit: contain;"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <div style="font-size: 3rem; display: none;">🎴</div>
              ` : `
                <div style="font-size: 3rem;">🎴</div>
              `}
            </div>
            <div class="set-card-content">
              <div class="set-card-name">${set.name}</div>
              <div class="set-card-info">${set.short} • ${set.series}</div>
              ${isDisabled ? '<span class="set-card-soon">Coming Soon</span>' : ''}
            </div>
          </a>
        `;
      });
      html += '</div>';
    });
    
    setsGridContainer.innerHTML = html;
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
    let html = '<div class="sets-grid">';
    filtered.forEach(set => {
      const isDisabled = !set.live;
      const link = isDisabled ? 'javascript:void(0)' : '/' + set.slug;
      const r2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
      const logoUrl = set.setId ? `${r2}/logos/op/${set.setId}.png` : null;
      html += `
        <a href="${link}" class="${isDisabled ? 'set-card disabled' : 'set-card'}">
          <div class="set-card-image">
            ${logoUrl ? `<img src="${logoUrl}" alt="${set.name}" style="width:85%;max-width:130px;height:auto;object-fit:contain;" onerror="this.style.display='none'">` : `<div style="font-size:3rem;">🃏</div>`}
          </div>
          <div class="set-card-content">
            <div class="set-card-name">${set.name}</div>
            <div class="set-card-info">${set.short || ''} • ${set.series || 'One Piece TCG'}</div>
            ${isDisabled ? '<span class="set-card-soon">Coming Soon</span>' : ''}
          </div>
        </a>`;
    });
    html += '</div>';
    setsGridContainerOp.innerHTML = html;
  }

  await fetchSets();
})();
} // end initNav

/* ===== NAV LOADER ===== */
fetch('/nav.html').then(r => r.text()).then(html => {
  const placeholder = document.getElementById('site-nav');
  const temp = document.createElement('div');
  temp.innerHTML = html;
  while (temp.firstChild) placeholder.parentNode.insertBefore(temp.firstChild, placeholder);
  placeholder.remove();
  initNav();
});

/* ===== SECTION NAV ACTIVE STATE ===== */
(function() {
  const btns = document.querySelectorAll('.section-nav-btn');
  const sections = ['section-chase','section-cards','section-products']
    .map(id => document.getElementById(id)).filter(Boolean);
  const currentPath = window.location.pathname;
  btns.forEach(btn => {
    if (btn.dataset.url && currentPath === btn.dataset.url) {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (btn.dataset.url) history.pushState(null, '', btn.dataset.url);
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  const navHeight = document.getElementById('section-nav')?.offsetHeight || 60;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        btns.forEach(b => b.classList.toggle('active', b.dataset.target === id));
      }
    });
  }, { rootMargin: `-${navHeight}px 0px -60% 0px`, threshold: 0 });
  sections.forEach(s => observer.observe(s));
})();


/* ===== CHASE SLIDER ARROWS ===== */
(function() {
  const slider = document.getElementById('chase-grid');
  const btnL   = document.getElementById('chase-arrow-left');
  const btnR   = document.getElementById('chase-arrow-right');
  if (!slider || !btnL || !btnR) return;
  const SCROLL_AMT = 440;
  function updateArrows() {
    btnL.classList.toggle('hidden', slider.scrollLeft <= 0);
    btnR.classList.toggle('hidden', slider.scrollLeft >= slider.scrollWidth - slider.clientWidth - 4);
  }
  btnL.addEventListener('click', () => slider.scrollBy({ left: -SCROLL_AMT, behavior: 'smooth' }));
  btnR.addEventListener('click', () => slider.scrollBy({ left:  SCROLL_AMT, behavior: 'smooth' }));
  slider.addEventListener('scroll', updateArrows, { passive: true });
  new MutationObserver(updateArrows).observe(slider, { childList: true });
  updateArrows();
})();


/* ===== SECTION NAV SETS DROPDOWN ===== */
(function() {
  const btn      = document.getElementById('nav-sets-btn');
  const dropdown = document.getElementById('nav-sets-dropdown');
  if (!btn || !dropdown) return;

  let populated = false;

  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('open');
    dropdown.classList.toggle('open', isOpen);
    btn.classList.toggle('open', isOpen);
    if (isOpen && !populated) await populateNavSets();
  });
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== btn) {
      dropdown.classList.remove('open');
      btn.classList.remove('open');
    }
  });

  async function populateNavSets() {
    try {
      const res = await fetch('/sets.json');
      const allSetsData = await res.json();
      // Only show Pokémon sets in this dropdown (OP sets have their own pages)
      const sets = allSetsData.filter(s => {
        const id = (s.setId || '').toLowerCase();
        return !id.startsWith('op') && !id.startsWith('eb') && !id.startsWith('st') && s.series !== 'One Piece TCG';
      });
      const grouped = {};
      sets.forEach(s => {
        if (!grouped[s.series]) grouped[s.series] = [];
        grouped[s.series].push(s);
      });
      let html = '';
      const currentPath = window.location.pathname.replace(/^\//,'').replace(/\.html$/,'');
      Object.entries(grouped).forEach(([series, seriesSets]) => {
        html += `<div class="nav-dropdown-series">${series}</div>`;
        seriesSets.forEach(s => {
          const isCurrent = currentPath === s.slug;
          const isDisabled = !s.live;
          // FIX: setLogoUrl already handles series derivation correctly
          const logoUrl = s.setId ? setLogoUrl(s.setId) : '';
          const cls = [isCurrent ? 'current' : '', isDisabled ? 'disabled' : ''].filter(Boolean).join(' ');
          html += `<a href="${isDisabled ? 'javascript:void(0)' : '/' + s.slug}" class="nav-dropdown-set ${cls}">
            ${logoUrl ? `<img src="${logoUrl}" alt="${s.name}" onerror="this.style.display='none'">` : ''}
            <span>${s.name}${isDisabled ? ' <span style="font-size:0.7rem;opacity:0.5">(coming soon)</span>' : ''}</span>
          </a>`;
        });
      });
      dropdown.innerHTML = html || '<div style="color:var(--text-muted);padding:12px;text-align:center;font-size:0.8rem">No sets available</div>';
      populated = true;
    } catch(e) {
      console.error('[Sets dropdown] failed:', e.message);
      dropdown.innerHTML = `<div style="color:var(--text-muted);padding:12px;text-align:center;font-size:0.8rem">Could not load sets: ${e.message}</div>`;
    }
  }
})();

