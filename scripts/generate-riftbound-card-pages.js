/**
 * generate-riftbound-card-pages.js
 * Generates individual HTML pages for every card in a Riftbound TCG set,
 * plus the top-chase-cards page.
 *
 * Usage:
 *   SET_ID=ogn \
 *   SET_FULL_NAME="Origins" \
 *   SET_URL_SLUG="origins" \
 *   CF_R2_PUBLIC_URL=https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev \
 *   node scripts/generate-riftbound-card-pages.js
 *
 * Key differences from generate-op-card-pages.js:
 * - Prices (normal + foil) are baked into R2 card data — no live API fetch
 * - Domain + cardType shown as info rows and badges
 * - Riftbound rarity badge classes (teal/gold palette)
 * - Output: riftbound/sets/{slug}/cards/{card-slug}.html
 * - No variant complexity — foil is a separate card entry if it exists
 * - Top chase cards ranked by normalPrice descending
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');

const SET_ID         = (process.env.SET_ID || '').trim().toLowerCase();
const SET_FULL_NAME  = (process.env.SET_FULL_NAME || '').trim();
const SET_SHORT_NAME = (process.env.SET_SHORT_NAME || SET_ID.toUpperCase()).trim();

// Load printedTotal from sets-riftbound.json
const setsRbRaw = fs.existsSync('sets-riftbound.json') ? JSON.parse(fs.readFileSync('sets-riftbound.json', 'utf8')) : [];
const setConfig  = setsRbRaw.find(s => s.setId === SET_ID) || {};
const SET_PRINTED_TOTAL = String(setConfig.printedTotal || '');
const R2_PUBLIC_URL  = (process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev').trim();
const SITE_URL       = 'https://tcgwatchtower.com';

const rawUrlSlug   = (process.env.SET_URL_SLUG || '').trim();
const SET_URL_SLUG = rawUrlSlug || SET_FULL_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!SET_ID || !SET_FULL_NAME) {
  console.error('Missing required: SET_ID, SET_FULL_NAME');
  process.exit(1);
}

// Fetch card metadata from R2
const metaUrl = `${R2_PUBLIC_URL}/data/riftbound/${SET_ID}.json`;
console.log(`Fetching card metadata from ${metaUrl}...`);
const metaRes = await fetch(metaUrl);
if (!metaRes.ok) throw new Error(`Failed to fetch metadata: ${metaRes.status}`);
const metadata  = await metaRes.json();
// Only generate pages for base cards (not foil variant entries)
const cards = (metadata.cards || []).filter(c => !c.isVariant);
console.log(`${cards.length} base cards found for ${SET_FULL_NAME}`);
console.log(`URL path: /riftbound/sets/${SET_URL_SLUG}/cards/`);

// Output directory
const outDir = path.join(ROOT, 'riftbound', 'sets', SET_URL_SLUG, 'cards');
fs.mkdirSync(outDir, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(name) {
  return (name || '').toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cardSlug(card) {
  // Preserve Signature distinction: 303* → name-303-signature, 303 → name-303-overnumbered
  const localId = card.localId || '';
  const isSignature = localId.endsWith('*');
  const baseId = localId.replace('*', '');
  const rarity = (card.rarity || '').toLowerCase();
  if (isSignature) return `${toSlug(card.name)}-${baseId}-signature`;
  if (rarity === 'overnumbered' || rarity === 'showcase') return `${toSlug(card.name)}-${baseId}-overnumbered`;
  return `${toSlug(card.name)}-${baseId}`;
}

function cardUrl(card) {
  return `${SITE_URL}/riftbound/sets/${SET_URL_SLUG}/cards/${cardSlug(card)}`;
}

function cardImgUrl(card) {
  return `${R2_PUBLIC_URL}/cards/riftbound/${SET_ID}/${card.localId}.webp`;
}

function fmtPrice(p) {
  return p != null ? '$' + Number(p).toFixed(2) : 'N/A';
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

// Riftbound rarity -> CSS class
const RARITY_CLASS = {
  'Common':       'badge-common',
  'Uncommon':     'badge-uncommon',
  'Rare':         'badge-rare',
  'Epic':         'badge-epic',
  'Legendary':    'badge-legendary',
  'Legend':       'badge-legendary',
  'Showcase':     'badge-showcase',
  'Overnumbered': 'badge-overnumbered',
  'Signature':    'badge-signature',
};

// Domain -> left border color
const DOMAIN_COLORS = {
  'Shadow':    '#7c3aed',
  'Fire':      '#ef4444',
  'Water':     '#3b82f6',
  'Earth':     '#92400e',
  'Wind':      '#22c55e',
  'Celestial': '#f59e0b',
  'Colorless': '#64748b',
};

function domainColor(domain) {
  return DOMAIN_COLORS[domain] || '#2dd4bf';
}

function tcgpSearchUrl(card) {
  const TCGP_AFFILIATE_BASE = 'https://partner.tcgplayer.com/c/7068180/1830156/21018';
  const q   = encodeURIComponent(`${card.name} ${SET_SHORT_NAME}-${card.localId} Riftbound`);
  const url = `https://www.tcgplayer.com/search/riftbound-league-of-legends-trading-card-game/product?q=${q}&view=grid`;
  return `${TCGP_AFFILIATE_BASE}?u=${encodeURIComponent(url)}`;
}

function amazonSearchUrl(card) {
  const q = encodeURIComponent(`${card.name} ${SET_FULL_NAME} Riftbound Card`);
  return `https://www.amazon.com/s?k=${q}&linkCode=ll2&tag=cehutto01-20&language=en_US`;
}

function ebaySearchUrl(card) {
  const q = encodeURIComponent(`${card.name} ${SET_SHORT_NAME}-${card.localId} Riftbound`);
  return `https://www.ebay.com/sch/i.html?_nkw=${q}&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339145069&toolid=10001&mkevt=1`;
}

// ── Shared fragments ──────────────────────────────────────────────────────────

const cardListUrl = `${SITE_URL}/riftbound/sets/${SET_URL_SLUG}/cards`;

const sharedNav = `<nav>
  <a href="/" class="nav-logo">
    <img src="/logo-mark.svg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="${cardListUrl}" class="nav-back">← ${SET_FULL_NAME} Card List</a>
</nav>`;

function breadcrumb(lastLabel) {
  return `<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/sets/riftbound">Riftbound TCG</a><span>›</span>
  <a href="${cardListUrl}">${SET_FULL_NAME}</a><span>›</span>
  <span>${lastLabel}</span>
</div>`;
}

const gaScript = (dims) => `<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y',${JSON.stringify(dims)});</script>
<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a||!a.href)return;var h=a.href;if(h.indexOf('discord.gg')>-1){gtag('event','discord_join_click',{page_path:location.pathname});}else if(h.indexOf('tcgplayer.com')>-1){gtag('event','affiliate_click',{retailer:'tcgplayer',page_path:location.pathname});}else if(h.indexOf('amazon.com')>-1){gtag('event','affiliate_click',{retailer:'amazon',page_path:location.pathname});}else if(h.indexOf('ebay.com')>-1){gtag('event','affiliate_click',{retailer:'ebay',page_path:location.pathname});}},true);</script>`;

const impactScript = `<script type="text/javascript">window.addEventListener('load',function(){(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');});</script>`;

const sharedCss = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#020f0d;--surface:#0f1f1c;--surface2:#1a2e2a;--border:rgba(45,212,191,0.1);--text:#f1f5f9;--muted:#94a3b8;--teal:#2dd4bf;--gold:#f59e0b;--green:#22c55e}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;background-image:linear-gradient(to bottom right,#020f0d,#061a14,#0a1520)}
a{color:inherit;text-decoration:none}
nav{background:rgba(2,15,13,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Saira Condensed',sans-serif;font-weight:700;text-transform:uppercase;font-size:1.2rem;color:var(--text);letter-spacing:.05em}
.nav-back{color:var(--muted);font-size:.85rem;transition:color .2s}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:.75rem 1.5rem;font-size:.8rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:.5}
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
.rarity-badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:.75rem;font-weight:700}
.badge-common{background:rgba(100,116,139,.15);border:1px solid rgba(100,116,139,.3);color:#94a3b8}
.badge-uncommon{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:#4ade80}
.badge-rare{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.badge-epic{background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.3);color:#d8b4fe}
.badge-legendary{background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);color:#fbbf24}
.badge-showcase{background:rgba(45,212,191,.15);border:1px solid rgba(45,212,191,.3);color:#2dd4bf}
.badge-overnumbered{background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.3);color:#fb923c}
.badge-signature{background:linear-gradient(135deg,rgba(163,230,53,.2),rgba(45,212,191,.2),rgba(168,85,247,.2));border:1px solid rgba(163,230,53,.4);color:#a3e635}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--muted);font-size:.8rem;line-height:1.6;margin-top:2rem}
`;

// ── Individual card page template ─────────────────────────────────────────────

function generateCardPage(card, allCards) {
  const url       = cardUrl(card);
  const img       = cardImgUrl(card);
  const related   = getRelated(card, allCards);
  const rarity    = card.rarity || '';
  const rc        = RARITY_CLASS[rarity] || 'badge-common';
  const domain    = card.domain || '';
  const cardType  = card.cardType || '';
  const dColor    = domainColor(domain);

  const setShortId  = `${SET_SHORT_NAME}-${card.localId}`;
  const cardNum     = `${card.localId.replace('*','')}/${SET_PRINTED_TOTAL || '298'}`;
  const isSignature = (card.rarity || '').toLowerCase() === 'signature';
  const isOvernumbered = (card.rarity || '').toLowerCase() === 'overnumbered' || (card.rarity || '').toLowerCase() === 'showcase';
  const rarityLabel = isSignature ? 'Signature' : isOvernumbered ? 'Overnumbered' : rarity;
  const bestPrice   = Math.max(card.normalPrice ?? -1, card.foilPrice ?? -1);
  const priceStr    = bestPrice > 0 ? ` — $${bestPrice.toFixed(2)}` : '';
  const title       = `${card.name} ${cardNum} | ${rarityLabel} | Riftbound ${SET_FULL_NAME} Price & Card Details`;
  const description = `${card.name} (${setShortId}) — ${rarityLabel} card from Riftbound ${SET_FULL_NAME}${domain ? ', ' + domain + ' domain' : ''}${priceStr}. Live market price, card text, and where to buy.`;

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    'name': `${card.name} ${setShortId}`,
    'description': description,
    'url': url,
    'image': img,
    'brand': { '@type': 'Brand', 'name': 'Riftbound: League of Legends TCG' },
    'offers': bestPrice > 0 ? {
      '@type': 'Offer',
      'priceCurrency': 'USD',
      'price': bestPrice.toFixed(2),
      'availability': 'https://schema.org/InStock',
    } : undefined,
  });

  return `<!-- Generated: ${new Date().toISOString()} -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="keywords" content="${card.name}, ${setShortId}, ${SET_FULL_NAME}, Riftbound TCG, ${rarity}${domain ? ', ' + domain : ''}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="TCG Watchtower">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:image" content="${img}">
<meta name='impact-site-verification' value='4069a06f-34a9-45bf-9cbf-563c3b047710'>
<script type="application/ld+json">${schemaJson}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${SITE_URL}"},{"@type":"ListItem","position":2,"name":"Riftbound TCG","item":"${SITE_URL}/sets/riftbound"},{"@type":"ListItem","position":3,"name":"${SET_FULL_NAME}","item":"${cardListUrl}"},{"@type":"ListItem","position":4,"name":"${card.name}","item":"${url}"}]}</script>
${gaScript({ set_id: SET_ID, series: 'Riftbound', page_type: 'card_detail' })}
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap"></noscript>
<style>
${sharedCss}
.card-layout{display:grid;grid-template-columns:340px 1fr;gap:2.5rem;align-items:start;margin-top:1.5rem}
@media(max-width:700px){.card-layout{grid-template-columns:1fr}}
.card-image-wrap{position:sticky;top:80px}
.card-image-wrap img{width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.7);display:block}
.card-name{font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:.04em;margin-bottom:.4rem;line-height:1.1}
.card-meta{color:var(--muted);font-size:.9rem;margin-bottom:1.25rem}
.card-meta a{color:var(--teal)}
/* Domain badge */
.domain-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1rem;border:1px solid;color:white}
/* Foil/normal price boxes */
.price-grid{margin-bottom:1.5rem}
.price-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;text-align:center}
.price-label{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.price-value{font-size:2rem;font-weight:700;font-family:monospace;color:var(--green)}
.price-value.foil{background:linear-gradient(135deg,#a3e635,#2dd4bf,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.price-source{font-size:.65rem;color:var(--muted);margin-top:4px}
.info-table{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
.info-row{display:flex;gap:1rem;padding:.7rem 1rem;border-bottom:1px solid var(--border)}
.info-row:last-child{border-bottom:none}
.info-key{font-size:.82rem;color:var(--muted);min-width:110px;flex-shrink:0}
.info-val{font-size:.9rem;font-weight:500}
.buy-buttons{display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.5rem}
.btn{display:flex;align-items:center;justify-content:space-between;padding:.85rem 1.25rem;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;transition:opacity .2s;text-decoration:none}
.btn:hover{opacity:.85}
.btn-tcgp{background:rgba(45,212,191,.15);border:1px solid rgba(45,212,191,.3);color:var(--teal)}
.btn-amazon{background:#f90;color:#111}
.btn-ebay{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.btn span:last-child{opacity:.7}
.section-title{font-size:.9rem;font-weight:700;margin-bottom:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.card-description{font-size:.95rem;line-height:1.7;color:var(--muted);margin-bottom:2rem}
.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem}
@media(max-width:480px){.related-grid{grid-template-columns:repeat(2,1fr)}}
.related-card{background:rgba(15,31,28,.9);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .2s,transform .2s;border-left-width:3px}
.related-card:hover{border-color:rgba(45,212,191,.4);transform:translateY(-2px)}
.related-card img{width:100%;aspect-ratio:245/337;object-fit:contain;background:rgba(2,15,13,.85)}
.related-card-info{padding:.6rem .75rem}
.related-card-name{font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-card-num{font-size:.75rem;color:var(--muted)}
.related-card-price{font-size:.8rem;color:var(--green);margin-top:2px}
.set-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:2rem}
.set-block-title{font-size:.85rem;color:var(--muted);margin-bottom:.75rem}
.set-links{display:flex;flex-direction:column;gap:.5rem}
.set-link{color:var(--teal);font-size:.9rem;display:flex;align-items:center;gap:6px;transition:color .2s}
.set-link:hover{color:white}
</style>
</head>
<body>
${sharedNav}
${breadcrumb(`${card.name} #${card.localId}`)}
<div class="container">
  <div class="card-layout">
    <div class="card-image-wrap">
      <img src="${img}" alt="${card.name} ${setShortId} ${rarity} ${SET_FULL_NAME} Riftbound TCG Card"
           width="400" height="558" fetchpriority="high"
           onerror="this.style.background='#0f1f1c';this.style.aspectRatio='5/7'">
    </div>
    <div>
      <div class="card-name">${card.name} <span style="font-size:1.2rem;opacity:.6;font-weight:500">(${setShortId})</span></div>
      <div class="card-meta">
        ${card.localId} · <a href="${cardListUrl}">${SET_FULL_NAME}</a> · Riftbound TCG
      </div>
      ${domain ? `<div class="domain-badge" style="background:${dColor}22;border-color:${dColor}55;color:white">${domain}${cardType ? ' · ' + cardType : ''}</div>` : ''}
      <div class="price-grid">
        <div class="price-box${bestPrice > 0 && (card.foilPrice ?? -1) >= (card.normalPrice ?? -1) ? ' foil' : ''}">
          <div class="price-label">Market Price</div>
          <div class="price-value${bestPrice > 0 && (card.foilPrice ?? -1) >= (card.normalPrice ?? -1) ? ' foil' : ''}">${bestPrice > 0 ? '$' + bestPrice.toFixed(2) : 'N/A'}</div>
          <div class="price-source">Updated daily</div>
        </div>
      </div>
      <div class="info-table">
        <div class="info-row"><div class="info-key">Card Name</div><div class="info-val">${card.name}</div></div>
        <div class="info-row"><div class="info-key">Card Number</div><div class="info-val">${setShortId}</div></div>
        <div class="info-row"><div class="info-key">Set</div><div class="info-val"><a href="${cardListUrl}" style="color:var(--teal)">${SET_FULL_NAME}</a></div></div>
        <div class="info-row"><div class="info-key">Rarity</div><div class="info-val"><span class="rarity-badge ${rc}">${rarity}</span></div></div>
        ${domain ? `<div class="info-row"><div class="info-key">Domain</div><div class="info-val">${domain}</div></div>` : ''}
        ${cardType ? `<div class="info-row"><div class="info-key">Type</div><div class="info-val">${cardType}</div></div>` : ''}
        ${card.printedNumber && card.printedNumber !== card.localId ? `<div class="info-row"><div class="info-key">Printed Number</div><div class="info-val">${card.printedNumber}</div></div>` : ''}
      </div>
      <div class="buy-buttons">
        <a class="btn btn-amazon" href="${amazonSearchUrl(card)}" target="_blank" rel="noopener">
          <span>Find on Amazon</span><span>→</span>
        </a>
        <a class="btn btn-tcgp" href="${tcgpSearchUrl(card)}" target="_blank" rel="noopener">
          <span>Buy on TCGplayer</span><span>→</span>
        </a>
        <a class="btn btn-ebay" href="${ebaySearchUrl(card)}" target="_blank" rel="noopener">
          <span>Find on eBay</span><span>→</span>
        </a>
      </div>
      <div class="section-title">About This Card</div>
      <p class="card-description">
        ${card.name} (${setShortId}) is a${rarity ? ` <strong>${rarity}</strong>` : ''} card from <strong>${SET_FULL_NAME}</strong> in the Riftbound: League of Legends TCG${domain ? ', belonging to the <strong>' + domain + '</strong> domain' : ''}.
        ${{
          'Signature': 'Signature cards are the rarest treatment in Riftbound, appearing as foil-only premium alternate art versions. Each Signature card is tied to a specific Overnumbered card and features unique artwork.',
          'Overnumbered': 'Overnumbered cards are chase-tier parallel versions that exceed the base set number. They are among the most desirable pulls in any Riftbound set.',
          'Showcase': 'Showcase cards feature premium alternate artwork and are among the most collectible cards in the set.',
          'Legendary': 'Legendary cards are high-rarity cards representing the most powerful characters and moments in the League of Legends universe.',
          'Epic': 'Epic cards are high-rarity pulls featuring detailed artwork and strong gameplay effects.',
        }[rarity] || ''}
      </p>
      ${related.length > 0 ? `
      <div data-nosnippet>
      <div class="section-title">Related Cards from ${SET_FULL_NAME}</div>
      <div class="related-grid">
        ${related.map(r => {
          const rImg = cardImgUrl(r);
          const rSlug = cardSlug(r);
          const rColor = domainColor(r.domain);
          return `<a class="related-card" href="/riftbound/sets/${SET_URL_SLUG}/cards/${rSlug}" style="border-left-color:${rColor}">
          <img src="${rImg}" alt="${r.name} ${SET_SHORT_NAME}-${r.localId} Riftbound TCG" width="200" height="279" loading="lazy" onerror="this.style.display='none'">
          <div class="related-card-info">
            <div class="related-card-name">${r.name}</div>
            <div class="related-card-num">${SET_SHORT_NAME}-${r.localId}</div>
            <div class="related-card-price">${fmtPrice(Math.max(r.normalPrice??-1,r.foilPrice??-1)===-1?null:Math.max(r.normalPrice??-1,r.foilPrice??-1))}</div>
          </div>
        </a>`;
        }).join('')}
      </div>
      </div>` : ''}
      <div class="set-block">
        <div class="set-block-title">${SET_FULL_NAME} (${SET_SHORT_NAME})</div>
        <div class="set-links">
          <a class="set-link" href="${cardListUrl}">View Full Card List →</a>
          <a class="set-link" href="/riftbound/sets/${SET_URL_SLUG}/top-chase-cards">Top Chase Cards →</a>
        </div>
      </div>
    </div>
  </div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with or endorsed by Riot Games, League of Legends, or Riftbound. All trademarks remain property of their respective owners.</p>
  <p style="margin-top:8px">TCG Watchtower participates in affiliate programs including eBay Partner Network, TCGplayer, and Amazon Associates. We may earn a commission on qualifying purchases.</p>
</footer>
${impactScript}
</body>
</html>`;
}

// ── Generate all card pages ───────────────────────────────────────────────────

let generated = 0;
const slugsSeen = new Set();
for (const card of cards) {
  const slug = cardSlug(card);
  if (slugsSeen.has(slug)) {
    console.warn(`Duplicate slug skipped: ${slug} (${card.localId})`);
    continue;
  }
  slugsSeen.add(slug);
  const filepath = path.join(outDir, `${slug}.html`);
  fs.writeFileSync(filepath, generateCardPage(card, cards));
  generated++;
  if (generated % 50 === 0) console.log(`  Generated ${generated}/${cards.length}...`);
}
console.log(`\n${generated} card pages generated`);
console.log(`Output: riftbound/sets/${SET_URL_SLUG}/cards/`);

// ── Top chase cards page ──────────────────────────────────────────────────────

const CHASE_RARITIES = ['Signature', 'Overnumbered', 'Showcase', 'Legendary', 'Legend', 'Epic'];
const RARITY_TIER    = { 'Signature': 0, 'Overnumbered': 1, 'Showcase': 2, 'Legendary': 3, 'Legend': 3, 'Epic': 4 };

const chaseCards = cards
  .filter(c => CHASE_RARITIES.includes(c.rarity || ''))
  .sort((a, b) => {
    const pa = Math.max(a.normalPrice ?? -1, a.foilPrice ?? -1);
    const pb = Math.max(b.normalPrice ?? -1, b.foilPrice ?? -1);
    if (pa !== pb) return pb - pa;
    return (RARITY_TIER[a.rarity] ?? 99) - (RARITY_TIER[b.rarity] ?? 99);
  });

const setDir    = path.join(ROOT, 'riftbound', 'sets', SET_URL_SLUG);
const mvPageUrl = `${SITE_URL}/riftbound/sets/${SET_URL_SLUG}/top-chase-cards`;
const mvTitle   = `${SET_FULL_NAME} Chase Cards: Most Valuable Cards Ranked by Price | Riftbound TCG`;
const mvDesc    = `Every ${SET_FULL_NAME} chase card ranked by current market price including Signature, Overnumbered, Showcase, Legendary, and Epic cards. Updated daily.`;

const topCard     = chaseCards[0];
const rarityTypes = [...new Set(chaseCards.map(c => c.rarity))].filter(Boolean);
const faqItems = [
  {
    q: `What are the chase cards in ${SET_FULL_NAME}?`,
    a: `The chase cards in ${SET_FULL_NAME} are its highest-rarity pulls: ${rarityTypes.join(', ') || 'high-rarity cards'}. These are the cards collectors specifically hope to pull from a booster box.`,
  },
  ...(topCard ? [{
    q: `What is the most valuable ${SET_FULL_NAME} card?`,
    a: `${topCard.name} is currently the most valuable card in ${SET_FULL_NAME} as a ${topCard.rarity} card, priced at ${fmtPrice(Math.max(topCard.normalPrice??-1,topCard.foilPrice??-1)===-1?null:Math.max(topCard.normalPrice??-1,topCard.foilPrice??-1))}. See all chase cards ranked by price below.`,
    id: 'faq-top-answer',
  }] : []),
  {
    q: `How many chase cards are in ${SET_FULL_NAME}?`,
    a: `${chaseCards.length} out of ${cards.length} total cards in ${SET_FULL_NAME} qualify as chase-tier rarities (Signature, Overnumbered, Showcase, Legendary, or Epic).`,
  },
  {
    q: `What is the difference between Normal and Foil in Riftbound?`,
    a: `In Riftbound TCG, most cards come in both a Normal (non-foil) version and a Foil version. Foil cards have a premium finish and are worth more than their normal counterparts. Signature cards are foil-only and represent the rarest treatment in the game.`,
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  'mainEntity': faqItems.map(f => ({
    '@type': 'Question',
    'name': f.q,
    'acceptedAnswer': { '@type': 'Answer', 'text': f.a },
  })),
};

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
${topCard ? `<meta property="og:image" content="${R2_PUBLIC_URL}/cards/riftbound/${SET_ID}/${topCard.localId}.webp">
<meta name="twitter:image" content="${R2_PUBLIC_URL}/cards/riftbound/${SET_ID}/${topCard.localId}.webp">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', 'name': mvTitle, 'description': mvDesc, 'url': mvPageUrl, 'breadcrumb': { '@type': 'BreadcrumbList', 'itemListElement': [{ '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE_URL }, { '@type': 'ListItem', 'position': 2, 'name': 'Riftbound TCG', 'item': SITE_URL + '/sets/riftbound' }, { '@type': 'ListItem', 'position': 3, 'name': SET_FULL_NAME, 'item': cardListUrl }, { '@type': 'ListItem', 'position': 4, 'name': 'Chase Cards', 'item': mvPageUrl }] } })}</script>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
${gaScript({ set_id: SET_ID, series: 'Riftbound', page_type: 'chase_cards' })}
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Saira+Condensed:wght@600;700&display=swap"></noscript>
<style>
${sharedCss}
h1{font-family:'Bebas Neue',sans-serif;font-size:2.5rem;letter-spacing:.04em;margin-bottom:.5rem}
.subtitle{color:var(--muted);margin-bottom:2rem;font-size:.95rem}
.intro-text{color:var(--muted);font-size:.9rem;line-height:1.7;margin-bottom:2rem;max-width:800px}
.set-link-top{display:inline-block;margin-bottom:1.5rem;color:var(--teal);font-size:.9rem;font-weight:600}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1.5rem}
@media(max-width:640px){.cards-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem}}
.card-item{background:rgba(15,31,28,.9);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s,transform .2s;border-left-width:3px}
.card-item:hover{border-color:rgba(45,212,191,.4);transform:translateY(-2px)}
.card-item img{width:100%;aspect-ratio:245/337;object-fit:contain;background:rgba(2,15,13,.85);display:block}
.card-info{padding:.75rem}
.card-name{font-weight:700;font-size:.85rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-num{font-size:.75rem;color:var(--muted);margin-bottom:6px;font-family:monospace}
.card-price-single{font-size:1rem;font-weight:700;color:var(--green);font-family:monospace;margin-bottom:8px;text-align:center}
.buy-links{display:flex;gap:3px;justify-content:center}
.buy-link{flex:1;padding:3px;border-radius:6px;font-size:.6rem;font-weight:700;white-space:nowrap;overflow:hidden;text-decoration:none;transition:all .2s;display:inline-flex;align-items:center;justify-content:center}
.buy-amazon{background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.3);color:#fbbf24}
.buy-ebay{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:#93c5fd}
.buy-tcgp{background:rgba(45,212,191,.15);border:1px solid rgba(45,212,191,.3);color:var(--teal)}
.faq-section{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border)}
.faq-heading{font-size:1.4rem;font-weight:700;margin-bottom:1.25rem}
.faq-item{margin-bottom:1.25rem}
.faq-q{font-size:1rem;font-weight:700;margin-bottom:.4rem;color:var(--text)}
.faq-a{color:var(--muted);font-size:.9rem;line-height:1.6}
.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--teal);margin-top:2.5rem;font-size:.9rem;transition:color .2s}
.back-link:hover{color:white}
</style>
</head>
<body>
${sharedNav}
${breadcrumb('Chase Cards')}
<div class="container">
  <h1>${SET_FULL_NAME} Chase Cards</h1>
  <p class="subtitle">${chaseCards.length} chase cards ranked by market price, updated daily</p>
  <p class="intro-text">Every ${SET_FULL_NAME} chase card ranked by current TCGplayer market price, including ${rarityTypes.join(', ') || 'high-rarity cards'}. Both Normal and Foil prices are shown where available. Prices update daily.</p>
  <a href="${cardListUrl}" class="set-link-top">View the complete ${SET_FULL_NAME} card list →</a>
  <div class="cards-grid">
    ${chaseCards.map(c => {
      const img   = cardImgUrl(c);
      const slug  = cardSlug(c);
      const rc    = RARITY_CLASS[c.rarity] || 'badge-common';
      const dclr  = domainColor(c.domain);
      const aUrl  = amazonSearchUrl(c);
      const eUrl  = ebaySearchUrl(c);
      const tUrl  = tcgpSearchUrl(c);
      return `<div class="card-item" style="border-left-color:${dclr}">
      <a href="/riftbound/sets/${SET_URL_SLUG}/cards/${slug}">
        <img src="${img}" alt="${c.name} ${SET_SHORT_NAME}-${c.localId} Riftbound Chase Card" width="200" height="279" loading="lazy" onerror="this.style.background='#0f1f1c'">
      </a>
      <div class="card-info">
        <div class="card-name">${c.name}</div>
        <div class="card-num">${SET_SHORT_NAME}-${c.localId}</div>
        <span class="rarity-badge ${rc}" style="margin-bottom:8px;display:inline-flex">${c.rarity}</span>
        <div class="card-price-single">${fmtPrice(Math.max(c.normalPrice??-1,c.foilPrice??-1)===-1?null:Math.max(c.normalPrice??-1,c.foilPrice??-1))}</div>
        <div class="buy-links">
          <a class="buy-link buy-amazon" href="${aUrl}" target="_blank" rel="noopener">Amazon</a>
          <a class="buy-link buy-tcgp" href="${tUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="buy-link buy-ebay" href="${eUrl}" target="_blank" rel="noopener">eBay</a>
        </div>
      </div>
    </div>`;
    }).join('')}
  </div>
  <a href="${cardListUrl}" class="back-link">← View Full ${SET_FULL_NAME} Card List</a>
  <div class="faq-section">
    <h2 class="faq-heading">Frequently Asked Questions</h2>
    ${faqItems.map(f => `<div class="faq-item">
      <h3 class="faq-q">${f.q}</h3>
      <p class="faq-a"${f.id ? ` id="${f.id}"` : ''}>${f.a}</p>
    </div>`).join('')}
  </div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with or endorsed by Riot Games, League of Legends, or Riftbound. All trademarks remain property of their respective owners.</p>
  <p style="margin-top:6px">TCG Watchtower participates in affiliate programs including eBay Partner Network, TCGplayer, and Amazon Associates. We may earn a commission on qualifying purchases.</p>
</footer>
${impactScript}
</body>
</html>`;

fs.mkdirSync(setDir, { recursive: true });
fs.writeFileSync(path.join(setDir, 'top-chase-cards.html'), mvHtml);
console.log(`Top chase cards page generated: riftbound/sets/${SET_URL_SLUG}/top-chase-cards.html`);

// ── sitemap.xml ───────────────────────────────────────────────────────────────

const sitemapPath = path.join(ROOT, 'sitemap.xml');
const today = new Date().toISOString().split('T')[0];

const cardEntries = [...slugsSeen].map(slug => `  <url>
    <loc>${SITE_URL}/riftbound/sets/${SET_URL_SLUG}/cards/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`).join('\n');

const chaseEntry = `  <url>
    <loc>${mvPageUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;

let sitemap = fs.readFileSync(sitemapPath, 'utf8');
// Remove existing entries for this set
sitemap = sitemap.replace(
  new RegExp(`  <url>\\s*<loc>${SITE_URL}/riftbound/sets/${SET_URL_SLUG}/cards/[^<]+</loc>[\\s\\S]*?</url>\\n?`, 'g'),
  ''
);
sitemap = sitemap.replace(
  new RegExp(`  <url>\\s*<loc>${mvPageUrl}</loc>[\\s\\S]*?</url>\\n?`, 'g'),
  ''
);
sitemap = sitemap.replace('</urlset>', `${cardEntries}\n${chaseEntry}\n</urlset>`);
fs.writeFileSync(sitemapPath, sitemap);
console.log(`sitemap.xml updated with ${slugsSeen.size} card URLs + top-chase-cards`);
