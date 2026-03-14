/**
 * generate-card-pages.js
 * Generates individual HTML pages for every card in a set.
 *
 * Usage:
 *   SET_ID=sv07 \
 *   SET_FULL_NAME="Stellar Crown (SV7)" \
 *   SET_SERIES="Scarlet & Violet" \
 *   SET_SERIES_SLUG="scarlet-violet" \
 *   SET_SLUG="stellar-crown" \
 *   SET_SLUG_FULL="stellar-crown-card-list" \
 *   TCGP_GROUP_ID=23537 \
 *   node scripts/generate-card-pages.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SET_ID         = process.env.SET_ID;
const SET_FULL_NAME  = process.env.SET_FULL_NAME;
const SET_SERIES     = process.env.SET_SERIES     || 'Scarlet & Violet';
const SET_SERIES_SLUG= process.env.SET_SERIES_SLUG|| 'scarlet-violet';
const SET_SLUG       = process.env.SET_SLUG;       // e.g. stellar-crown
const SET_SLUG_FULL  = process.env.SET_SLUG_FULL   || `${SET_SLUG}-card-list`;
const TCGP_GROUP_ID  = process.env.TCGP_GROUP_ID  || '';
const R2_PUBLIC_URL  = process.env.CF_R2_PUBLIC_URL|| '';
const SITE_URL       = 'https://tcgwatchtower.com';

if (!SET_ID || !SET_FULL_NAME || !SET_SLUG) {
  console.error('Missing required: SET_ID, SET_FULL_NAME, SET_SLUG');
  process.exit(1);
}

// Fetch card metadata from R2
const metaUrl = `${R2_PUBLIC_URL}/data/${SET_ID}.json`;
console.log(`📋 Fetching card metadata from ${metaUrl}...`);
const res = await fetch(metaUrl);
if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.status}`);
const metadata = await res.json();
const cards = metadata.cards || [];
console.log(`✅ ${cards.length} cards found for ${SET_FULL_NAME}`);

// Output directory
const outDir = path.join(ROOT, 'pokemon', 'sets', SET_SERIES_SLUG, SET_SLUG, 'cards');
fs.mkdirSync(outDir, { recursive: true });

// Slug helper
function toSlug(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cardSlug(card) {
  return `${toSlug(card.name)}-${card.localId}`;
}

function cardUrl(card) {
  return `${SITE_URL}/pokemon/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(card)}`;
}

function cardImgUrl(card) {
  return `${R2_PUBLIC_URL}/cards/${SET_ID}/${card.localId}.webp`;
}

function tcgpSearchUrl(card) {
  const query = encodeURIComponent(`${card.name} ${card.localId}/${metadata.cardCount?.official || ''} ${SET_FULL_NAME} Pokemon Card`);
  return `https://www.tcgplayer.com/search/pokemon/${SET_SLUG}?productLineName=pokemon&q=${query}&view=grid&productTypeName=Cards`;
}

function ebaySearchUrl(card) {
  const query = encodeURIComponent(`${card.name} ${card.localId} ${SET_FULL_NAME} Pokemon Card`);
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=2536`;
}

// Get 3 related cards (nearby in set)
function getRelated(card, allCards) {
  const idx = allCards.findIndex(c => c.localId === card.localId);
  const candidates = allCards.filter((_, i) => i !== idx);
  const nearby = [
    allCards[idx - 2], allCards[idx - 1],
    allCards[idx + 1], allCards[idx + 2]
  ].filter(Boolean).filter(c => c.localId !== card.localId);
  return nearby.slice(0, 3).length >= 2 ? nearby.slice(0, 3) : candidates.slice(0, 3);
}

function generateCardPage(card, allCards) {
  const slug = cardSlug(card);
  const url  = cardUrl(card);
  const img  = cardImgUrl(card);
  const related = getRelated(card, allCards);
  const cardListUrl = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/card-list`;
  const seriesUrl   = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}`;

  const title = `${card.name} ${card.localId} Price, Rarity & Card Info | Pokémon TCG`;
  const description = `View the price, rarity, and card details for ${card.name} #${card.localId} from the ${SET_FULL_NAME} Pokémon TCG expansion. Current market price and where to buy.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${img}">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "${card.name} #${card.localId}",
  "image": "${img}",
  "description": "${description}",
  "brand": { "@type": "Brand", "name": "Pokémon TCG" },
  "category": "Trading Card",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "USD",
    "price": "0",
    "priceSpecification": { "valueAddedTaxIncluded": false },
    "availability": "https://schema.org/InStock",
    "url": "${tcgpSearchUrl(card)}"
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
      { "@type": "ListItem", "position": 2, "name": "Pokémon TCG", "item": "${SITE_URL}/pokemon" },
      { "@type": "ListItem", "position": 3, "name": "${SET_SERIES}", "item": "${seriesUrl}" },
      { "@type": "ListItem", "position": 4, "name": "${SET_FULL_NAME}", "item": "${cardListUrl}" },
      { "@type": "ListItem", "position": 5, "name": "${card.name} #${card.localId}", "item": "${url}" }
    ]
  }
}
</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/x-icon" href="/favicon.ico">

<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0f172a;--surface:#1e293b;--surface2:#263548;--border:#334155;
  --text:#f1f5f9;--text-muted:#94a3b8;--accent:#3b82f6;--accent-amber:#f59e0b;
  --green:#22c55e;--red:#ef4444;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}

/* NAV */
nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:var(--text);letter-spacing:0.05em}
.nav-back{color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;gap:6px}
.nav-back:hover{color:var(--text)}

/* BREADCRUMB */
.breadcrumb{padding:0.75rem 1.5rem;font-size:0.8rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:0.5}

/* MAIN LAYOUT */
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
.card-layout{display:grid;grid-template-columns:340px 1fr;gap:2.5rem;align-items:start}
@media(max-width:768px){.card-layout{grid-template-columns:1fr}}

/* CARD IMAGE */
.card-image-wrap{position:sticky;top:72px}
.card-image-wrap img{width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.5);transition:transform 0.3s}
.card-image-wrap img:hover{transform:scale(1.02)}

/* CARD INFO */
.card-name{font-size:2rem;font-weight:700;line-height:1.2;margin-bottom:0.5rem}
.card-meta{color:var(--text-muted);font-size:0.95rem;margin-bottom:1.5rem}
.card-meta a{color:var(--accent)}
.card-meta a:hover{text-decoration:underline}

/* PRICE BOX */
.price-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem}
.price-label{font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem}
.price-value{font-size:2rem;font-weight:700;color:var(--accent-amber)}
.price-loading{font-size:1.5rem;color:var(--text-muted);animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.price-row{display:flex;gap:1.5rem;margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)}

/* INFO TABLE */
.info-table{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
.info-row{display:flex;border-bottom:1px solid var(--border);padding:0.75rem 1rem}
.info-row:last-child{border-bottom:none}
.info-key{width:140px;color:var(--text-muted);font-size:0.85rem;flex-shrink:0}
.info-val{font-size:0.9rem;font-weight:500}
.rarity-badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:0.75rem;font-weight:600;background:var(--surface2);border:1px solid var(--border)}

/* BUY BUTTONS */
.buy-buttons{display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem}
.btn{display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.25rem;border-radius:10px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;transition:opacity 0.2s}
.btn:hover{opacity:0.85}
.btn-tcgp{background:#1a6ef5;color:#fff}
.btn-ebay{background:#e43137;color:#fff}
.btn span:last-child{opacity:0.7}

/* DESCRIPTION */
.section-title{font-size:1rem;font-weight:700;margin-bottom:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em}
.card-description{font-size:0.95rem;line-height:1.7;color:var(--text-muted);margin-bottom:2rem}

/* RELATED */
.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem}
@media(max-width:480px){.related-grid{grid-template-columns:repeat(2,1fr)}}
.related-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color 0.2s}
.related-card:hover{border-color:var(--accent)}
.related-card img{width:100%;aspect-ratio:3/4;object-fit:cover;background:var(--surface2)}
.related-card-info{padding:0.6rem 0.75rem}
.related-card-name{font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-card-num{font-size:0.75rem;color:var(--text-muted)}
.related-card-price{font-size:0.8rem;color:var(--accent-amber);margin-top:2px}

/* SET BLOCK */
.set-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:2rem}
.set-block-title{font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem}
.set-links{display:flex;flex-direction:column;gap:0.5rem}
.set-link{color:var(--accent);font-size:0.9rem;display:flex;align-items:center;gap:6px}
.set-link:hover{text-decoration:underline}

footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem}
</style>
</head>
<body>

<nav>
  <a href="/" class="nav-logo">
    <img src="/tcg-watchtower-logo.jpg" alt="TCG Watchtower">
    <span>TCG Watchtower</span>
  </a>
  <a href="${cardListUrl}" class="nav-back">← ${SET_FULL_NAME} Card List</a>
</nav>

<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/pokemon">Pokémon TCG</a><span>›</span>
  <a href="${seriesUrl}">${SET_SERIES}</a><span>›</span>
  <a href="${cardListUrl}">${SET_FULL_NAME}</a><span>›</span>
  <span>${card.name} #${card.localId}</span>
</div>

<div class="container">
  <div class="card-layout">

    <!-- LEFT: Card Image -->
    <div class="card-image-wrap">
      <img src="${img}" alt="${card.name} #${card.localId} ${SET_FULL_NAME}" 
           onerror="this.style.background='#1e293b';this.style.aspectRatio='3/4'">
    </div>

    <!-- RIGHT: Card Info -->
    <div>
      <div class="card-name">${card.name}</div>
      <div class="card-meta">
        #${card.localId} · <a href="${cardListUrl}">${SET_FULL_NAME}</a> · ${SET_SERIES}
      </div>

      <!-- Price -->
      <div class="price-box">
        <div class="price-label">Market Price</div>
        <div class="price-value price-loading" id="card-price">Loading...</div>
        <div class="price-row">
          <span id="price-low">—</span>
          <span id="price-updated">Updating...</span>
        </div>
      </div>

      <!-- Info Table -->
      <div class="info-table">
        <div class="info-row"><div class="info-key">Card Name</div><div class="info-val">${card.name}</div></div>
        <div class="info-row"><div class="info-key">Card Number</div><div class="info-val">${card.localId} / ${metadata.cardCount?.official || '?'}</div></div>
        <div class="info-row"><div class="info-key">Set</div><div class="info-val"><a href="${cardListUrl}" style="color:var(--accent)">${SET_FULL_NAME}</a></div></div>
        <div class="info-row"><div class="info-key">Series</div><div class="info-val"><a href="${seriesUrl}" style="color:var(--accent)">${SET_SERIES}</a></div></div>
        <div class="info-row"><div class="info-key">Rarity</div><div class="info-val"><span class="rarity-badge">${card.rarity || 'Unknown'}</span></div></div>
      </div>

      <!-- Buy Buttons -->
      <div class="buy-buttons">
        <a class="btn btn-tcgp" href="${tcgpSearchUrl(card)}" target="_blank" rel="noopener">
          <span>Buy on TCGplayer</span><span>→</span>
        </a>
        <a class="btn btn-ebay" href="${ebaySearchUrl(card)}" target="_blank" rel="noopener">
          <span>Find on eBay</span><span>→</span>
        </a>
      </div>

      <!-- Description -->
      <div class="section-title">About This Card</div>
      <p class="card-description">
        ${card.name} #${card.localId} is a${card.rarity ? ` <strong>${card.rarity}</strong>` : ''} card from the <strong>${SET_FULL_NAME}</strong> expansion of the Pokémon Trading Card Game. 
        It is part of the ${SET_SERIES} series${card.rarity && card.rarity.toLowerCase().includes('rare') ? ', making it one of the harder cards to pull from a booster pack' : ''}.
        ${card.rarity && (card.rarity.toLowerCase().includes('ultra') || card.rarity.toLowerCase().includes('hyper') || card.rarity.toLowerCase().includes('special illustration')) ? 'As a high-rarity card, it is a sought-after collectible.' : ''}
      </p>

      <!-- Related Cards -->
      ${related.length > 0 ? `
      <div class="section-title">Related Cards from ${SET_FULL_NAME}</div>
      <div class="related-grid">
        ${related.map(r => `
        <a class="related-card" href="/pokemon/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(r)}">
          <img src="${R2_PUBLIC_URL}/cards/${SET_ID}/${r.localId}.webp" alt="${r.name}" loading="lazy" onerror="this.style.display='none'">
          <div class="related-card-info">
            <div class="related-card-name">${r.name}</div>
            <div class="related-card-num">#${r.localId}</div>
            <div class="related-card-price" data-related-id="${r.localId}">—</div>
          </div>
        </a>`).join('')}
      </div>` : ''}

      <!-- Set Navigation -->
      <div class="set-block">
        <div class="set-block-title">${SET_FULL_NAME}</div>
        <div class="set-links">
          <a class="set-link" href="${cardListUrl}">📋 View Full Card List →</a>
          <a class="set-link" href="${cardListUrl}#chase-cards">⭐ Most Valuable Cards →</a>
          <a class="set-link" href="${cardListUrl}#sealed-product">📦 Sealed Product Prices →</a>
        </div>
      </div>

    </div>
  </div>
</div>

<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. All card images and names are property of their respective owners.</p>
</footer>

<script>
// Load price from TCGplayer API
const GROUP_ID = '${TCGP_GROUP_ID}';
const LOCAL_ID = '${card.localId}';

async function loadPrice() {
  if (!GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + GROUP_ID);
    if (!res.ok) return;
    const data = await res.json();
    const prices = data.prices || {};
    const urls   = data.tcgpUrls || {};

    // Try padded and unpadded
    const padded   = LOCAL_ID.padStart(3, '0');
    const unpadded = String(parseInt(LOCAL_ID, 10));
    const price = prices[padded] ?? prices[unpadded];
    const url   = urls[padded]   ?? urls[unpadded];

    const priceEl = document.getElementById('card-price');
    if (price != null) {
      priceEl.textContent = '$' + price.toFixed(2);
      priceEl.classList.remove('price-loading');

      // Update buy button to direct URL if available
      if (url) {
        const tcgpBtn = document.querySelector('.btn-tcgp');
        if (tcgpBtn) tcgpBtn.href = url + '?sharedid=&irpid=7068180&afsrc=1&Language=English';
      }

      // Update related card prices
      document.querySelectorAll('[data-related-id]').forEach(el => {
        const rid = el.dataset.relatedId;
        const rp  = prices[rid.padStart(3,'0')] ?? prices[String(parseInt(rid,10))];
        if (rp != null) el.textContent = '$' + rp.toFixed(2);
      });
    } else {
      priceEl.textContent = 'N/A';
      priceEl.classList.remove('price-loading');
    }
    document.getElementById('price-updated').textContent = 'Updated today';
  } catch(e) {
    document.getElementById('card-price').textContent = 'N/A';
  }
}

loadPrice();
</script>

</body>
</html>`;
}

// Generate all card pages
let generated = 0;
const rewrites = [];

for (const card of cards) {
  const slug = cardSlug(card);
  const filename = `${slug}.html`;
  const filepath = path.join(outDir, filename);
  const html = generateCardPage(card, cards);
  fs.writeFileSync(filepath, html);
  rewrites.push({
    source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${slug}`,
    destination: `/pokemon/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${filename}`
  });
  generated++;
  if (generated % 50 === 0) console.log(`  Generated ${generated}/${cards.length}...`);
}

console.log(`\n✅ Generated ${generated} card pages`);
console.log(`📁 Output: pokemon/${SET_SERIES_SLUG}/${SET_SLUG}/cards/`);

// Update vercel.json with new rewrites
const vercelPath = path.join(ROOT, 'vercel.json');
const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

// Remove old card rewrites for this set and add new ones
vercel.rewrites = [
  ...vercel.rewrites.filter(r => !r.source.includes(`/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/`)),
  ...rewrites
];

fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2));
console.log(`✅ vercel.json updated with ${rewrites.length} card rewrites`);

// Update sitemap.xml
const sitemapPath = path.join(ROOT, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
const today = new Date().toISOString().split('T')[0];

const cardEntries = cards.map(c => `  <url>
    <loc>${SITE_URL}/pokemon/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(c)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

sitemap = sitemap.replace('</urlset>', `${cardEntries}\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap);
console.log(`✅ sitemap.xml updated with ${cards.length} card URLs`);
