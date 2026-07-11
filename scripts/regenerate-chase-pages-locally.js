// scripts/regenerate-chase-pages-locally.js
//
// Regenerates top-chase-cards.html and most-valuable.html for every set
// that already has them, picking up the buildChasePage() template changes
// (og:image, intro paragraph) from generate-card-pages.js WITHOUT needing
// R2 or Scrydex network access — the data for every card (name, localId,
// rarity, image URL) is scraped straight from that set's own already-
// generated individual card pages, which are already committed to the repo.
//
// This only touches top-chase-cards.html and most-valuable.html. It does
// NOT regenerate individual card pages themselves (unnecessary — their
// content isn't changing).
//
// Usage: node scripts/regenerate-chase-pages-locally.js
// Optional: LIMIT_TO=chaos-rising,pitch-black node scripts/regenerate-chase-pages-locally.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://tcgwatchtower.com';
const SKIP_FILES = new Set(['fates-card-listtemporal-forces-card-list.html']);

const LIMIT_TO = (process.env.LIMIT_TO || '').trim()
  ? new Set(process.env.LIMIT_TO.split(',').map(s => s.trim()))
  : null;

// ── Shared constants/helpers (mirrors generate-card-pages.js) ─────────────
const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Ultra Rare', 'Illustration Rare'];
const RARITY_TIER    = { 'Mega Hyper Rare': 0, 'Hyper Rare': 1, 'Special Illustration Rare': 2, 'Ultra Rare': 3, 'Illustration Rare': 4 };
const RARITY_LABEL   = { 'Mega Hyper Rare': 'MHR', 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };
function normalizeRarity(r) {
  return (r || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}
function toSlug(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const TCGP_SLUG_MAP = {
  'sv01':'sv01-scarlet-and-violet-base-set','sv02':'sv02-paldea-evolved','sv03':'sv03-obsidian-flames',
  'sv3pt5':'sv3pt5-151','sv04':'sv04-paradox-rift','sv4pt5':'sv4pt5-paldean-fates','sv05':'sv05-temporal-forces',
  'sv06':'sv06-twilight-masquerade','sv6pt5':'sv6pt5-shrouded-fable','sv07':'sv07-stellar-crown',
  'sv08':'sv08-surging-sparks','sv8pt5':'sv8pt5-prismatic-evolutions','sv09':'sv09-journey-together',
  'sv10':'sv10-destined-rivals','me01':'me01-mega-evolution','me02':'me02-phantasmal-flames',
  'me02.5':'me-ascended-heroes','me02pt5':'me-ascended-heroes','me03':'me03-perfect-order',
  'me04':'me04-chaos-rising','me05':'me05-pitch-black','zsv10pt5':'sv-black-bolt','rsv10pt5':'sv-white-flare',
};

// ── Extract set-level info from the card-list.html file ───────────────────
function extractSetInfo(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const canonicalMatch = src.match(/rel="canonical" href="https:\/\/tcgwatchtower\.com\/([^"]+)"/);
  if (!canonicalMatch) return null;
  const parts = canonicalMatch[1].split('/').filter(Boolean);
  let seriesSlug, setSlug;
  if (parts[0] === 'pokemon' && parts[1] === 'sets' && parts.length >= 4) {
    seriesSlug = parts[2]; setSlug = parts[3];
  } else {
    return null; // chase pages are Pokemon-only for now (One Piece doesn't have them yet)
  }
  const basePath = `pokemon/sets/${seriesSlug}/${setSlug}`;
  const cardsSegment = parts[parts.length - 1];

  const titleMatch = src.match(/<title>([^<]+)/);
  const setFullName = titleMatch
    ? titleMatch[1].split(' Card List')[0].replace(/\s*\([^)]*\)\s*$/, '').trim()
    : setSlug;

  const idMatch = src.match(/const SET_ID\s*=\s*'([^']*)'/);
  const setId = idMatch ? idMatch[1] : setSlug;

  const phaseMatch = src.match(/const SET_PHASE\s*=\s*'([^']*)'/);
  const phase = phaseMatch ? phaseMatch[1] : 'en';

  const groupIdMatch = src.match(/const TCGP_GROUP_ID\s*=\s*'([^']*)'/);
  const tcgpGroupId = groupIdMatch ? groupIdMatch[1] : '';

  return { seriesSlug, setSlug, basePath, cardsSegment, setFullName, setId, phase, tcgpGroupId, cardListFile: file };
}

// ── Scrape every individual card page in a set's cards/ directory ─────────
function scrapeCards(basePath) {
  const cardsDir = path.join(ROOT, basePath, 'cards');
  if (!fs.existsSync(cardsDir)) return [];
  const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.html'));
  const cards = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(cardsDir, f), 'utf8');
    const nameMatch = src.match(/<div class="card-name">([^<]*)<\/div>/);
    const numMatch = src.match(/Card Number<\/div><div class="info-val">([^<\/]+?)\s*\/\s*[^<]*<\/div>/);
    const rarityMatch = src.match(/Rarity<\/div><div class="info-val"><span class="rarity-badge">([^<]*)<\/span><\/div>/);
    const imgMatch = src.match(/<div class="card-image-wrap">\s*<img src="([^"]+)"/);
    if (!nameMatch || !numMatch) continue;
    cards.push({
      name: nameMatch[1],
      localId: numMatch[1].trim(),
      rarity: rarityMatch ? rarityMatch[1] : '',
      image: imgMatch ? imgMatch[1] : null,
    });
  }
  return cards;
}

function cardImgUrl(card, setId) {
  if (card.image) return card.image; // scraped image is always the real, already-correct one
  return `https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev/cards/${setId}/${card.localId}.webp`;
}

// ── Templates (kept in sync with generate-card-pages.js's buildChasePage) ─
const sharedFonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<link rel="icon" type="image/x-icon" href="/favicon.ico">`;
const gaScript = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E0S4363S5Y');</script>
<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a||!a.href)return;var h=a.href;if(h.indexOf('discord.gg')>-1){gtag('event','discord_join_click',{page_path:location.pathname});}else if(h.indexOf('tcgplayer.com')>-1){gtag('event','affiliate_click',{retailer:'tcgplayer',page_path:location.pathname});}else if(h.indexOf('amazon.com')>-1){gtag('event','affiliate_click',{retailer:'amazon',page_path:location.pathname});}else if(h.indexOf('ebay.com')>-1){gtag('event','affiliate_click',{retailer:'ebay',page_path:location.pathname});}},true);</script>`;
const impactScript = `<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');<\/script>`;
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
.intro-text{color:var(--text-muted);font-size:0.9rem;line-height:1.7;margin-bottom:2rem;max-width:800px}
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
.buy-links{display:flex;gap:3px;justify-content:center}
.buy-link{flex:1;padding:3px 3px;border-radius:6px;font-size:0.6rem;font-weight:700;white-space:nowrap;overflow:hidden;text-decoration:none;transition:all 0.2s;display:inline-flex;align-items:center;justify-content:center;gap:4px;text-align:center}
.buy-amazon{background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24}
.buy-amazon:hover{background:rgba(251,191,36,0.25)}
.buy-ebay{background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#93c5fd}
.buy-ebay:hover{background:rgba(59,130,246,0.25)}
.buy-tcgp{background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.3);color:#4ade80;font-size:0.5rem}
.buy-tcgp:hover{background:rgba(74,222,128,0.25)}
.btn:hover{opacity:0.85}
.set-link{display:inline-flex;align-items:center;gap:6px;color:var(--accent);margin-top:2rem;font-size:0.9rem}
.set-link-top{display:inline-block;margin-bottom:1.5rem;color:var(--accent);font-size:0.9rem;font-weight:600}
.set-link-top:hover{text-decoration:underline}
.faq-section{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--border)}
.faq-heading{font-size:1.4rem;font-weight:700;margin-bottom:1.25rem}
.faq-item{margin-bottom:1.25rem}
.faq-q{font-size:1rem;font-weight:700;margin-bottom:0.4rem;color:var(--text)}
.faq-a{color:var(--text-muted);font-size:0.9rem;line-height:1.6}
.set-link:hover{text-decoration:underline}
footer{border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;color:var(--text-muted);font-size:0.8rem;margin-top:3rem}`;

function enChaseScript(tcgpGroupId) {
  return `const TCGP_GROUP_ID = '${tcgpGroupId}';
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
}
function jpChaseScript(setId) {
  return `const SET_ID_JS = '${setId}';
async function loadPrices() {
  try {
    const res = await fetch('/api/scrydex-cards?set=' + SET_ID_JS + '&phase=jp');
    if (!res.ok) return;
    const data = await res.json();
    const priceMap = {};
    (data.cards || []).forEach(c => {
      if (c.market == null || !c.localId) return;
      priceMap[String(c.localId).padStart(3,'0')] = c.market;
      priceMap[String(parseInt(c.localId,10))] = c.market;
    });
    document.querySelectorAll('[data-local-id]').forEach(el => {
      const id = el.dataset.localId;
      const price = priceMap[id.padStart(3,'0')] ?? priceMap[String(parseInt(id,10))];
      if (price != null) {
        el.textContent = '~$' + price.toFixed(2);
        el.title = 'Estimated from Japanese market price, converted to USD';
        el.classList.remove('loading');
      } else {
        el.textContent = 'N/A';
        el.classList.remove('loading');
      }
    });
    const grid = document.getElementById('cards-grid');
    const items = [...grid.querySelectorAll('.card-item')];
    items.sort((a, b) => {
      const pa = parseFloat(a.querySelector('[data-local-id]').textContent.replace('~','').replace('$','')) || 0;
      const pb = parseFloat(b.querySelector('[data-local-id]').textContent.replace('~','').replace('$','')) || 0;
      return pb - pa;
    });
    items.forEach(i => grid.appendChild(i));
  } catch(e) {}
}
loadPrices();`;
}

function chaseCardGridItems(cardList, info) {
  return cardList.map(c => {
    const rarity      = normalizeRarity(c.rarity);
    const rarityClass = (RARITY_TIER[rarity] === 0 || RARITY_TIER[rarity] === 1) ? 'rarity-hr'
                      : RARITY_TIER[rarity] === 2 ? 'rarity-sir'
                      : RARITY_TIER[rarity] === 3 ? 'rarity-ur'
                      : 'rarity-ir';
    const label    = RARITY_LABEL[rarity] || rarity;
    const img      = cardImgUrl(c, info.setId);
    const slug     = toSlug(c.name) + '-' + c.localId;
    const tcgpSlug = TCGP_SLUG_MAP[info.setId] || 'sv01-scarlet-and-violet-base-set';
    const tcgpUrl  = `https://www.tcgplayer.com/search/pokemon/${tcgpSlug}?productLineName=pokemon&q=${encodeURIComponent(c.name + ' ' + c.localId)}&view=grid&Language=English&productTypeName=Cards&sharedid=&irpid=7068180&afsrc=1&setName=${tcgpSlug}`;
    const ebayUrl  = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(c.name + ' ' + c.localId + ' ' + info.setFullName + ' Pokemon Card')}`;
    return `
    <div class="card-item">
      <a href="${SITE_URL}/${info.basePath}/cards/${slug}">
        <img src="${img}" alt="${c.name} ${c.localId} ${info.setFullName} Pokemon Card" width="180" height="251" loading="lazy" onerror="this.style.background='#1e293b'">
      </a>
      <div class="card-info">
        <div class="card-name">${c.name}</div>
        <div class="card-num">#${c.localId}</div>
        <span class="card-rarity ${rarityClass}">${label}</span>
        <div class="card-price loading" data-local-id="${c.localId}">Loading...</div>
        <div class="buy-links">
          <a class="buy-link buy-amazon" href="https://www.amazon.com/s?k=${encodeURIComponent(c.name + ' ' + info.setFullName + ' Pokemon Card')}&linkCode=ll2&tag=cehutto01-20&language=en_US" target="_blank" rel="noopener">Amazon</a>
          <a class="buy-link buy-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="buy-link buy-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

function buildChasePage({ info, chaseCards, totalCount, pageUrl, pageTitle, pageDesc, h1, breadcrumbLabel, schemaType, cardListUrl, seriesUrl }) {
  const ogImage = chaseCards[0] ? cardImgUrl(chaseCards[0], info.setId) : '';
  const rarityList = [...new Set(chaseCards.map(c => normalizeRarity(c.rarity)))].filter(Boolean).join(', ');
  const introText = `This page ranks every ${info.setFullName} chase card by current market price, including ${rarityList || 'every high-rarity card in the set'}. Chase cards are the highest-rarity cards in a set — the ones collectors specifically hope to pull from a booster box, and the main driver of a box's resale value. Prices update automatically throughout the day.`;
  const script = info.phase === 'jp' ? jpChaseScript(info.setId) : enChaseScript(info.tcgpGroupId);

  const topCard = chaseCards[0];
  const topCardRarity = topCard ? normalizeRarity(topCard.rarity) : '';
  const faqItems = [
    {
      q: `What are the chase cards in ${info.setFullName}?`,
      a: `The chase cards in ${info.setFullName} are its highest-rarity pulls — ${rarityList || 'its highest-rarity cards'}. These are the cards collectors specifically hope to pull from a booster box, and the main driver of a box's resale value.`,
    },
    ...(topCard ? [{
      q: `What is the most valuable ${info.setFullName} card?`,
      a: `${topCard.name} is typically the most valuable ${info.setFullName} pull, as a ${topCardRarity} card. See live pricing for it and every other chase card ranked below.`,
    }] : []),
    {
      q: `How many chase cards are in ${info.setFullName}?`,
      a: `${chaseCards.length} out of ${totalCount} total cards in ${info.setFullName} qualify as chase-tier rarities.`,
    },
  ];
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqItems.map(item => ({
      "@type": "Question",
      "name": item.q,
      "acceptedAnswer": { "@type": "Answer", "text": item.a },
    })),
  };
  const faqHtml = faqItems.map(item => `
    <div class="faq-item">
      <h3 class="faq-q">${item.q}</h3>
      <p class="faq-a">${item.a}</p>
    </div>`).join('');

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
${ogImage ? `<meta property="og:image" content="${ogImage}">
<meta name="twitter:image" content="${ogImage}">` : ''}
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
      { "@type": "ListItem", "position": 3, "name": "${info.seriesSlug}", "item": "${seriesUrl}" },
      { "@type": "ListItem", "position": 4, "name": "${info.setFullName}", "item": "${cardListUrl}" },
      { "@type": "ListItem", "position": 5, "name": "${breadcrumbLabel}", "item": "${pageUrl}" }
    ]
  }
}
<\/script>
<script type="application/ld+json">
${JSON.stringify(faqSchema, null, 2)}
<\/script>
${sharedFonts}
${gaScript}
<style>${chaseStyles}<\/style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <img src="/tcg-watchtower-logo.jpg" alt="TCG Watchtower" width="32" height="32">
    <span>TCG Watchtower</span>
  </a>
  <a href="${cardListUrl}" class="nav-back">← ${info.setFullName} Card List</a>
</nav>
<div style="padding:3px 16px;text-align:center;font-size:.65rem;color:rgba(148,163,184,.4);letter-spacing:.02em;border-bottom:1px solid rgba(255,255,255,.04);">This site contains affiliate links for which we may be compensated.</div>
<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/pokemon">Pokémon TCG</a><span>›</span>
  <a href="${cardListUrl}">${info.setFullName}</a><span>›</span>
  <span>${breadcrumbLabel}</span>
</div>
<div class="container">
  <h1>${h1}</h1>
  <p class="subtitle">${chaseCards.length} chase cards ranked by market price — the most valuable pulls in ${info.setFullName}, updated daily</p>
  <p class="intro-text">${introText}</p>
  <a href="${cardListUrl}" class="set-link-top">View the complete ${info.setFullName} card list and prices →</a>
  <div class="cards-grid" id="cards-grid">
    ${chaseCardGridItems(chaseCards, info)}
  </div>
  <a href="${cardListUrl}" class="set-link">← View Full ${info.setFullName} Card List</a>
  <div class="faq-section">
    <h2 class="faq-heading">Frequently Asked Questions</h2>
    ${faqHtml}
  </div>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. Prices on TCG Watchtower.</p>
</footer>
<script>${script}<\/script>
${impactScript}
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('-card-list.html') && !SKIP_FILES.has(f));
let regenerated = 0, skipped = 0;

for (const file of files) {
  const info = extractSetInfo(file);
  if (!info) { console.warn(`⚠️  ${file}: could not extract set info — skipped`); skipped++; continue; }
  if (LIMIT_TO && !LIMIT_TO.has(info.setSlug) && !LIMIT_TO.has(file)) continue;

  const tcPath  = path.join(ROOT, info.basePath, 'top-chase-cards.html');
  const mvPath  = path.join(ROOT, info.basePath, 'most-valuable.html');
  if (!fs.existsSync(tcPath)) { skipped++; continue; } // only touch sets that already have this page

  const cards = scrapeCards(info.basePath);
  if (cards.length === 0) { console.warn(`⚠️  ${file}: no cards scraped from ${info.basePath}/cards — skipped`); skipped++; continue; }

  const chaseCards = cards
    .filter(c => CHASE_RARITIES.includes(normalizeRarity(c.rarity)))
    .sort((a, b) => (RARITY_TIER[normalizeRarity(a.rarity)] ?? 99) - (RARITY_TIER[normalizeRarity(b.rarity)] ?? 99));

  const cardListUrl = `${SITE_URL}/${info.basePath}/${info.cardsSegment}`;
  const seriesUrl    = `${SITE_URL}/pokemon/sets/${info.seriesSlug}`;

  const chaseUrl   = `${SITE_URL}/${info.basePath}/top-chase-cards`;
  const chaseTitle = `${info.setFullName} Chase Cards: Most Valuable Cards Ranked by Price | Pokémon TCG`;
  const chaseDesc  = `See every ${info.setFullName} chase card ranked by current market price — the most valuable Hyper Rares, Special Illustration Rares, and Ultra Rares in the set. Updated daily, with pull-rate context and where to buy.`;
  fs.writeFileSync(tcPath, buildChasePage({
    info, chaseCards, totalCount: cards.length, pageUrl: chaseUrl, pageTitle: chaseTitle, pageDesc: chaseDesc,
    h1: `${info.setFullName} Chase Cards`, breadcrumbLabel: 'Chase Cards',
    schemaType: 'CollectionPage', cardListUrl, seriesUrl,
  }));

  if (fs.existsSync(mvPath)) {
    fs.unlinkSync(mvPath);
  }

  console.log(`✅ ${info.basePath}: regenerated top-chase-cards.html, removed most-valuable.html (${chaseCards.length} chase cards from ${cards.length} scraped)`);
  regenerated++;
}

console.log(`\n${regenerated} sets regenerated, ${skipped} skipped.`);
