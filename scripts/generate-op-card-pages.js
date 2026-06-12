/**
 * generate-op-card-pages.js
 * Generates individual HTML pages for every card in a One Piece TCG set.
 *
 * Usage (via GitHub Actions workflow or locally):
 *   SET_ID=op15 \
 *   SET_FULL_NAME="Adventure on Kami's Island" \
 *   SET_URL_SLUG=adventure-on-kamis-island \
 *   TCGP_GROUP_ID=24637 \
 *   CF_R2_PUBLIC_URL=https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev \
 *   node scripts/generate-op-card-pages.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SET_ID        = (process.env.SET_ID || '').trim();
const SET_FULL_NAME = (process.env.SET_FULL_NAME || '').trim();
const SET_SHORT_NAME = (process.env.SET_SHORT_NAME || SET_ID.toUpperCase()).trim();
const R2_PUBLIC_URL = (process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev').trim();
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID || '').trim();
const SITE_URL      = 'https://tcgwatchtower.com';

const rawUrlSlug  = (process.env.SET_URL_SLUG || '').trim();
const SET_URL_SLUG = rawUrlSlug || SET_FULL_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!SET_ID || !SET_FULL_NAME) {
  console.error('❌ Missing required: SET_ID, SET_FULL_NAME');
  process.exit(1);
}

// ─── Fetch card metadata from R2 ─────────────────────────────────────────────

const metaUrl = `${R2_PUBLIC_URL}/data/op/${SET_ID}.json`;
console.log(`📋 Fetching card metadata from ${metaUrl}...`);
const res = await fetch(metaUrl);
if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.status}`);
const metadata = await res.json();
const cards = metadata.cards || [];
console.log(`✅ ${cards.length} cards found for ${SET_FULL_NAME}`);
console.log(`📁 URL path: /one-piece/sets/${SET_URL_SLUG}/cards/`);

// ─── Output directory ─────────────────────────────────────────────────────────

const outDir = path.join(ROOT, 'one-piece', 'sets', SET_URL_SLUG, 'cards');
fs.mkdirSync(outDir, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(name) {
  return (name || '').toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cardSlug(card) {
  const displayId = card.localId.includes('_') ? card.localId.split('_')[0] : card.localId;
  return `${toSlug(card.name)}-${toSlug(displayId)}`;
}

function cardUrl(card) {
  return `${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/cards/${cardSlug(card)}`;
}

function cardImgUrl(card) {
  const isCrossSet = /^[A-Z]{2,}\d+-/.test(card.localId);
  return `${R2_PUBLIC_URL}/cards/op/${SET_ID}/${card.localId}.webp${isCrossSet ? '?v=2' : ''}`;
}

function displayNumber(localId) {
  return localId.includes('_') ? localId.split('_')[0] : localId;
}

function tcgpSearchUrl(card) {
  const name = (card.name || '').replace(/\s*[(][^)]*[)]\s*$/, '').trim();
  const num  = displayNumber(card.localId);
  const q    = encodeURIComponent(`${name} ${num} One Piece`);
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${q}&view=grid`;
}

function ebaySearchUrl(card) {
  const num   = displayNumber(card.localId);
  const query = encodeURIComponent(`${card.name} ${num} ${SET_FULL_NAME} One Piece Card`);
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339145069&toolid=10001&mkevt=1`;
}

function getRelated(card, allCards) {
  const idx = allCards.findIndex(c => c.localId === card.localId);
  const nearby = [
    allCards[idx - 2], allCards[idx - 1],
    allCards[idx + 1], allCards[idx + 2],
  ].filter(Boolean).filter(c => c.localId !== card.localId);
  return nearby.slice(0, 3).length >= 2
    ? nearby.slice(0, 3)
    : allCards.filter((_, i) => i !== idx).slice(0, 3);
}

const RARITY_LABEL = {
  'Manga Rare': 'MR', 'Secret Rare': 'SEC', 'Treasure Rare': 'TR',
  'Alternate Art': 'ALT', 'Special': 'SP', 'Super Rare': 'SR',
  'Rare': 'R', 'Uncommon': 'UC', 'Common': 'C', 'Leader': 'L', 'Promo': 'PR',
};

// ─── vercel.json helper ───────────────────────────────────────────────────────

const vercelPath = path.join(ROOT, 'vercel.json');

const OP_CARD_WILDCARD = {
  source:      '/one-piece/sets/:set/cards/:slug',
  destination: '/one-piece/sets/:set/cards/:slug.html',
};

function updateVercel(mutate) {
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  vercel.rewrites = vercel.rewrites || [];
  vercel.redirects = vercel.redirects || [];
  vercel.rewrites = vercel.rewrites.filter(r => r.source !== OP_CARD_WILDCARD.source);
  mutate(vercel);
  vercel.rewrites.push(OP_CARD_WILDCARD);
  fs.writeFileSync(vercelPath, JSON.stringify(vercel, null, 2));
}

// ─── Shared fragments ─────────────────────────────────────────────────────────

const cardListUrl = `${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/cards`;

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
  <a href="/one-piece">One Piece TCG</a><span>›</span>
  <a href="/one-piece/sets">All Sets</a><span>›</span>
  <a href="${cardListUrl}">${SET_FULL_NAME}</a><span>›</span>
  <span>${lastLabel}</span>
</div>`;
}

const impactScript = `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');<\/script>`;

const gaScript = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y');</script>`;

// ─── Card page template ───────────────────────────────────────────────────────

function generateCardPage(card, allCards) {
  const url         = cardUrl(card);
  const img         = cardImgUrl(card);
  const related     = getRelated(card, allCards);
  const dispNum     = displayNumber(card.localId);
  const rarity      = card.rarity || '';
  const rarityLabel = RARITY_LABEL[rarity] || rarity;
  const isCrossSet  = /^[A-Z]{2,}\d+-/.test(card.localId);

  const cardDisplayName = card.name
    .replace(/\s*[(](altArt|specialAltArt|mangaAltArt|treasureRare)[)]\s*$/i, '')
    .trim();
  const variantLabel = card.isVariant && card.variantType
    ? ` (${card.variantType.replace(/([A-Z])/g, ' $1').trim()})`
    : '';
  const fullDisplayName = cardDisplayName + variantLabel;

  const setShortId  = dispNum.includes('-') ? dispNum : `${SET_SHORT_NAME}-${dispNum}`;
  const title       = `${fullDisplayName} ${setShortId} Price, Rarity & Info | ${SET_FULL_NAME} One Piece TCG`;
  const description = `${fullDisplayName} (${setShortId}) from ${SET_FULL_NAME} — ${rarity} One Piece TCG card. Live TCGplayer market price, rarity info, and where to buy.`;

  // Price key for JS — mirrors the prices API key format exactly
  // Cross-set base: "OP11-106"
  // Cross-set variant: "EB04-044_mangaaltart" (keep full localId)
  // Primary variant: "118_mangaaltart"
  // Primary base: "118"
  const baseLocalId = card.localId.includes('_') ? card.localId.split('_')[0] : card.localId;
  const variantSuffix = card.localId.includes('_') ? '_' + card.localId.split('_').slice(1).join('_') : '';
  const priceKey = isCrossSet
    ? (baseLocalId + variantSuffix)  // full cross-set ID including variant suffix
    : (dispNum.padStart(3, '0') + variantSuffix);

  return `<!-- Generated: ${new Date().toISOString()} -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="keywords" content="${fullDisplayName}, ${dispNum}, ${SET_FULL_NAME}, ${SET_SHORT_NAME}, One Piece TCG, One Piece card game, ${rarity}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<meta name='impact-site-verification' value='4069a06f-34a9-45bf-9cbf-563c3b047710'>
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
  "name": "${fullDisplayName} #${dispNum}",
  "image": "${img}",
  "description": "${description}",
  "brand": { "@type": "Brand", "name": "One Piece Card Game" },
  "category": "Trading Card",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "USD",
    "price": "0",
    "availability": "https://schema.org/InStock",
    "url": "${tcgpSearchUrl(card)}"
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}" },
      { "@type": "ListItem", "position": 2, "name": "One Piece TCG", "item": "${SITE_URL}/one-piece" },
      { "@type": "ListItem", "position": 3, "name": "${SET_FULL_NAME}", "item": "${cardListUrl}" },
      { "@type": "ListItem", "position": 4, "name": "${fullDisplayName} #${dispNum}", "item": "${url}" }
    ]
  }
}
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="${img}" fetchpriority="high">
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
${gaScript}
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0514;--surface:#0f172a;--surface2:#1e293b;--border:rgba(255,255,255,.08);
  --text:#f1f5f9;--muted:#94a3b8;--red:#ef4444;--orange:#f97316;--amber:#fbbf24;--green:#22c55e;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;background-image:linear-gradient(to bottom right,#0f0a1a,#1a0a2e,#0a1520)}
a{color:inherit;text-decoration:none}
nav{background:rgba(10,5,20,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:var(--text);letter-spacing:.05em}
.nav-back{color:var(--muted);font-size:.85rem;transition:color .2s}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:.75rem 1.5rem;font-size:.8rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:.5}
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
.card-layout{display:grid;grid-template-columns:340px 1fr;gap:2.5rem;align-items:start}
@media(max-width:768px){.card-layout{grid-template-columns:1fr}}
.card-image-wrap{position:sticky;top:72px}
.card-image-wrap img{width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);transition:transform .3s}
.card-image-wrap img:hover{transform:scale(1.02)}
.card-name{font-size:1.8rem;font-weight:700;line-height:1.2;margin-bottom:.5rem}
.card-meta{color:var(--muted);font-size:.95rem;margin-bottom:1.5rem}
.card-meta a{color:var(--amber)}
.card-meta a:hover{text-decoration:underline}
.price-box{background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem}
.price-label{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem}
.price-value{font-size:2rem;font-weight:700;color:var(--green);font-family:'Bebas Neue',sans-serif;letter-spacing:.02em}
.price-loading{color:var(--muted);animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.price-updated{font-size:.75rem;color:var(--muted);margin-top:.4rem}
.info-table{background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
.info-row{display:flex;border-bottom:1px solid var(--border);padding:.75rem 1rem}
.info-row:last-child{border-bottom:none}
.info-key{width:140px;color:var(--muted);font-size:.85rem;flex-shrink:0}
.info-val{font-size:.9rem;font-weight:500}
.rarity-badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:.75rem;font-weight:700}
.badge-mr{background:linear-gradient(135deg,rgba(251,191,36,.3),rgba(239,68,68,.3));border:1px solid rgba(251,191,36,.6);color:#fde68a}
.badge-sec{background:linear-gradient(135deg,rgba(251,191,36,.2),rgba(239,68,68,.2));border:1px solid rgba(251,191,36,.4);color:#fbbf24}
.badge-tr{background:linear-gradient(135deg,rgba(251,191,36,.2),rgba(249,115,22,.2));border:1px solid rgba(251,191,36,.4);color:#fb923c}
.badge-sp{background:linear-gradient(135deg,rgba(168,85,247,.2),rgba(59,130,246,.2));border:1px solid rgba(168,85,247,.4);color:#c084fc}
.badge-sr{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#f87171}
.badge-r{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.badge-default{background:rgba(30,41,59,.8);border:1px solid var(--border);color:var(--muted)}
.buy-buttons{display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.5rem}
.btn{display:flex;align-items:center;justify-content:space-between;padding:.85rem 1.25rem;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:opacity .2s}
.btn:hover{opacity:.85}
.btn-tcgp{background:linear-gradient(135deg,rgba(74,222,128,.2),rgba(59,130,246,.2));border:1px solid rgba(74,222,128,.3);color:#4ade80}
.btn-ebay{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.btn span:last-child{opacity:.7}
.section-title{font-size:.9rem;font-weight:700;margin-bottom:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.card-description{font-size:.95rem;line-height:1.7;color:var(--muted);margin-bottom:2rem}
.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem}
@media(max-width:480px){.related-grid{grid-template-columns:repeat(2,1fr)}}
.related-card{background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .2s,transform .2s}
.related-card:hover{border-color:rgba(239,68,68,.4);transform:translateY(-2px)}
.related-card img{width:100%;aspect-ratio:245/337;object-fit:contain;background:rgba(15,23,42,.85)}
.related-card-info{padding:.6rem .75rem}
.related-card-name{font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-card-num{font-size:.75rem;color:var(--muted)}
.related-card-price{font-size:.8rem;color:var(--green);margin-top:2px}
.set-block{background:rgba(15,23,42,.9);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:2rem}
.set-block-title{font-size:.85rem;color:var(--muted);margin-bottom:.75rem}
.set-links{display:flex;flex-direction:column;gap:.5rem}
.set-link{color:var(--amber);font-size:.9rem;display:flex;align-items:center;gap:6px;transition:color .2s}
.set-link:hover{color:white}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--muted);font-size:.8rem;line-height:1.6;margin-top:2rem}
</style>
</head>
<body>
${sharedNav}
${breadcrumb(`${fullDisplayName} #${dispNum}`)}
<div class="container">
  <div class="card-layout">
    <div class="card-image-wrap">
      <img src="${img}" alt="${fullDisplayName} ${dispNum} ${SET_FULL_NAME} One Piece Card"
           width="400" height="558" fetchpriority="high"
           alt="${fullDisplayName} ${setShortId} ${rarity} ${SET_FULL_NAME} One Piece TCG Card"
           onerror="this.style.background='#1e293b';this.style.aspectRatio='5/7'">
    </div>
    <div>
      <div class="card-name">${fullDisplayName} <span style="font-size:1.2rem;opacity:.6;font-weight:500">(${setShortId})</span></div>
      <div class="card-meta">
        ${dispNum} · <a href="${cardListUrl}">${SET_FULL_NAME}</a> · One Piece TCG
      </div>
      <div class="price-box">
        <div class="price-label">TCGplayer Market Price</div>
        <div class="price-value price-loading" id="card-price">—</div>
        <div class="price-updated" id="price-updated"></div>
      </div>
      <div class="info-table">
        <div class="info-row"><div class="info-key">Card Name</div><div class="info-val">${fullDisplayName}</div></div>
        <div class="info-row"><div class="info-key">Card Number</div><div class="info-val">${setShortId}</div></div>
        <div class="info-row"><div class="info-key">Set</div><div class="info-val"><a href="${cardListUrl}" style="color:var(--amber)">${SET_FULL_NAME}</a></div></div>
        <div class="info-row"><div class="info-key">Rarity</div><div class="info-val">
          <span class="rarity-badge ${
            rarity === 'Manga Rare' ? 'badge-mr'
            : rarity === 'Secret Rare' ? 'badge-sec'
            : rarity === 'Treasure Rare' ? 'badge-tr'
            : (rarity === 'Special' || rarity === 'Alternate Art') ? 'badge-sp'
            : rarity === 'Super Rare' ? 'badge-sr'
            : rarity === 'Rare' ? 'badge-r'
            : 'badge-default'
          }">${rarityLabel || rarity}</span>
        </div></div>
        ${card.isVariant && card.baseLocalId ? `<div class="info-row"><div class="info-key">Variant Of</div><div class="info-val">${card.baseLocalId}</div></div>` : ''}
      </div>
      <div class="buy-buttons">
        <a class="btn btn-tcgp" href="${tcgpSearchUrl(card)}" target="_blank" rel="noopener">
          <span>🛒 Buy on TCGplayer</span><span>→</span>
        </a>
        <a class="btn btn-ebay" href="${ebaySearchUrl(card)}" target="_blank" rel="noopener">
          <span>🔍 Find on eBay</span><span>→</span>
        </a>
      </div>
      <div class="section-title">About This Card</div>
      <p class="card-description">
        ${fullDisplayName} (${setShortId}) is a${rarity ? ` <strong>${rarity}</strong>` : ''} card from the <strong>${SET_FULL_NAME}</strong> set of the One Piece Card Game.
        ${rarity === 'Manga Rare' ? 'Manga Rares are the top chase cards in this set, featuring manga-style artwork.' : ''}
        ${rarity === 'Secret Rare' ? 'Secret Rares are among the hardest cards to pull from a booster pack.' : ''}
        ${rarity === 'Treasure Rare' ? 'Treasure Rares are rare cross-set reprints included in this English release.' : ''}
        ${rarity === 'Special' ? 'Special cards are cross-set SP reprints included in this English release with unique alternate artwork.' : ''}
        ${rarity === 'Alternate Art' ? 'Alternate Art cards feature unique artwork and are among the most desirable pulls.' : ''}
        ${rarity === 'Super Rare' ? 'Super Rares are high-rarity cards featuring detailed artwork.' : ''}
      </p>
      ${related.length > 0 ? `
      <div class="section-title">Related Cards from ${SET_FULL_NAME}</div>
      <div class="related-grid">
        ${related.map(r => {
          const rDispNum = displayNumber(r.localId);
          const rIsCrossSet = /^[A-Z]{2,}\d+-/.test(r.localId);
          const rImg = `${R2_PUBLIC_URL}/cards/op/${SET_ID}/${r.localId}.webp${rIsCrossSet ? '?v=2' : ''}`;
          const rSlug = cardSlug(r);
          return `<a class="related-card" href="/one-piece/sets/${SET_URL_SLUG}/cards/${rSlug}">
          <img src="${rImg}" alt="${r.name} ${rDispNum} ${SET_SHORT_NAME} One Piece TCG Card" width="200" height="279" loading="lazy" onerror="this.style.display='none'">
          <div class="related-card-info">
            <div class="related-card-name">${r.name}</div>
            <div class="related-card-num">${rDispNum}</div>
            <div class="related-card-price" data-related-id="${r.localId}">—</div>
          </div>
        </a>`;
        }).join('')}
      </div>` : ''}
      <div class="set-block">
        <div class="set-block-title">${SET_FULL_NAME} (${SET_SHORT_NAME})</div>
        <div class="set-links">
          <a class="set-link" href="${cardListUrl}">📋 View Full Card List →</a>
          <a class="set-link" href="/one-piece/sets/${SET_URL_SLUG}/most-valuable">⭐ Most Valuable Cards →</a>
        </div>
      </div>
    </div>
  </div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with or endorsed by Bandai or the One Piece Card Game. All trademarks remain property of their respective owners.</p>
  <p style="margin-top:8px">TCG Watchtower participates in affiliate programs including eBay Partner Network and TCGplayer. We may earn a commission on qualifying purchases.</p>
</footer>
<script>
const GROUP_ID = '${TCGP_GROUP_ID}';
const PRICE_KEY = '${priceKey}';
const CARD_NAME = '${card.name.replace(/'/g, "\\'")}';

async function loadPrice() {
  if (!GROUP_ID) return;
  try {
    const res = await fetch('/api/tcgplayer-prices?groupId=' + GROUP_ID + '&game=onepiece');
    if (!res.ok) return;
    const data = await res.json();
    const prices = data.prices || {};

    // Try exact key first (handles both cross-set full IDs and padded short nums)
    let price = prices[PRICE_KEY];

    // Fallback: try name-based key
    if (price == null) {
      const baseName = CARD_NAME.replace(/[(][^)]*[)]/g,'').replace(/[^a-zA-Z0-9 ]/g,'').trim().toLowerCase().replace(/  +/g,' ');
      price = prices[baseName];
    }

    const priceEl = document.getElementById('card-price');
    if (price != null) {
      priceEl.textContent = '$' + price.toFixed(2);
      priceEl.classList.remove('price-loading');
      document.getElementById('price-updated').textContent = 'Updated today via TCGplayer';
    } else {
      priceEl.textContent = 'N/A';
      priceEl.classList.remove('price-loading');
    }

    // Update related card prices
    document.querySelectorAll('[data-related-id]').forEach(el => {
      const rid = el.dataset.relatedId;
      const isCross = /^[A-Z]{2,}\\d+-/.test(rid);
      const rKey = isCross ? rid : rid.padStart(3, '0');
      const rp = prices[rKey];
      if (rp != null) el.textContent = '$' + rp.toFixed(2);
    });

  } catch(e) {
    document.getElementById('card-price').textContent = 'N/A';
    document.getElementById('card-price').classList.remove('price-loading');
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
const slugsSeen = new Set();
for (const card of cards) {
  const slug = cardSlug(card);
  if (slugsSeen.has(slug)) {
    console.warn(`⚠️  Duplicate slug skipped: ${slug} (${card.localId})`);
    continue;
  }
  slugsSeen.add(slug);
  const filepath = path.join(outDir, `${slug}.html`);
  fs.writeFileSync(filepath, generateCardPage(card, cards));
  generated++;
  if (generated % 50 === 0) console.log(`  Generated ${generated}/${cards.length}...`);
}
console.log(`\n✅ Generated ${generated} card pages`);
console.log(`📁 Output: one-piece/sets/${SET_URL_SLUG}/cards/`);

// ─── vercel.json — wildcard rewrite for card pages ────────────────────────────

updateVercel(vercel => {
  // Remove any existing rewrites for this set's card list URL
  vercel.rewrites = vercel.rewrites.filter(r =>
    r.source !== `/one-piece/sets/${SET_URL_SLUG}/cards` &&
    r.source !== `/one-piece/sets/${SET_URL_SLUG}/top-chase-cards`
  );
});
console.log(`✅ vercel.json updated with One Piece card wildcard rewrite`);

// ─── sitemap.xml ──────────────────────────────────────────────────────────────

const sitemapPath = path.join(ROOT, 'sitemap.xml');
const today = new Date().toISOString().split('T')[0];

const cardEntries = [...slugsSeen].map(slug => `  <url>
    <loc>${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/cards/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

let sitemap = fs.readFileSync(sitemapPath, 'utf8');
// Remove existing entries for this set's card pages
sitemap = sitemap.replace(
  new RegExp(`  <url>\\s*<loc>${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/cards/[^<]+</loc>[\\s\\S]*?</url>\\n`, 'g'),
  ''
);
sitemap = sitemap.replace('</urlset>', `${cardEntries}\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap);
console.log(`✅ sitemap.xml updated with ${slugsSeen.size} One Piece card URLs`);

// ─── Most Valuable / Top Chase Cards page ─────────────────────────────────────

const CHASE_RARITIES_OP = ['Manga Rare', 'Secret Rare', 'Treasure Rare', 'Alternate Art', 'Special', 'Super Rare'];
const RARITY_TIER_OP = { 'Manga Rare': 0, 'Secret Rare': 1, 'Treasure Rare': 2, 'Alternate Art': 3, 'Special': 4, 'Super Rare': 5 };
const RARITY_LABEL_OP = { 'Manga Rare': 'MR', 'Secret Rare': 'SEC', 'Treasure Rare': 'TR', 'Alternate Art': 'ALT', 'Special': 'SP', 'Super Rare': 'SR', 'Rare': 'R' };

const chaseCards = cards
  .filter(c => CHASE_RARITIES_OP.includes(c.rarity || ''))
  .sort((a, b) => (RARITY_TIER_OP[a.rarity] ?? 99) - (RARITY_TIER_OP[b.rarity] ?? 99));

const setDir = path.join(ROOT, 'one-piece', 'sets', SET_URL_SLUG);
fs.mkdirSync(setDir, { recursive: true });

const mvPageUrl   = `${SITE_URL}/one-piece/sets/${SET_URL_SLUG}/most-valuable`;
const mvTitle     = `Most Valuable ${SET_FULL_NAME} Cards | One Piece TCG Prices`;
const mvDesc      = `The most valuable ${SET_FULL_NAME} One Piece TCG cards ranked by market price. See current TCGplayer prices for all Manga Rares, Secret Rares, SP cards, and Alternate Arts.`;

const mvHtml = `<!DOCTYPE html>
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
      { "@type": "ListItem", "position": 4, "name": "Most Valuable Cards", "item": "${mvPageUrl}" }
    ]
  }
}<\/script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y');</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0514;--surface:#0f172a;--surface2:#1e293b;--border:rgba(255,255,255,.08);--text:#f1f5f9;--muted:#94a3b8;--amber:#fbbf24;--green:#22c55e;--red:#ef4444;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;background-image:linear-gradient(to bottom right,#0f0a1a,#1a0a2e,#0a1520)}
a{color:inherit;text-decoration:none}
nav{background:rgba(10,5,20,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;color:var(--text);letter-spacing:.05em}
.nav-back{color:var(--muted);font-size:.85rem;transition:color .2s}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:.75rem 1.5rem;font-size:.8rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:.5}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-family:'Bebas Neue',sans-serif;font-size:2.5rem;letter-spacing:.04em;margin-bottom:.5rem}
.subtitle{color:var(--muted);margin-bottom:2rem;font-size:.95rem}
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
.buy-btns{display:flex;gap:6px}
.btn{flex:1;padding:7px 4px;border-radius:6px;font-size:.75rem;font-weight:700;text-align:center;cursor:pointer;transition:opacity .2s}
.btn:hover{opacity:.85}
.btn-tcgp{background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.3);color:#4ade80}
.btn-ebay{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--amber);margin-top:2.5rem;font-size:.9rem;transition:color .2s}
.back-link:hover{color:white}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--muted);font-size:.8rem;line-height:1.6;margin-top:3rem}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <img src="/tcg-watchtower-logo.jpg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards" class="nav-back">← ${SET_FULL_NAME} Card List</a>
</nav>
<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/one-piece">One Piece TCG</a><span>›</span>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards">${SET_FULL_NAME}</a><span>›</span>
  <span>Most Valuable Cards</span>
</div>
<div class="container">
  <h1>Most Valuable ${SET_FULL_NAME} Cards</h1>
  <p class="subtitle">${chaseCards.length} chase cards ranked by market price — updated daily from TCGplayer</p>
  <div class="cards-grid" id="cards-grid">
    ${chaseCards.map(c => {
      const dispNum = c.localId.includes('_') ? c.localId.split('_')[0] : c.localId;
      const isCrossSet = /^[A-Z]{2,}\d+-/.test(c.localId);
      const img = `${R2_PUBLIC_URL}/cards/op/${SET_ID}/${c.localId}.webp${isCrossSet ? '?v=2' : ''}`;
      const slug = cardSlug(c);
      const baseLocalId = c.localId.includes('_') ? c.localId.split('_')[0] : c.localId;
      const variantSuffix = c.localId.includes('_') ? '_' + c.localId.split('_').slice(1).join('_') : '';
      const priceDataKey = isCrossSet ? (baseLocalId + variantSuffix) : (dispNum.padStart(3, '0') + variantSuffix);
      const tcgpUrl = `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${encodeURIComponent(c.name + ' ' + dispNum + ' One Piece')}&view=grid`;
      const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(c.name + ' ' + dispNum + ' ' + SET_FULL_NAME + ' One Piece Card')}&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339145069&toolid=10001&mkevt=1`;
      const badgeClass = c.rarity === 'Manga Rare' ? 'badge-mr' : c.rarity === 'Secret Rare' ? 'badge-sec' : c.rarity === 'Treasure Rare' ? 'badge-tr' : (c.rarity === 'Special' || c.rarity === 'Alternate Art') ? 'badge-sp' : c.rarity === 'Super Rare' ? 'badge-sr' : 'badge-r';
      const label = RARITY_LABEL_OP[c.rarity] || c.rarity;
      const displayName = c.name.replace(/\s*\(([a-z])/g, (m, l) => ' (' + l.toUpperCase()).replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim();
      return `<div class="card-item">
      <a href="/one-piece/sets/${SET_URL_SLUG}/cards/${slug}">
        <img src="${img}" alt="${c.name} ${dispNum} ${SET_FULL_NAME} One Piece Card" width="200" height="279" loading="lazy" onerror="this.style.background='#1e293b'">
      </a>
      <div class="card-info">
        <div class="card-name">${displayName}</div>
        <div class="card-num">${dispNum}</div>
        <span class="rarity-badge ${badgeClass}">${label}</span>
        <div class="card-price loading" data-price-key="${priceDataKey}">—</div>
        <div class="buy-btns">
          <a class="btn btn-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="btn btn-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay</a>
        </div>
      </div>
    </div>`;
    }).join('')}
  </div>
  <a href="/one-piece/sets/${SET_URL_SLUG}/cards" class="back-link">← View Full ${SET_FULL_NAME} Card List</a>
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
    // Re-sort grid by price descending
    const grid = document.getElementById('cards-grid');
    const items = [...grid.querySelectorAll('.card-item')];
    items.sort((a, b) => {
      const pa = parseFloat(a.querySelector('[data-price-key]').textContent.replace('$', '')) || 0;
      const pb = parseFloat(b.querySelector('[data-price-key]').textContent.replace('$', '')) || 0;
      return pb - pa;
    });
    items.forEach(i => grid.appendChild(i));
  } catch(e) { console.warn('Prices unavailable:', e.message); }
}
loadPrices();
</script>
${impactScript}
</body>
</html>`;

fs.writeFileSync(path.join(setDir, 'most-valuable.html'), mvHtml);
console.log(`✅ Generated most-valuable page: one-piece/sets/${SET_URL_SLUG}/most-valuable.html`);

// Add vercel rewrite for most-valuable
updateVercel(vercel => {
  vercel.rewrites = vercel.rewrites.filter(r =>
    r.source !== `/one-piece/sets/${SET_URL_SLUG}/most-valuable`
  );
  vercel.rewrites.push({
    source:      `/one-piece/sets/${SET_URL_SLUG}/most-valuable`,
    destination: `/one-piece/sets/${SET_URL_SLUG}/most-valuable.html`,
  });
});
console.log(`✅ vercel.json updated with most-valuable rewrite`);

// Add to sitemap
let sitemap4 = fs.readFileSync(sitemapPath, 'utf8');
sitemap4 = sitemap4.replace('</urlset>', `  <url>
    <loc>${mvPageUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap4);
console.log(`✅ sitemap.xml updated with most-valuable URL`);
