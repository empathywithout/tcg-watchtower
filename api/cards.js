const priceCache = {};  // localId → { price, url } | null (null = confirmed no price)
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

      // Store prices
      Object.entries(prices).forEach(([num, price]) => {
        const withZeros    = num.padStart(3, '0');
        const withoutZeros = String(parseInt(num, 10));
        const url   = urls[num] || urls[withZeros] || urls[withoutZeros] || null;
        const entry = price != null ? { price, url } : null;
        priceCache[withZeros]    = entry;
        priceCache[withoutZeros] = entry;
      });
      // Also store URLs for cards that have a URL but no price entry
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
          priceEl.textContent = `$${cached.price.toFixed(2)}`;
          priceEl.classList.remove('loading');
        } else {
          priceEl.textContent = '';
          priceEl.classList.remove('loading');
        }
      });

      const grid = document.getElementById('chase-grid');
      if (grid && currentChaseList.length) renderChaseCardsHTML(grid);

      // Update sealed product prices
      const sealedPrices = data.sealedPrices || {};
      document.querySelectorAll('[data-tcgp-id]').forEach(el => {
        const tid = el.dataset.tcgpId;
        const price = sealedPrices[tid];
        if (price != null) {
          el.textContent = '$' + price.toFixed(2);
        }
      });

      // Update hero stack with top 3 chase cards by price
      if (currentChaseList.length) {
        const top3 = [...currentChaseList]
          .map(c => ({ ...c, price: priceCache[c.id]?.price ?? -1 }))
          .sort((a, b) => b.price - a.price)
          .slice(0, 3);
        document.querySelectorAll('#hero-stack img').forEach((img, i) => {
          if (top3[i]) img.src = top3[i].img || cardImg(SET_ID, top3[i].id);
        });
      }

      // Only re-render via applyFilters if price sort is active (targeted DOM updates above handle the rest)
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

async function loadCards() {
  document.getElementById('card-count').textContent = 'Loading cards…';
  try {
    let data = null;

    // Try R2 API first
    try {
      const res = await fetch(`/api/cards?set=${SET_ID}`);
      if (res.ok) {
        const json = await res.json();
        if (json && (json.cards || json).length > 0) data = json;
      }
    } catch(e) {}

    // Fall back to TCGdex directly — fetch cards with rarity in parallel batches
    if (!data) {
      const setRes = await fetch(`https://api.tcgdex.net/v2/en/sets/${SET_ID}`);
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
            image: `https://assets.tcgdex.net/en/sv/${SET_ID}/${basic.localId}/high.webp`,
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
      'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare'
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
    renderCards(true);
    loadTCGPlayerPrices(); // fetch all TCGplayer prices at once
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

    // Show cached price immediately if we already have it
    const cached = priceCache[card.localId];
    const priceText = cached?.price ? `$${cached.price.toFixed(2)}` : '';
    const priceClass = cached === undefined || (!cached && !(card.localId in priceCache)) ? 'loading' : '';

    el.innerHTML = `
      <img src="${imgUrl}" alt="${card.name} ${card.localId} ${SET_FULL_NAME} Pokemon Card" width="245" height="337" loading="lazy"
           onerror="this.style.background='#1e293b'" width="245" height="337">
      <div class="card-item-info">
        <div class="card-item-name">${card.name}</div>
        <div class="card-item-num">#${card.localId}</div>
        <div class="card-item-price ${priceClass}">${priceText}</div>
      </div>`;
    el.addEventListener('click', () => {
      const sq = `${card.name} ${card.localId}/${SET_OFFICIAL_COUNT} ${SET_FULL_NAME} Pokemon Card`;
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
    // Sort by known prices descending; unpriced cards go to the end
    cards = [...cards].sort((a, b) => {
      const pa = priceCache[a.localId]?.price ?? -1;
      const pb = priceCache[b.localId]?.price ?? -1;
      return pb - pa; // cards with no price (-1) sort to bottom
    });
  }

  filteredCards = cards;
  renderCards(true);
}

document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('rarity-filter').addEventListener('change', applyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);
document.getElementById('load-more-btn').addEventListener('click', () => renderCards(false));

/* ===== MODAL ===== */

function toCardSlug(name, localId) {
  return name.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + localId;
}
function openModal(localId, name, rarity, searchQuery, imgUrl, directUrl) {
  if (!directUrl) directUrl = priceCache[localId]?.url || priceCache[localId.padStart(3,'0')]?.url || null;
  if (!imgUrl) imgUrl = cardImg(SET_ID, localId);
  const inner = document.getElementById('modal-inner');
  inner.innerHTML = `
    <img class="modal-img" src="${imgUrl}" alt="${name} Pokemon Card" loading="lazy">
    <div>
      <div class="modal-name">${name}</div>
      <div class="modal-meta">#${localId} / ${SET_FULL_NAME}</div>
      ${rarity ? `<div class="modal-meta" style="color:var(--accent-amber)">${rarity}</div>` : ''}
      <div class="modal-links">

        <a class="modal-buy-link pl-ebay" href="${ebayLink(searchQuery)}" target="_blank" rel="noopener">
          <span>🔍 Find on eBay</span><span>→</span>
        </a>
        <a class="modal-buy-link pl-tcgp" href="${tcgplayerCardLink(name, localId + '/${SET_OFFICIAL_COUNT}', SET_TCGP_SLUG)}" target="_blank" rel="noopener">
          <span>${directUrl ? 'TCGplayer' : '🔍 Find on TCGplayer'}</span><span>→</span>
        </a>
        <a class="modal-buy-link" href="/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG_FOR_URL}/cards/${toCardSlug(name, localId)}" style="background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.25);color:#c084fc;">
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
loadCards(); // loadTCGPlayerPrices() is called inside loadCards() after cards are rendered

/* ===== HAMBURGER MENU ===== */
(async function() {
  const hamburger = document.getElementById('hamburger');
  const hamburgerOverlay = document.getElementById('hamburger-overlay');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  const pokemonMenuItem = document.getElementById('pokemon-menu-item');
  const pokemonSetsView = document.getElementById('pokemon-sets-view');
  const backToMenu = document.getElementById('back-to-menu');
  const setsGridContainer = document.getElementById('sets-grid-container');
  const filterTabs = document.querySelectorAll('.filter-tab');
  
  let allSets = [];
  let currentFilter = 'all';
  
  // Toggle hamburger menu
  function toggleHamburgerMenu() {
    const isOpen = hamburgerMenu.classList.contains('open');
    if (isOpen) {
      closeAllMenus();
    } else {
      hamburgerMenu.classList.add('open');
      hamburgerOverlay.classList.add('open');
      hamburger.classList.add('open');
    }
  }
  
  function closeAllMenus() {
    hamburgerMenu.classList.remove('open');
    pokemonSetsView.classList.remove('open');
    hamburgerOverlay.classList.remove('open');
    hamburger.classList.remove('open');
  }
  
  function showPokemonSets() {
    hamburgerMenu.classList.remove('open');
    pokemonSetsView.classList.add('open');
  }
  
  function backToMainMenu() {
    pokemonSetsView.classList.remove('open');
    hamburgerMenu.classList.add('open');
  }
  
  // Event listeners
  hamburger.addEventListener('click', toggleHamburgerMenu);
  hamburgerOverlay.addEventListener('click', closeAllMenus);
  pokemonMenuItem.addEventListener('click', showPokemonSets);
  backToMenu.addEventListener('click', backToMainMenu);
  
  // Close menu when clicking internal links
  hamburgerMenu.querySelectorAll('a[href^="#"], a[href^="/#"]').forEach(link => {
    link.addEventListener('click', closeAllMenus);
  });
  
  // Filter tabs
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderSets();
    });
  });
  
  // Fetch and render sets
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
    
    // Filter sets
    let filteredSets = allSets;
    if (currentFilter === 'live') {
      filteredSets = allSets.filter(set => set.live);
    } else if (currentFilter !== 'all') {
      // Normalize both the filter and series name for comparison
      const normalizedFilter = currentFilter.toLowerCase().replace(/[^a-z0-9]/g, '');
      filteredSets = allSets.filter(set => {
        const normalizedSeries = set.series.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedSeries === normalizedFilter;
      });
    }
    
    // Group by series
    const groupedSets = {};
    filteredSets.forEach(set => {
      if (!groupedSets[set.series]) {
        groupedSets[set.series] = [];
      }
      groupedSets[set.series].push(set);
    });
    
    // Render grouped sets
    let html = '';
    Object.keys(groupedSets).forEach(series => {
      html += `<div class="series-label">${series}</div>`;
      html += '<div class="sets-grid">';
      groupedSets[series].forEach(set => {
        const isDisabled = !set.live;
        const cardClass = isDisabled ? 'set-card disabled' : 'set-card';
        const link = isDisabled ? 'javascript:void(0)' : '/' + set.slug;
        
        // Get logo URL (R2 or TCGdex fallback)
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
  
  // Initialize
  await fetchSets();
})();

/* ===== SECTION NAV ACTIVE STATE ===== */
(function() {
  const btns = document.querySelectorAll('.section-nav-btn');
  const sections = ['section-chase','section-cards','section-products']
    .map(id => document.getElementById(id)).filter(Boolean);
  // Set initial active button based on current URL
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
      const sets = await res.json();
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
          const tcgdexSetId = {'sv3pt5':'sv03.5','sv4pt5':'sv04.5','sv6pt5':'sv06.5','sv8pt5':'sv08.5'}[s.setId] || s.setId;
          const logoUrl = s.setId ? `__R2_PUBLIC_URL__/logos/${s.setId}.png` : '';
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