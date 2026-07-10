// scripts/generate-sealed-product-pages.js
//
// Generates a standalone /sealed-product page for every set that already has
// a *-card-list.html file with a populated PRODUCT_META object. Reuses that
// same product data (tcgpId, name, type, search query) instead of requiring
// any new input — one script, no per-set config needed.
//
// This closes two gaps at once:
//  1. Every generated card page already links to .../sealed-product — but
//     that page has never existed anywhere on the site (404). This builds it.
//  2. Gives sealed product content its own title/meta targeting "buying
//     guide" / "price" search intent, instead of that content only living
//     inside the general card-list page's title (which doesn't mention
//     "sealed" or "buying guide" at all).
//
// Usage: node scripts/generate-sealed-product-pages.js
// Optional: LIMIT_TO=me05,me04 node scripts/generate-sealed-product-pages.js
//   to regenerate only specific sets (comma-separated setId list).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://tcgwatchtower.com';

const LIMIT_TO = (process.env.LIMIT_TO || '').trim()
  ? new Set(process.env.LIMIT_TO.split(',').map(s => s.trim()))
  : null;

// Known bad file — corrupted duplicate of temporal-forces-card-list.html
// with a broken canonical URL. Excluded here; should be deleted separately.
const SKIP_FILES = new Set(['fates-card-listtemporal-forces-card-list.html']);

function extractBalancedObject(src, startIdx) {
  // startIdx must point at the opening '{' of the object literal.
  let depth = 0, i = startIdx;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(startIdx, i);
}

function extractPageData(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');

  const canonicalMatch = src.match(/rel="canonical" href="https:\/\/tcgwatchtower\.com\/([^"]+)"/);
  if (!canonicalMatch) return null;
  const parts = canonicalMatch[1].split('/').filter(Boolean);
  // Pokemon: pokemon / sets / {seriesSlug} / {setSlug} / (cards|card-list)
  // One Piece: one-piece / sets / {setSlug} / (cards|card-list) — no series segment
  let seriesSlug, setSlug;
  if (parts[0] === 'pokemon' && parts[1] === 'sets' && parts.length >= 4) {
    seriesSlug = parts[2];
    setSlug    = parts[3];
  } else if (parts[0] === 'one-piece' && parts[1] === 'sets' && parts.length >= 3) {
    seriesSlug = null; // no series segment in the URL for One Piece
    setSlug    = parts[2];
  } else {
    return null;
  }
  const basePath = seriesSlug
    ? `pokemon/sets/${seriesSlug}/${setSlug}`
    : `one-piece/sets/${setSlug}`;
  // The final path segment varies by set — some use /cards, others /card-list.
  // Use whatever this file's own canonical actually says, not an assumption.
  const cardsSegment = parts[parts.length - 1];

  const titleMatch = src.match(/<title>([^<]+)/);
  const rawTitle   = titleMatch ? titleMatch[1] : setSlug;
  const setFullName = rawTitle.split(' Card List')[0].trim();

  const groupIdMatch = src.match(/const TCGP_GROUP_ID\s*=\s*'([^']*)'/);
  const tcgpGroupId  = groupIdMatch ? groupIdMatch[1] : '';

  const pmIdx = src.indexOf('const PRODUCT_META');
  if (pmIdx === -1) return null;
  const braceIdx = src.indexOf('{', pmIdx);
  if (braceIdx === -1) return null;
  const objText = extractBalancedObject(src, braceIdx);
  let productMeta;
  try {
    // Not all PRODUCT_META blocks are strict JSON — some are JS object
    // literals with comments and single-quoted keys. Evaluate as JS instead
    // of JSON.parse; safe here since this only ever runs against our own
    // already-committed source files, never external input.
    productMeta = new Function(`return (${objText});`)();
  } catch (e) {
    console.warn(`⚠️  Could not parse PRODUCT_META in ${filePath}: ${e.message}`);
    return null;
  }
  const products = Object.values(productMeta);
  if (products.length === 0) return null;

  const hasTopChase = fs.existsSync(path.join(ROOT, basePath, 'top-chase-cards.html'));
  const hasMostValuable = fs.existsSync(path.join(ROOT, basePath, 'most-valuable.html'));
  const gameName = seriesSlug ? 'Pokémon TCG' : 'One Piece TCG';

  return { seriesSlug, setSlug, basePath, cardsSegment, setFullName, tcgpGroupId, products, hasTopChase, hasMostValuable, gameName };
}

function amazonSearchUrl(q) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&linkCode=ll2&tag=cehutto01-20&language=en_US`;
}
function ebaySearchUrl(q) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&mkcid=1&mkrid=711-53200-19255-0&campid=5339145069&customid=&toolid=10001&mkevt=1`;
}
function tcgplayerSearchUrl(q) {
  return `https://partner.tcgplayer.com/c/7068180/1830156/21018?u=${encodeURIComponent(`https://www.tcgplayer.com/search/pokemon/product?q=${q}&view=grid`)}`;
}

function buildSealedProductPage(data) {
  const { seriesSlug, setSlug, basePath, cardsSegment, setFullName, tcgpGroupId, products, hasTopChase, hasMostValuable, gameName } = data;
  const pageUrl   = `${SITE_URL}/${basePath}/sealed-product`;
  const cardListUrl = `${SITE_URL}/${basePath}/${cardsSegment}`;
  const pageTitle = `${setFullName} Sealed Product Buying Guide: Prices & Where to Buy | ${gameName}`;
  const pageDesc  = `Current market prices for every ${setFullName} sealed product — Booster Boxes, Elite Trainer Boxes, and more. Compare prices and buy on TCGplayer, Amazon, or eBay.`;

  const productCards = products.map(p => {
    const amazonUrl = p.noAmazon ? null : amazonSearchUrl(p.q);
    const ebayUrl    = ebaySearchUrl(p.q);
    const tcgpUrl    = tcgplayerSearchUrl(p.q);
    return `
    <div class="product-card">
      <span class="product-type">${p.type}</span>
      <div class="product-name">${p.name}</div>
      <div class="product-price loading" data-tcgp-id="${p.tcgpId}">Loading...</div>
      <div class="product-links">
        ${amazonUrl ? `<a class="product-link pl-amazon" href="${amazonUrl}" target="_blank" rel="noopener">Amazon →</a>` : ''}
        <a class="product-link pl-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay →</a>
        <a class="product-link pl-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer →</a>
      </div>
    </div>`;
  }).join('');

  const relatedLinks = `
    ${hasTopChase ? `<a class="set-link" href="${SITE_URL}/${basePath}/top-chase-cards">🔥 Top Chase Cards →</a>` : ''}
    ${hasMostValuable ? `<a class="set-link" href="${SITE_URL}/${basePath}/most-valuable">⭐ Most Valuable Cards →</a>` : ''}
    <a class="set-link" href="${cardListUrl}">📋 View Full Card List →</a>`;

  const hubSlug = seriesSlug ? 'pokemon' : 'one-piece';
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
  "@type": "CollectionPage",
  "name": "${pageTitle}",
  "description": "${pageDesc}",
  "url": "${pageUrl}",
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
      { "@type": "ListItem", "position": 2, "name": "${gameName}", "item": "${SITE_URL}/${hubSlug}" },
      { "@type": "ListItem", "position": 3, "name": "${setFullName}", "item": "${cardListUrl}" },
      { "@type": "ListItem", "position": 4, "name": "Sealed Product Buying Guide", "item": "${pageUrl}" }
    ]
  }
}
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y');</script>
<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a||!a.href)return;var h=a.href;if(h.indexOf('discord.gg')>-1){gtag('event','discord_join_click',{page_path:location.pathname});}else if(h.indexOf('tcgplayer.com')>-1){gtag('event','affiliate_click',{retailer:'tcgplayer',page_path:location.pathname});}else if(h.indexOf('amazon.com')>-1){gtag('event','affiliate_click',{retailer:'amazon',page_path:location.pathname});}else if(h.indexOf('ebay.com')>-1){gtag('event','affiliate_click',{retailer:'ebay',page_path:location.pathname});}},true);</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#263548;--border:#334155;--text:#f1f5f9;--text-muted:#94a3b8;--accent:#3b82f6;--green:#22c55e;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.05em}
.nav-back{color:var(--text-muted);font-size:0.85rem}
.breadcrumb{padding:0.75rem 1.5rem;font-size:0.8rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:2rem;font-weight:700;margin-bottom:0.5rem}
.subtitle{color:var(--text-muted);margin-bottom:2rem}
.products-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1.25rem;margin-bottom:2rem}
.product-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem}
.product-type{display:inline-block;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--accent);margin-bottom:0.5rem}
.product-name{font-weight:600;margin-bottom:0.75rem;line-height:1.3}
.product-price{font-size:1.4rem;font-weight:700;color:var(--green);margin-bottom:1rem;min-height:1.75rem}
.product-price.loading{color:var(--text-muted);font-size:0.9rem;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.product-links{display:flex;flex-direction:column;gap:0.5rem}
.product-link{display:block;padding:0.55rem 0.75rem;border-radius:8px;font-size:0.85rem;font-weight:600;text-align:center;background:var(--surface2);border:1px solid var(--border)}
.product-link:hover{border-color:var(--accent)}
.set-links{display:flex;flex-wrap:wrap;gap:1rem;margin-top:1rem}
.set-link{color:var(--accent);font-size:0.9rem}
.set-link:hover{text-decoration:underline}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem;margin-top:3rem}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <img src="/tcg-watchtower-logo.jpg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="${cardListUrl}" class="nav-back">← ${setFullName} Card List</a>
</nav>
<div style="padding:3px 16px;text-align:center;font-size:.65rem;color:rgba(148,163,184,.4);letter-spacing:.02em;border-bottom:1px solid rgba(255,255,255,.04);">This site contains affiliate links for which we may be compensated.</div>
<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/${hubSlug}">${gameName}</a><span>›</span>
  <a href="${cardListUrl}">${setFullName}</a><span>›</span>
  <span>Sealed Product Buying Guide</span>
</div>
<div class="container">
  <h1>${setFullName} Sealed Product Buying Guide</h1>
  <p class="subtitle">Current market prices for every ${setFullName} sealed product — updated daily on TCG Watchtower</p>
  <div class="products-grid">
    ${productCards}
  </div>
  <div class="set-links">${relatedLinks}</div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. All card images and names are property of their respective owners.</p>
</footer>
<script>
const GROUP_ID = '${tcgpGroupId}';
async function loadPrices() {
  if (!GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + GROUP_ID);
    if (!res.ok) return;
    const data = await res.json();
    const sealedPrices = data.sealedPrices || {};
    document.querySelectorAll('[data-tcgp-id]').forEach(el => {
      const id = el.dataset.tcgpId;
      const price = sealedPrices[id];
      if (price != null) {
        el.textContent = '$' + price.toFixed(2);
        el.classList.remove('loading');
      } else {
        el.textContent = 'N/A';
        el.classList.remove('loading');
      }
    });
  } catch(e) {}
}
loadPrices();
</script>
<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');<\/script>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────
const cardListFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('-card-list.html') && !SKIP_FILES.has(f));

let generated = 0, skipped = 0;
const sitemapPath = path.join(ROOT, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');

for (const file of cardListFiles) {
  const data = extractPageData(path.join(ROOT, file));
  if (!data) {
    console.warn(`⚠️  Skipped ${file} — could not extract required data`);
    skipped++;
    continue;
  }
  const setIdGuess = data.setSlug; // used only for LIMIT_TO filtering convenience
  if (LIMIT_TO && !LIMIT_TO.has(setIdGuess) && !LIMIT_TO.has(file)) continue;

  const outDir = path.join(ROOT, data.basePath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sealed-product.html'), buildSealedProductPage(data));

  const pageUrl = `${SITE_URL}/${data.basePath}/sealed-product`;
  sitemap = sitemap.replace(
    new RegExp(`  <url>\\s*<loc>${pageUrl}</loc>[\\s\\S]*?</url>\\n?`, 'g'),
    ''
  );
  sitemap = sitemap.replace('</urlset>', `  <url>\n    <loc>${pageUrl}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n</urlset>`);

  console.log(`✅ Generated ${data.basePath}/sealed-product.html (${data.products.length} products)`);
  generated++;
}

fs.writeFileSync(sitemapPath, sitemap);
console.log(`\n${generated} sealed-product pages generated, ${skipped} skipped, sitemap.xml updated.`);
