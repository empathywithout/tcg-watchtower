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

const SET_ID          = process.env.SET_ID;
const SET_FULL_NAME   = process.env.SET_FULL_NAME;
const SET_SERIES      = process.env.SET_SERIES      || 'Scarlet & Violet';
const SET_SERIES_SLUG = process.env.SET_SERIES_SLUG || 'scarlet-violet';
const SET_SLUG        = process.env.SET_SLUG;
const SET_SLUG_FULL   = process.env.SET_SLUG_FULL   || `${SET_SLUG}-card-list`;
const TCGP_GROUP_ID   = process.env.TCGP_GROUP_ID   || '';
const R2_PUBLIC_URL   = process.env.CF_R2_PUBLIC_URL || '';
const SITE_URL        = 'https://tcgwatchtower.com';

const TCGP_SLUG_MAP = {
  'sv01':   'sv01-scarlet-and-violet-base-set',
  'sv02':   'sv02-paldea-evolved',
  'sv03':   'sv03-obsidian-flames',
  'sv3pt5': 'sv3pt5-151',
  'sv04':   'sv04-paradox-rift',
  'sv4pt5': 'sv4pt5-paldean-fates',
  'sv05':   'sv05-temporal-forces',
  'sv06':   'sv06-twilight-masquerade',
  'sv6pt5': 'sv6pt5-shrouded-fable',
  'sv07':   'sv07-stellar-crown',
  'sv08':   'sv08-surging-sparks',
  'sv8pt5': 'sv8pt5-prismatic-evolutions',
  'sv09':   'sv09-journey-together',
  'sv10':   'sv10-destined-rivals',
  'me01':   'me01-mega-evolution',
};
const TCGP_SET_SLUG = TCGP_SLUG_MAP[SET_ID] || SET_SLUG;

if (!SET_ID || !SET_FULL_NAME || !SET_SLUG) {
  console.error('Missing required: SET_ID, SET_FULL_NAME, SET_SLUG');
  process.exit(1);
}

// ─── Fetch card metadata from R2 ────────────────────────────────────────────

const metaUrl = `${R2_PUBLIC_URL}/data/${SET_ID}.json`;
console.log(`📋 Fetching card metadata from ${metaUrl}...`);
const res = await fetch(metaUrl);
if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.status}`);
const metadata = await res.json();
const cards = metadata.cards || [];
console.log(`✅ ${cards.length} cards found for ${SET_FULL_NAME}`);
console.log(`🔗 TCGplayer slug: ${TCGP_SET_SLUG} (SET_ID=${SET_ID})`);

// ─── Output directory ────────────────────────────────────────────────────────

const outDir = path.join(ROOT, 'pokemon', 'sets', SET_SERIES_SLUG, SET_SLUG, 'cards');
fs.mkdirSync(outDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  return `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(card)}`;
}

function cardImgUrl(card) {
  return `${R2_PUBLIC_URL}/cards/${SET_ID}/${card.localId}.webp`;
}

function tcgpSearchUrl(card) {
  const baseName = card.name.replace(/\s*[-–]\s*[\d/]+.*$/, '').trim();
  const official = metadata.cardCount?.official || '';
  const q = encodeURIComponent(`${baseName} ${card.localId}${official ? '/' + official : ''}`);
  const slug = TCGP_SET_SLUG || 'sv01-scarlet-and-violet-base-set';
  return `https://www.tcgplayer.com/search/pokemon/${slug}?productLineName=pokemon&q=${q}&view=grid&Language=English&productTypeName=Cards&sharedid=&irpid=7068180&afsrc=1&setName=${slug}`;
}

function ebaySearchUrl(card) {
  const query = encodeURIComponent(`${card.name} ${card.localId} ${SET_FULL_NAME} Pokemon Card`);
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=2536`;
}

function getRelated(card, allCards) {
  const idx = allCards.findIndex(c => c.localId === card.localId);
  const nearby = [
    allCards[idx - 2], allCards[idx - 1],
    allCards[idx + 1], allCards[idx + 2]
  ].filter(Boolean).filter(c => c.localId !== card.localId);
  const candidates = allCards.filter((_, i) => i !== idx);
  return nearby.slice(0, 3).length >= 2 ? nearby.slice(0, 3) : candidates.slice(0, 3);
}

// ─── vercel.json helper ───────────────────────────────────────────────────────

const vercelPath = path.join(ROOT, 'vercel.json');

const CARD_WILDCARD = {
  source: '/pokemon/sets/:series/:set/cards/:slug',
  destination: '/pokemon/sets/:series/:set/cards/:slug.html',
};

/**
 * Read vercel.json, apply a mutation, write it back.
 * The wildcard is always stripped before mutating and re-appended last,
 * so it can never end up stranded mid-array no matter how many times
 * the script runs.
 */
function updateVercel(mutate) {
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  vercel.rewrites = vercel.rewrites || [];
  // Strip wildcard so mutate() never has to worry about it
  vercel.rewrites = vercel.rewrites.filter(r => r.source !== CARD_WILDCARD.source);
  mutate(vercel);
  // Always pin wildcard last
  vercel.rewrites.push(CARD_WILDCARD);
  fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2));
}

// ─── Shared page fragments ────────────────────────────────────────────────────

const cardListUrl = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards`;
const seriesUrl   = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}`;

const sharedFonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<link rel="icon" type="image/x-icon" href="/favicon.ico">`;

const sharedNav = `<nav>
  <a href="/" class="nav-logo">
    <img src="/tcg-watchtower-logo.jpg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="${cardListUrl}" class="nav-back">← ${SET_FULL_NAME} Card List</a>
</nav>`;

function breadcrumb(lastLabel) {
  return `<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/pokemon">Pokémon TCG</a><span>›</span>
  <a href="${seriesUrl}">${SET_SERIES}</a><span>›</span>
  <a href="${cardListUrl}">${SET_FULL_NAME}</a><span>›</span>
  <span>${lastLabel}</span>
</div>`;
}

const impactScript = `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');<\/script>`;

// ─── Card page template ───────────────────────────────────────────────────────

function generateCardPage(card, allCards) {
  const url         = cardUrl(card);
  const img         = cardImgUrl(card);
  const related     = getRelated(card, allCards);
  const title       = `${card.name} ${card.localId} Price, Rarity & Card Info | Pokémon TCG`;
  const description = `View the price, rarity, and card details for ${card.name} #${card.localId} from the ${SET_FULL_NAME} Pokémon TCG expansion. Current market price and where to buy.`;

  return `<!-- Generated: ${new Date().toISOString()} -->
<!DOCTYPE html>
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
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="${img}" fetchpriority="high">
${sharedFonts}
<noscript><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0f172a;--surface:#1e293b;--surface2:#263548;--border:#334155;
  --text:#f1f5f9;--text-muted:#94a3b8;--accent:#3b82f6;--accent-amber:#f59e0b;
  --green:#22c55e;--red:#ef4444;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:var(--text);letter-spacing:0.05em}
.nav-back{color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;gap:6px}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:0.75rem 1.5rem;font-size:0.8rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:0.5}
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
.card-layout{display:grid;grid-template-columns:340px 1fr;gap:2.5rem;align-items:start}
@media(max-width:768px){.card-layout{grid-template-columns:1fr}}
.card-image-wrap{position:sticky;top:72px}
.card-image-wrap img{width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.5);transition:transform 0.3s}
.card-image-wrap img:hover{transform:scale(1.02)}
.card-name{font-size:2rem;font-weight:700;line-height:1.2;margin-bottom:0.5rem}
.card-meta{color:var(--text-muted);font-size:0.95rem;margin-bottom:1.5rem}
.card-meta a{color:var(--accent)}
.card-meta a:hover{text-decoration:underline}
.price-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem}
.price-label{font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem}
.price-value{font-size:2rem;font-weight:700;color:var(--accent-amber)}
.price-loading{font-size:1.5rem;color:var(--text-muted);animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.price-row{display:flex;gap:1.5rem;margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)}
.info-table{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
.info-row{display:flex;border-bottom:1px solid var(--border);padding:0.75rem 1rem}
.info-row:last-child{border-bottom:none}
.info-key{width:140px;color:var(--text-muted);font-size:0.85rem;flex-shrink:0}
.info-val{font-size:0.9rem;font-weight:500}
.rarity-badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:0.75rem;font-weight:600;background:var(--surface2);border:1px solid var(--border)}
.buy-buttons{display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem}
.btn{display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.25rem;border-radius:10px;font-weight:600;font-size:0.9rem;cursor:pointer;border:none;transition:opacity 0.2s}
.btn:hover{opacity:0.85}
.btn-tcgp{background:#1a6ef5;color:#fff}
.btn-ebay{background:#e43137;color:#fff}
.btn span:last-child{opacity:0.7}
.section-title{font-size:1rem;font-weight:700;margin-bottom:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em}
.card-description{font-size:0.95rem;line-height:1.7;color:var(--text-muted);margin-bottom:2rem}
.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem}
@media(max-width:480px){.related-grid{grid-template-columns:repeat(2,1fr)}}
.related-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color 0.2s}
.related-card:hover{border-color:var(--accent)}
.related-card img{width:100%;aspect-ratio:245/337;object-fit:contain;background:var(--surface2)}
.related-card-info{padding:0.6rem 0.75rem}
.related-card-name{font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-card-num{font-size:0.75rem;color:var(--text-muted)}
.related-card-price{font-size:0.8rem;color:var(--accent-amber);margin-top:2px}
.set-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:2rem}
.set-block-title{font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem}
.set-links{display:flex;flex-direction:column;gap:0.5rem}
.set-link{color:var(--accent);font-size:0.9rem;display:flex;align-items:center;gap:6px}
.set-link:hover{text-decoration:underline}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem}
</style>
</head>
<body>
${sharedNav}
${breadcrumb(`${card.name} #${card.localId}`)}
<div class="container">
  <div class="card-layout">

    <div class="card-image-wrap">
      <img src="${img}" alt="${card.name} #${card.localId} ${SET_FULL_NAME}" width="400" height="557"
           fetchpriority="high" onerror="this.style.background='#1e293b';this.style.aspectRatio='3/4'">
    </div>

    <div>
      <div class="card-name">${card.name}</div>
      <div class="card-meta">
        #${card.localId} · <a href="${cardListUrl}">${SET_FULL_NAME}</a> · ${SET_SERIES}
      </div>

      <div class="price-box">
        <div class="price-label">Market Price</div>
        <div class="price-value price-loading" id="card-price">Loading...</div>
        <div class="price-row">
          <span id="price-low">—</span>
          <span id="price-updated">Updating...</span>
        </div>
      </div>

      <div class="info-table">
        <div class="info-row"><div class="info-key">Card Name</div><div class="info-val">${card.name}</div></div>
        <div class="info-row"><div class="info-key">Card Number</div><div class="info-val">${card.localId} / ${metadata.cardCount?.official || '?'}</div></div>
        <div class="info-row"><div class="info-key">Set</div><div class="info-val"><a href="${cardListUrl}" style="color:var(--accent)">${SET_FULL_NAME}</a></div></div>
        <div class="info-row"><div class="info-key">Series</div><div class="info-val"><a href="${seriesUrl}" style="color:var(--accent)">${SET_SERIES}</a></div></div>
        <div class="info-row"><div class="info-key">Rarity</div><div class="info-val"><span class="rarity-badge">${card.rarity || 'Unknown'}</span></div></div>
      </div>

      <div class="buy-buttons">
        <a class="btn btn-tcgp" href="${tcgpSearchUrl(card)}" target="_blank" rel="noopener">
          <span>Buy on TCGplayer</span><span>→</span>
        </a>
        <a class="btn btn-ebay" href="${ebaySearchUrl(card)}" target="_blank" rel="noopener">
          <span>Find on eBay</span><span>→</span>
        </a>
      </div>

      <div class="section-title">About This Card</div>
      <p class="card-description">
        ${card.name} #${card.localId} is a${card.rarity ? ` <strong>${card.rarity}</strong>` : ''} card from the <strong>${SET_FULL_NAME}</strong> expansion of the Pokémon Trading Card Game.
        It is part of the ${SET_SERIES} series${card.rarity && card.rarity.toLowerCase().includes('rare') ? ', making it one of the harder cards to pull from a booster pack' : ''}.
        ${card.rarity && (card.rarity.toLowerCase().includes('ultra') || card.rarity.toLowerCase().includes('hyper') || card.rarity.toLowerCase().includes('special illustration')) ? 'As a high-rarity card, it is a sought-after collectible.' : ''}
      </p>

      ${related.length > 0 ? `
      <div class="section-title">Related Cards from ${SET_FULL_NAME}</div>
      <div class="related-grid">
        ${related.map(r => `
        <a class="related-card" href="/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(r)}">
          <img src="${R2_PUBLIC_URL}/cards/${SET_ID}/${r.localId}.webp" alt="${r.name} ${r.localId} ${SET_FULL_NAME} Pokemon Card" width="200" height="279" loading="lazy" onerror="this.style.display='none'">
          <div class="related-card-info">
            <div class="related-card-name">${r.name}</div>
            <div class="related-card-num">#${r.localId}</div>
            <div class="related-card-price" data-related-id="${r.localId}">—</div>
          </div>
        </a>`).join('')}
      </div>` : ''}

      <div class="set-block">
        <div class="set-block-title">${SET_FULL_NAME}</div>
        <div class="set-links">
          <a class="set-link" href="${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards">📋 View Full Card List →</a>
          <a class="set-link" href="${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable">⭐ Most Valuable Cards →</a>
          <a class="set-link" href="${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/sealed-product">📦 Sealed Product Prices →</a>
        </div>
      </div>

    </div>
  </div>
</div>

<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. All card images and names are property of their respective owners.</p>
</footer>

<script>
const GROUP_ID = '${TCGP_GROUP_ID}';
const LOCAL_ID = '${card.localId}';

async function loadPrice() {
  if (!GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + GROUP_ID);
    if (!res.ok) return;
    const data = await res.json();
    const prices = data.prices || {};
    const padded   = LOCAL_ID.padStart(3, '0');
    const unpadded = String(parseInt(LOCAL_ID, 10));
    const price = prices[padded] ?? prices[unpadded];
    const priceEl = document.getElementById('card-price');
    if (price != null) {
      priceEl.textContent = '$' + price.toFixed(2);
      priceEl.classList.remove('price-loading');
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
${impactScript}
</body>
</html>`;
}

// ─── Generate all card pages ──────────────────────────────────────────────────

let generated = 0;
for (const card of cards) {
  const filepath = path.join(outDir, `${cardSlug(card)}.html`);
  fs.writeFileSync(filepath, generateCardPage(card, cards));
  generated++;
  if (generated % 50 === 0) console.log(`  Generated ${generated}/${cards.length}...`);
}
console.log(`\n✅ Generated ${generated} card pages`);
console.log(`📁 Output: pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/`);

// ─── vercel.json — card list + sealed-product rewrites ───────────────────────

const individualCardPattern = new RegExp(
  `^/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/[^/]+$`
);

updateVercel(vercel => {
  vercel.rewrites = vercel.rewrites.filter(r =>
    !individualCardPattern.test(r.source) &&
    r.source !== `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards` &&
    r.source !== `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/sealed-product`
  );
  vercel.rewrites.push(
    { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards`,          destination: `/${SET_SLUG_FULL}.html` },
    { source: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/sealed-product`, destination: `/${SET_SLUG_FULL}.html` },
  );
});
console.log(`✅ vercel.json updated with card-list/sealed-product rewrites + wildcard pinned last`);

// ─── sitemap.xml — card pages ─────────────────────────────────────────────────

const sitemapPath = path.join(ROOT, 'sitemap.xml');
const today = new Date().toISOString().split('T')[0];

const cardEntries = cards.map(c => `  <url>
    <loc>${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${cardSlug(c)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

let sitemap = fs.readFileSync(sitemapPath, 'utf8');
sitemap = sitemap.replace('</urlset>', `${cardEntries}\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap);
console.log(`✅ sitemap.xml updated with ${cards.length} card URLs`);

// ─── Chase cards shared helpers ───────────────────────────────────────────────

const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Ultra Rare', 'Illustration Rare'];
const RARITY_TIER    = { 'Hyper Rare': 0, 'Special Illustration Rare': 1, 'Ultra Rare': 2, 'Illustration Rare': 3 };
const RARITY_LABEL   = { 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };

function normalizeRarity(r) {
  return (r || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

const chaseCards = cards
  .filter(c => CHASE_RARITIES.includes(normalizeRarity(c.rarity)))
  .sort((a, b) => (RARITY_TIER[normalizeRarity(a.rarity)] ?? 99) - (RARITY_TIER[normalizeRarity(b.rarity)] ?? 99));

const setDir = path.join(ROOT, 'pokemon', 'sets', SET_SERIES_SLUG, SET_SLUG);
fs.mkdirSync(setDir, { recursive: true });

const chaseStyles = `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#263548;--border:#334155;--text:#f1f5f9;--text-muted:#94a3b8;--accent:#3b82f6;--accent-amber:#f59e0b;--green:#22c55e;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:var(--text);letter-spacing:0.05em}
.nav-back{color:var(--text-muted);font-size:0.85rem}.nav-back:hover{color:var(--text)}
.breadcrumb{padding:0.75rem 1.5rem;font-size:0.8rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:2rem;font-weight:700;margin-bottom:0.5rem}
.subtitle{color:var(--text-muted);margin-bottom:2rem}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1.5rem}
.card-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color 0.2s,transform 0.2s;cursor:pointer}
.card-item:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-item img{width:100%;aspect-ratio:245/337;object-fit:contain;background:var(--surface2)}
.card-info{padding:0.75rem}
.card-name{font-weight:600;font-size:0.85rem;margin-bottom:2px}
.card-num{font-size:0.75rem;color:var(--text-muted);margin-bottom:6px}
.card-rarity{display:inline-block;padding:2px 8px;border-radius:99px;font-size:0.7rem;font-weight:700;margin-bottom:8px}
.rarity-hr{background:rgba(251,191,36,0.2);border:1px solid rgba(251,191,36,0.4);color:#fbbf24}
.rarity-sir{background:rgba(251,191,36,0.2);border:1px solid rgba(251,191,36,0.4);color:#fbbf24}
.rarity-ur{background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#f87171}
.rarity-ir{background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc}
.card-price{font-size:1rem;font-weight:700;color:var(--green);margin-bottom:8px;min-height:1.5rem}
.card-price.loading{color:var(--text-muted);font-size:0.8rem}
.buy-btns{display:flex;gap:6px}
.btn{flex:1;padding:6px;border-radius:6px;font-size:0.75rem;font-weight:600;text-align:center;border:none;cursor:pointer}
.btn-tcgp{background:#1a6ef5;color:#fff}
.btn-ebay{background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#93c5fd}
.btn:hover{opacity:0.85}
.set-link{display:inline-flex;align-items:center;gap:6px;color:var(--accent);margin-top:2rem;font-size:0.9rem}
.set-link:hover{text-decoration:underline}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem;margin-top:3rem}`;

const chaseScript = `const TCGP_GROUP_ID = '${TCGP_GROUP_ID}';
async function loadPrices() {
  if (!TCGP_GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + TCGP_GROUP_ID);
    if (!res.ok) return;
    const data = await res.json();
    const prices = data.prices || {};
    document.querySelectorAll('[data-local-id]').forEach(el => {
      const id = el.dataset.localId;
      const price = prices[id.padStart(3,'0')] ?? prices[String(parseInt(id,10))];
      if (price != null) {
        el.textContent = '$' + price.toFixed(2);
        el.classList.remove('loading');
      } else {
        el.textContent = 'N/A';
        el.classList.remove('loading');
      }
    });
    const grid = document.getElementById('cards-grid');
    const items = [...grid.querySelectorAll('.card-item')];
    items.sort((a, b) => {
      const pa = parseFloat(a.querySelector('[data-local-id]').textContent.replace('$','')) || 0;
      const pb = parseFloat(b.querySelector('[data-local-id]').textContent.replace('$','')) || 0;
      return pb - pa;
    });
    items.forEach(i => grid.appendChild(i));
  } catch(e) {}
}
loadPrices();`;

function chaseCardGridItems(cardList) {
  return cardList.map(c => {
    const rarity      = normalizeRarity(c.rarity);
    const rarityClass = RARITY_TIER[rarity] === 0 ? 'rarity-hr'
                      : RARITY_TIER[rarity] === 1 ? 'rarity-sir'
                      : RARITY_TIER[rarity] === 2 ? 'rarity-ur'
                      : 'rarity-ir';
    const label    = RARITY_LABEL[rarity] || rarity;
    const img      = `${R2_PUBLIC_URL}/cards/${SET_ID}/${c.localId}.webp`;
    const slug     = toSlug(c.name) + '-' + c.localId;
    const baseName = c.name.replace(/\s*[-–]\s*[\d/]+.*$/, '').trim();
    const official = metadata.cardCount?.official || '';
    const tcgpSlug = TCGP_SET_SLUG || 'sv01-scarlet-and-violet-base-set';
    const tcgpUrl  = `https://www.tcgplayer.com/search/pokemon/${tcgpSlug}?productLineName=pokemon&q=${encodeURIComponent(baseName + ' ' + c.localId + (official ? '/' + official : ''))}&view=grid&Language=English&productTypeName=Cards&sharedid=&irpid=7068180&afsrc=1&setName=${tcgpSlug}`;
    const ebayUrl  = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(c.name + ' ' + c.localId + ' ' + SET_FULL_NAME + ' Pokemon Card')}`;
    return `
    <div class="card-item">
      <a href="/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards/${slug}">
        <img src="${img}" alt="${c.name} ${c.localId} ${SET_FULL_NAME} Pokemon Card" width="180" height="251" loading="lazy" onerror="this.style.background='#1e293b'">
      </a>
      <div class="card-info">
        <div class="card-name">${c.name}</div>
        <div class="card-num">#${c.localId}</div>
        <span class="card-rarity ${rarityClass}">${label}</span>
        <div class="card-price loading" data-local-id="${c.localId}">Loading...</div>
        <div class="buy-btns">
          <a class="btn btn-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="btn btn-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

function buildChasePage({ pageUrl, pageTitle, pageDesc, h1, breadcrumbLabel, schemaType }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${pageDesc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${pageDesc}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "${schemaType}",
  "name": "${pageTitle}",
  "description": "${pageDesc}",
  "url": "${pageUrl}",
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
      { "@type": "ListItem", "position": 2, "name": "Pokémon TCG", "item": "${SITE_URL}/pokemon" },
      { "@type": "ListItem", "position": 3, "name": "${SET_SERIES}", "item": "${seriesUrl}" },
      { "@type": "ListItem", "position": 4, "name": "${SET_FULL_NAME}", "item": "${cardListUrl}" },
      { "@type": "ListItem", "position": 5, "name": "${breadcrumbLabel}", "item": "${pageUrl}" }
    ]
  }
}
<\/script>
${sharedFonts}
<style>${chaseStyles}</style>
</head>
<body>
${sharedNav}
${breadcrumb(breadcrumbLabel)}
<div class="container">
  <h1>${h1}</h1>
  <p class="subtitle">${chaseCards.length} chase cards ranked by market price — updated daily from TCGplayer</p>
  <div class="cards-grid" id="cards-grid">
    ${chaseCardGridItems(chaseCards)}
  </div>
  <a href="${cardListUrl}" class="set-link">← View Full ${SET_FULL_NAME} Card List</a>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. Prices sourced from TCGplayer via TCGCSV.</p>
</footer>
<script>${chaseScript}<\/script>
${impactScript}
</body>
</html>`;
}

// ─── Most Valuable page ───────────────────────────────────────────────────────

const mvpUrl   = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable`;
const mvpTitle = `Most Valuable ${SET_FULL_NAME} Cards | Prices & Rankings | Pokémon TCG`;
const mvpDesc  = `The most valuable ${SET_FULL_NAME} Pokémon cards ranked by price. See current market prices for all Hyper Rare, Special Illustration Rare, and Ultra Rare cards.`;

fs.writeFileSync(path.join(setDir, 'most-valuable.html'), buildChasePage({
  pageUrl: mvpUrl, pageTitle: mvpTitle, pageDesc: mvpDesc,
  h1: `Most Valuable ${SET_FULL_NAME} Cards`,
  breadcrumbLabel: 'Most Valuable Cards',
  schemaType: 'CollectionPage',
}));
console.log(`✅ Generated most-valuable page: pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable.html`);

updateVercel(vercel => {
  vercel.rewrites = vercel.rewrites.filter(r =>
    r.source !== `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable`
  );
  vercel.rewrites.push({
    source:      `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable`,
    destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/most-valuable.html`,
  });
});
console.log(`✅ vercel.json updated with most-valuable rewrite`);

let sitemap2 = fs.readFileSync(sitemapPath, 'utf8');
sitemap2 = sitemap2.replace('</urlset>', `  <url>
    <loc>${mvpUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap2);
console.log(`✅ sitemap.xml updated with most-valuable URL`);

// ─── Top Chase Cards page ─────────────────────────────────────────────────────

const chaseUrl   = `${SITE_URL}/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/top-chase-cards`;
const chaseTitle = `${SET_FULL_NAME} Top Chase Cards | Best Pulls & Rare Cards | Pokémon TCG`;
const chaseDesc  = `The most valuable ${SET_FULL_NAME} chase cards ranked by price — every Hyper Rare, Special Illustration Rare, Ultra Rare, and Illustration Rare. See current market prices and where to buy.`;

fs.writeFileSync(path.join(setDir, 'top-chase-cards.html'), buildChasePage({
  pageUrl: chaseUrl, pageTitle: chaseTitle, pageDesc: chaseDesc,
  h1: `${SET_FULL_NAME} Top Chase Cards`,
  breadcrumbLabel: 'Top Chase Cards',
  schemaType: 'CollectionPage',
}));
console.log(`✅ Generated top-chase-cards page: pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/top-chase-cards.html`);

updateVercel(vercel => {
  vercel.rewrites = vercel.rewrites.filter(r =>
    r.source !== `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/top-chase-cards`
  );
  vercel.rewrites.push({
    source:      `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/top-chase-cards`,
    destination: `/pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/top-chase-cards.html`,
  });
});
console.log(`✅ vercel.json updated with top-chase-cards rewrite`);

let sitemap3 = fs.readFileSync(sitemapPath, 'utf8');
sitemap3 = sitemap3.replace('</urlset>', `  <url>
    <loc>${chaseUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap3);
console.log(`✅ sitemap.xml updated with top-chase-cards URL`);
