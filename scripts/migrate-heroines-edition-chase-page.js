// scripts/migrate-heroines-edition-chase-page.js
//
// Heroines Edition's individual card pages have a separate, unrelated bug
// (empty rarity display), which blocks the normal Pokemon-style local-scrape
// approach for rebuilding its chase-cards page. But its EXISTING
// most-valuable.html was already correctly generated once (from real R2
// data, via the actual workflow) -- 39 real chase cards, correct rarity,
// correct sort order. This script extracts that already-correct card list
// directly from the existing page (not the broken individual card pages),
// rebuilds each card's buy buttons with the current fixed set (adds the
// previously-missing Amazon button + TCGplayer affiliate wrapper, which
// didn't exist when this page was first generated), and outputs the new
// merged top-chase-cards.html template around it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://tcgwatchtower.com';
const R2_PUBLIC_URL = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
const TCGP_AFFILIATE_BASE = 'https://partner.tcgplayer.com/c/7068180/1830156/21018';

const SET_ID = (process.env.SET_ID || 'eb03').trim();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || 'Heroines Edition').trim();
const SET_URL_SLUG = (process.env.SET_URL_SLUG || 'heroines-edition').trim();
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID || '24545').trim();

const oldPath = path.join(ROOT, 'one-piece', 'sets', SET_URL_SLUG, 'most-valuable.html');
const newPath = path.join(ROOT, 'one-piece', 'sets', SET_URL_SLUG, 'top-chase-cards.html');

const oldSrc = fs.readFileSync(oldPath, 'utf8');

// Extract each card-item block
const cardBlocks = oldSrc.split('<div class="card-item">').slice(1).map(b => '<div class="card-item">' + b.split('</div><div class="card-item">')[0]);

function extractCards(src) {
  const cards = [];
  const re = /<div class="card-item">\s*<a href="\/one-piece\/sets\/[^"]+\/cards\/([^"]+)">\s*<img src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<div class="card-name">([^<]*)<\/div>\s*<div class="card-num">([^<]*)<\/div>\s*<span class="rarity-badge ([^"]*)">([^<]*)<\/span>\s*<div class="card-price[^"]*" data-price-key="([^"]*)">/g;
  let m;
  while ((m = re.exec(src))) {
    cards.push({
      slug: m[1], img: m[2], alt: m[3], name: m[4].trim(),
      dispNum: m[5].trim(), badgeClass: m[6], label: m[7], priceKey: m[8],
    });
  }
  return cards;
}

const cards = extractCards(oldSrc);
console.log(`Extracted ${cards.length} cards from existing most-valuable.html`);
if (cards.length === 0) {
  console.error('❌ No cards extracted — regex likely did not match. Aborting without writing anything.');
  process.exit(1);
}

const RARITY_LABEL_TO_NAME = {
  'MR': 'Manga Rare', 'SEC': 'Secret Rare', 'TR': 'Treasure Rare',
  'SP': 'Special', 'SR': 'Super Rare', 'R': 'Rare',
};

function cardImgUrlFromExisting(c) { return c.img; } // already a full, correct URL

const topCard = cards[0] ? { name: cards[0].name, rarity: RARITY_LABEL_TO_NAME[cards[0].label] || cards[0].label } : null;
const rarityList = [...new Set(cards.map(c => RARITY_LABEL_TO_NAME[c.label] || c.label))].filter(Boolean).join(', ');

const mvPageUrl = `${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/top-chase-cards`;
const mvTitle   = `${SET_FULL_NAME} Chase Cards: Most Valuable Cards Ranked by Price | One Piece TCG`;
const mvDesc    = `See every ${SET_FULL_NAME} chase card ranked by current market price — the most valuable Manga Rares, Secret Rares, and SP cards in the set. Updated daily, with pull-rate context and where to buy.`;

const faqItems = [
  {
    q: `What are the chase cards in ${SET_FULL_NAME}?`,
    a: `The chase cards in ${SET_FULL_NAME} are its highest-rarity pulls — ${rarityList || 'its highest-rarity cards'}. These are the cards collectors specifically hope to pull from a booster box, and the main driver of a box's resale value.`,
  },
  ...(topCard ? [{
    q: `What is the most valuable ${SET_FULL_NAME} card?`,
    a: `${topCard.name} is typically the most valuable ${SET_FULL_NAME} pull, as a ${topCard.rarity} card. See live pricing for it and every other chase card ranked below.`,
    id: 'faq-top-answer',
  }] : []),
  {
    q: `How many chase cards are in ${SET_FULL_NAME}?`,
    a: `${cards.length} chase cards are ranked on this page for ${SET_FULL_NAME}.`,
  },
];
const faqSchema = {
  "@context": "https://schema.org", "@type": "FAQPage",
  "mainEntity": faqItems.map(item => ({
    "@type": "Question", "name": item.q,
    "acceptedAnswer": { "@type": "Answer", "text": item.a },
  })),
};
const faqHtml = faqItems.map(item => `
    <div class="faq-item">
      <h3 class="faq-q">${item.q}</h3>
      <p class="faq-a"${item.id ? ` id="${item.id}"` : ''}>${item.a}</p>
    </div>`).join('');

const cardsGridHtml = cards.map(c => {
  const tcgpRawUrl = `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${encodeURIComponent(c.name + ' ' + c.dispNum + ' One Piece')}&view=grid`;
  const tcgpUrl = `${TCGP_AFFILIATE_BASE}?u=${encodeURIComponent(tcgpRawUrl)}`;
  const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(c.name + ' ' + c.dispNum + ' ' + SET_FULL_NAME + ' One Piece Card')}&linkCode=ll2&tag=cehutto01-20&language=en_US`;
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(c.name + ' ' + c.dispNum + ' ' + SET_FULL_NAME + ' One Piece Card')}&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339145069&toolid=10001&mkevt=1`;
  return `<div class="card-item">
      <a href="/one-piece/sets/${SET_URL_SLUG}/cards/${c.slug}">
        <img src="${c.img}" alt="${c.alt}" width="200" height="279" loading="lazy" onerror="this.style.background='#1e293b'">
      </a>
      <div class="card-info">
        <div class="card-name">${c.name}</div>
        <div class="card-num">${c.dispNum}</div>
        <span class="rarity-badge ${c.badgeClass}">${c.label}</span>
        <div class="card-price loading" data-price-key="${c.priceKey}">—</div>
        <div class="buy-links">
          <a class="buy-link buy-amazon" href="${amazonUrl}" target="_blank" rel="noopener">Amazon</a>
          <a class="buy-link buy-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="buy-link buy-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay</a>
        </div>
      </div>
    </div>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${mvTitle}</title>
<meta name="description" content="${mvDesc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${mvPageUrl}">
<meta name='impact-site-verification' value='4069a06f-34a9-45bf-9cbf-563c3b047710'>
<meta property="og:title" content="${mvTitle}">
<meta property="og:description" content="${mvDesc}">
<meta property="og:url" content="${mvPageUrl}">
<meta property="og:type" content="website">
${cards[0] ? `<meta property="og:image" content="${cards[0].img}">
<meta name="twitter:image" content="${cards[0].img}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "${mvTitle}",
  "description": "${mvDesc}",
  "url": "${mvPageUrl}",
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
      { "@type": "ListItem", "position": 2, "name": "One Piece TCG", "item": "${SITE_URL}/one-piece" },
      { "@type": "ListItem", "position": 3, "name": "${SET_FULL_NAME}", "item": "${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/cards" },
      { "@type": "ListItem", "position": 4, "name": "Chase Cards", "item": "${mvPageUrl}" }
    ]
  }
}<\/script>
<script type="application/ld+json">
${JSON.stringify(faqSchema, null, 2)}
<\/script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y');</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap" rel="stylesheet"></noscript>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0514;--surface:#0f172a;--surface2:#1e293b;--border:rgba(255,255,255,.08);--text:#f1f5f9;--muted:#94a3b8;--amber:#fbbf24;--green:#22c55e;--red:#ef4444;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;background-image:linear-gradient(to bottom right,#0f0a1a,#1a0a2e,#0a1520)}
a{color:inherit;text-decoration:none}
nav{background:rgba(10,5,20,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Saira Condensed',sans-serif;font-weight:700;text-transform:uppercase;font-size:1.2rem;color:var(--text);letter-spacing:.05em}
.nav-back{color:var(--muted);font-size:.85rem;transition:color .2s}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:.75rem 1.5rem;font-size:.8rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:.5}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-family:'Bebas Neue',sans-serif;font-size:2.5rem;letter-spacing:.04em;margin-bottom:.5rem}
.subtitle{color:var(--muted);margin-bottom:2rem;font-size:.95rem}
.intro-text{color:var(--muted);font-size:0.9rem;line-height:1.7;margin-bottom:2rem;max-width:800px}
.set-link-top{display:inline-block;margin-bottom:1.5rem;color:var(--amber);font-size:0.9rem;font-weight:600}
.set-link-top:hover{text-decoration:underline}
.faq-section{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border)}
.faq-heading{font-size:1.4rem;font-weight:700;margin-bottom:1.25rem}
.faq-item{margin-bottom:1.25rem}
.faq-q{font-size:1rem;font-weight:700;margin-bottom:0.4rem;color:var(--text)}
.faq-a{color:var(--muted);font-size:0.9rem;line-height:1.6}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1.5rem}
@media(max-width:640px){.cards-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem}}
.card-item{background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s,transform .2s}
.card-item:hover{border-color:rgba(239,68,68,.4);transform:translateY(-2px)}
.card-item img{width:100%;aspect-ratio:245/337;object-fit:contain;background:rgba(15,23,42,.85);display:block}
.card-info{padding:.75rem}
.card-name{font-weight:700;font-size:.85rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-num{font-size:.75rem;color:var(--muted);margin-bottom:6px;font-family:monospace}
.rarity-badge{display:inline-flex;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;margin-bottom:8px}
.badge-mr{background:linear-gradient(135deg,rgba(251,191,36,.3),rgba(239,68,68,.3));border:1px solid rgba(251,191,36,.6);color:#fde68a}
.badge-sec{background:linear-gradient(135deg,rgba(251,191,36,.2),rgba(239,68,68,.2));border:1px solid rgba(251,191,36,.4);color:#fbbf24}
.badge-tr{background:linear-gradient(135deg,rgba(251,191,36,.2),rgba(249,115,22,.2));border:1px solid rgba(251,191,36,.4);color:#fb923c}
.badge-sp{background:linear-gradient(135deg,rgba(168,85,247,.2),rgba(59,130,246,.2));border:1px solid rgba(168,85,247,.4);color:#c084fc}
.badge-sr{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#f87171}
.badge-r{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.card-price{font-size:1.1rem;font-weight:700;color:var(--green);margin-bottom:10px;min-height:1.6rem;font-family:monospace}
.card-price.loading{color:var(--muted);font-size:.8rem;font-weight:400}
.buy-links{display:flex;gap:3px;justify-content:center}
.buy-link{flex:1;padding:3px 3px;border-radius:6px;font-size:0.6rem;font-weight:700;white-space:nowrap;overflow:hidden;text-decoration:none;transition:all 0.2s;display:inline-flex;align-items:center;justify-content:center;gap:4px;text-align:center}
.buy-amazon{background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24}
.buy-amazon:hover{background:rgba(251,191,36,0.25)}
.buy-ebay{background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#93c5fd}
.buy-ebay:hover{background:rgba(59,130,246,0.25)}
.buy-tcgp{background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.3);color:#4ade80;font-size:0.5rem}
.buy-tcgp:hover{background:rgba(74,222,128,0.25)}
.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--amber);margin-top:2.5rem;font-size:.9rem;transition:color .2s}
.back-link:hover{color:white}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--muted);font-size:.8rem;line-height:1.6;margin-top:3rem}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <img src="/logo-mark.svg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards" class="nav-back">← ${SET_FULL_NAME} Card List</a>
</nav>
<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/one-piece">One Piece TCG</a><span>›</span>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards">${SET_FULL_NAME}</a><span>›</span>
  <span>Chase Cards</span>
</div>
<div class="container">
  <h1>${SET_FULL_NAME} Chase Cards</h1>
  <p class="subtitle">${cards.length} chase cards ranked by market price — the most valuable pulls in ${SET_FULL_NAME}, updated daily</p>
  <p class="intro-text">This page ranks every ${SET_FULL_NAME} chase card by current market price, including ${rarityList || 'every high-rarity card in the set'}. Chase cards are the highest-rarity cards in a set — the ones collectors specifically hope to pull from a booster box, and the main driver of a box's resale value. Prices update automatically throughout the day.</p>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards" class="set-link-top">View the complete ${SET_FULL_NAME} card list and prices →</a>
  <div class="cards-grid" id="cards-grid">
    ${cardsGridHtml}
  </div>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards" class="back-link">← View Full ${SET_FULL_NAME} Card List</a>
  <div class="faq-section">
    <h2 class="faq-heading">Frequently Asked Questions</h2>
    ${faqHtml}
  </div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with or endorsed by Bandai or the One Piece Card Game. Prices sourced from TCGplayer via TCGCSV.</p>
  <p style="margin-top:6px">TCG Watchtower participates in affiliate programs including eBay Partner Network and TCGplayer. We may earn a commission on qualifying purchases.</p>
</footer>
<script>
const GROUP_ID = '${TCGP_GROUP_ID}';
async function loadPrices() {
  if (!GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + GROUP_ID + '&game=onepiece');
    if (!res.ok) return;
    const { prices = {} } = await res.json();
    document.querySelectorAll('[data-price-key]').forEach(el => {
      const key = el.dataset.priceKey;
      const price = prices[key];
      if (price != null) {
        el.textContent = '$' + price.toFixed(2);
        el.classList.remove('loading');
      } else {
        el.textContent = '—';
        el.classList.remove('loading');
      }
    });
    const grid = document.getElementById('cards-grid');
    const items = [...grid.querySelectorAll('.card-item')];
    items.sort((a, b) => {
      const pa = parseFloat(a.querySelector('[data-price-key]').textContent.replace('$', '')) || 0;
      const pb = parseFloat(b.querySelector('[data-price-key]').textContent.replace('$', '')) || 0;
      return pb - pa;
    });
    items.forEach(i => grid.appendChild(i));
    const faqEl = document.getElementById('faq-top-answer');
    if (faqEl && items[0]) {
      const topName = items[0].querySelector('.card-name')?.textContent;
      const topPriceText = items[0].querySelector('[data-price-key]')?.textContent;
      if (topName && topPriceText && topPriceText !== '—') {
        faqEl.textContent = topName + ' is currently the most valuable chase card in this set, priced at ' + topPriceText + '. See live pricing for it and every other chase card ranked below.';
      }
    }
  } catch(e) { console.warn('Prices unavailable:', e.message); }
}
loadPrices();
</script>
</body>
</html>`;

fs.writeFileSync(newPath, html);
fs.unlinkSync(oldPath);
console.log(`✅ Migrated ${cards.length} cards to ${newPath}, removed old most-valuable.html`);
