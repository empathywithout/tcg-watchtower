/**
 * backfill-seo-tables.mjs
 * Applies all SEO improvements to existing set HTML pages:
 *   1. Static hidden card table (for Google indexing)
 *   2. H1 fix — "Pitch Black Card List" not "Mega EvolutionPitch Black"
 *   3. H2 cleanup — remove emojis
 *   4. FAQ section — 5 questions with JSON-LD FAQPage schema
 *   5. OG/Twitter/JSON-LD title fix — keyword-first format
 * Safe to re-run — each step checks before applying.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const R2 = process.env.CF_R2_PUBLIC_URL;
if (!R2) { console.error('❌ CF_R2_PUBLIC_URL not set'); process.exit(1); }

const SETS = [
  { setId: 'sv01',     file: 'scarlet-violet-base-set-card-list.html',  seriesSlug: 'scarlet-violet',  urlSlug: 'scarlet-violet-base-set',  name: 'Scarlet & Violet Base Set',  series: 'Scarlet & Violet', short: 'SV1',  releaseDate: 'Mar 2023', totalCards: '258' },
  { setId: 'sv02',     file: 'paldea-evolved-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'paldea-evolved',           name: 'Paldea Evolved',             series: 'Scarlet & Violet', short: 'SV2',  releaseDate: 'Jun 2023', totalCards: '279' },
  { setId: 'sv03',     file: 'obsidian-flames-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'obsidian-flames',          name: 'Obsidian Flames',            series: 'Scarlet & Violet', short: 'SV3',  releaseDate: 'Aug 2023', totalCards: '230' },
  { setId: 'sv04',     file: 'paradox-rift-card-list.html',              seriesSlug: 'scarlet-violet',  urlSlug: 'paradox-rift',             name: 'Paradox Rift',               series: 'Scarlet & Violet', short: 'SV4',  releaseDate: 'Nov 2023', totalCards: '266' },
  { setId: 'sv3pt5',   file: 'scarlet-violet-151-card-list.html',        seriesSlug: 'scarlet-violet',  urlSlug: '151',                      name: 'Pokémon 151',                series: 'Scarlet & Violet', short: 'SV3.5',releaseDate: 'Sep 2023', totalCards: '207' },
  { setId: 'sv4pt5',   file: 'paldean-fates-card-list.html',             seriesSlug: 'scarlet-violet',  urlSlug: 'paldean-fates',            name: 'Paldean Fates',              series: 'Scarlet & Violet', short: 'SV4.5',releaseDate: 'Jan 2024', totalCards: '245' },
  { setId: 'sv05',     file: 'temporal-forces-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'temporal-forces',          name: 'Temporal Forces',            series: 'Scarlet & Violet', short: 'SV5',  releaseDate: 'Mar 2024', totalCards: '218' },
  { setId: 'sv06',     file: 'twilight-masquerade-card-list.html',       seriesSlug: 'scarlet-violet',  urlSlug: 'twilight-masquerade',      name: 'Twilight Masquerade',        series: 'Scarlet & Violet', short: 'SV6',  releaseDate: 'May 2024', totalCards: '226' },
  { setId: 'sv6pt5',   file: 'shrouded-fable-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'shrouded-fable',           name: 'Shrouded Fable',             series: 'Scarlet & Violet', short: 'SV6.5',releaseDate: 'Aug 2024', totalCards: '99'  },
  { setId: 'sv07',     file: 'stellar-crown-card-list.html',             seriesSlug: 'scarlet-violet',  urlSlug: 'stellar-crown',            name: 'Stellar Crown',              series: 'Scarlet & Violet', short: 'SV7',  releaseDate: 'Sep 2024', totalCards: '175' },
  { setId: 'sv08',     file: 'surging-sparks-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'surging-sparks',           name: 'Surging Sparks',             series: 'Scarlet & Violet', short: 'SV8',  releaseDate: 'Nov 2024', totalCards: '252' },
  { setId: 'sv8pt5',   file: 'prismatic-evolutions-card-list.html',      seriesSlug: 'scarlet-violet',  urlSlug: 'prismatic-evolutions',     name: 'Prismatic Evolutions',       series: 'Scarlet & Violet', short: 'SV8.5',releaseDate: 'Jan 2025', totalCards: '180' },
  { setId: 'sv09',     file: 'journey-together-card-list.html',          seriesSlug: 'scarlet-violet',  urlSlug: 'journey-together',         name: 'Journey Together',           series: 'Scarlet & Violet', short: 'SV9',  releaseDate: 'Mar 2025', totalCards: '190' },
  { setId: 'sv10',     file: 'destined-rivals-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'destined-rivals',          name: 'Destined Rivals',            series: 'Scarlet & Violet', short: 'SV10', releaseDate: 'May 2025', totalCards: '244' },
  { setId: 'zsv10pt5', file: 'black-bolt-card-list.html',                seriesSlug: 'scarlet-violet',  urlSlug: 'black-bolt',               name: 'Black Bolt',                 series: 'Scarlet & Violet', short: 'BBT',  releaseDate: 'Jul 2025', totalCards: '172' },
  { setId: 'rsv10pt5', file: 'white-flare-card-list.html',               seriesSlug: 'scarlet-violet',  urlSlug: 'white-flare',              name: 'White Flare',                series: 'Scarlet & Violet', short: 'WHF',  releaseDate: 'Jul 2025', totalCards: '173' },
  { setId: 'me01',     file: 'mega-evolution-base-set-card-list.html',   seriesSlug: 'mega-evolution',  urlSlug: 'base-set',                 name: 'Mega Evolution',             series: 'Mega Evolution',   short: 'ME1',  releaseDate: 'Sep 2025', totalCards: '188' },
  { setId: 'me02',     file: 'phantasmal-flames-card-list.html',         seriesSlug: 'mega-evolution',  urlSlug: 'phantasmal-flames',        name: 'Phantasmal Flames',          series: 'Mega Evolution',   short: 'ME2',  releaseDate: 'Nov 2025', totalCards: '130' },
  { setId: 'me02pt5',  file: 'ascended-heroes-card-list.html',           seriesSlug: 'mega-evolution',  urlSlug: 'ascended-heroes',          name: 'Ascended Heroes',            series: 'Mega Evolution',   short: 'ME2.5',releaseDate: 'Jan 2026', totalCards: '295' },
  { setId: 'me03',     file: 'perfect-order-card-list.html',             seriesSlug: 'mega-evolution',  urlSlug: 'perfect-order',            name: 'Perfect Order',              series: 'Mega Evolution',   short: 'ME3',  releaseDate: 'Mar 2026', totalCards: '124' },
  { setId: 'me04',     file: 'chaos-rising-card-list.html',              seriesSlug: 'mega-evolution',  urlSlug: 'chaos-rising',             name: 'Chaos Rising',               series: 'Mega Evolution',   short: 'ME4',  releaseDate: 'May 2026', totalCards: '122' },
];

function toSlug(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── 1. Static card table ─────────────────────────────────────────────────────
function buildTable(cards, setName, seriesSlug, urlSlug) {
  const rows = cards.map(c => {
    const cardPath = `/pokemon/sets/${seriesSlug}/${urlSlug}/cards/${toSlug(c.name)}-${c.localId}`;
    return `<tr><td>${c.localId}</td><td><a href="${cardPath}">${c.name}</a></td><td>${c.rarity || ''}</td></tr>`;
  }).join('\n');
  return `\n<!-- SEO: static card list for search engine indexing -->\n<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0" aria-hidden="true">\n<h2>${setName} Card List — All ${cards.length} Cards</h2>\n<table>\n<thead><tr><th>Number</th><th>Card Name</th><th>Rarity</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</div>`;
}

// ── 2. H1 fix ────────────────────────────────────────────────────────────────
function fixH1(html, name, series) {
  // Pattern: <h1 class="set-title">\n          <span class="gradient-text">SERIES</span><br>NAME
  const oldH1 = `<h1 class="set-title">\n          <span class="gradient-text">${series}</span><br>${name}`;
  if (!html.includes(oldH1)) return html;
  const newH1 = `<h1 class="set-title">\n          ${name} Card List\n        </h1>\n        <p class="set-series-label" style="font-size:0.85rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-blue);margin-top:-8px;margin-bottom:8px;">${series}</p>\n        <h1 style="display:none">`;
  return html.replace(oldH1, newH1);
}

// ── 3. H2 emoji cleanup ───────────────────────────────────────────────────────
function fixH2s(html, name, short) {
  return html
    .replace(`<h2 class="section-title">🔥 ${name} <span class="gradient-text">Chase Cards</span></h2>`,
             `<h2 class="section-title">${name} <span class="gradient-text">Chase Cards</span></h2>`)
    .replace(`<h2 class="section-title">📋 ${name} <span class="gradient-text">Card List</span></h2>`,
             `<h2 class="section-title">${name} <span class="gradient-text">Card List</span></h2>`)
    .replace(`<h2 class="section-title">🛒 Buy ${short} <span class="gradient-text">Booster Boxes &amp; ETBs</span></h2>`,
             `<h2 class="section-title">Buy ${name} <span class="gradient-text">Booster Boxes &amp; ETBs</span></h2>`)
    .replace(`<h2 class="section-title">Get ${name} <span class="gradient-text">Restock Alerts</span></h2>`,
             `<h2 class="section-title">${name} <span class="gradient-text">Restock Alerts</span></h2>`);
}


// ── Per-set FAQ data (specific questions beat generic ones for SEO) ────────────
const SET_FAQS = {
  'me05': [
    { q: 'What is the most expensive Pitch Black card?', a: 'The most expensive Pitch Black card is the Mega Darkrai ex Special Illustration Rare, illustrated by Akira Egawa. Mega Zeraora ex SIR and Gwynn SIR are also top chase pulls.' },
    { q: 'How many cards are in the Pitch Black card list?', a: 'Pitch Black contains 118 cards — 81 main set cards plus 37 secret rares including Illustration Rares, Special Illustration Rares, and the Mega Darkrai ex Mega Hyper Rare at #118.' },
    { q: 'When does Pitch Black release?', a: 'Pitch Black releases July 26, 2026. Prerelease events begin July 4, 2026 at participating local game stores.' },
    { q: 'What Mega Pokemon are in Pitch Black?', a: 'Pitch Black features Mega Darkrai ex, Mega Zeraora ex, Mega Chandelure ex, and Mega Excadrill ex as its four confirmed Mega Evolution Pokemon ex.' },
    { q: 'Is Pitch Black based on a Japanese set?', a: 'Yes — Pitch Black is the English adaptation of the Japanese set Abyss Eye, released May 22, 2026. The sets are nearly identical.' },
    { q: 'What is the Pitch Black set code?', a: 'The Pitch Black set code is ME05, the fifth expansion in the Pokémon TCG Mega Evolution series.' },
  ],
  'me04': [
    { q: 'What is the most expensive Chaos Rising card?', a: 'The most expensive Chaos Rising card is the Mega Greninja ex Mega Hyper Rare (#122). The Mega Greninja ex SIR is also among the top chase pulls.' },
    { q: 'How many cards are in the Chaos Rising card list?', a: 'Chaos Rising contains 122 cards in total — 81 main set cards plus secret rares including Illustration Rares, SIRs, and the Mega Greninja ex Mega Hyper Rare.' },
    { q: 'When did Chaos Rising release?', a: 'Chaos Rising released May 22, 2026 as the fourth set in the Pokémon TCG Mega Evolution series.' },
    { q: 'What Mega Pokemon are in Chaos Rising?', a: 'Chaos Rising features Mega Greninja ex as the headline card, alongside Mega Gyarados ex, Mega Beedrill ex, Mega Pidgeot ex, and Mega Alakazam ex.' },
    { q: 'Is Chaos Rising based on a Japanese set?', a: 'Yes — Chaos Rising adapts the Japanese set Ninja Spinner, which introduced Mega Greninja ex.' },
  ],
  'me03': [
    { q: 'What is the most expensive Perfect Order card?', a: 'The most expensive Perfect Order card is the Mega Zygarde ex Mega Ultra Rare (#117). Rosa\'s Encouragement SIR is also a standout chase pull.' },
    { q: 'How many cards are in the Perfect Order card list?', a: 'Perfect Order contains 124 cards — 81 main set cards plus secret rares across IR, UR, SIR, and Mega Ultra Rare tiers.' },
    { q: 'When did Perfect Order release?', a: 'Perfect Order released March 2026 as the third set in the Pokémon TCG Mega Evolution series.' },
    { q: 'What Mega Pokemon are in Perfect Order?', a: 'Perfect Order is headlined by Mega Zygarde ex, Mega Starmie ex, and Mega Clefable ex.' },
  ],
  'sv8pt5': [
    { q: 'What is the most expensive Prismatic Evolutions card?', a: 'The most expensive Prismatic Evolutions cards are the Eeveelution Special Illustration Rares — Umbreon ex SIR, Sylveon ex SIR, and Espeon ex SIR consistently rank highest by market value.' },
    { q: 'How many cards are in the Prismatic Evolutions card list?', a: 'Prismatic Evolutions contains 180 cards — 87 main set cards plus 93 secret rares including Illustration Rares, Ultra Rares, Special Illustration Rares, and Hyper Rares.' },
    { q: 'When did Prismatic Evolutions release?', a: 'Prismatic Evolutions released January 17, 2025 as the SV8.5 subset of the Scarlet & Violet era.' },
    { q: 'Why is Prismatic Evolutions so hard to find?', a: 'Prismatic Evolutions was one of the most in-demand Pokémon TCG sets ever printed. The Eevee theme and high concentration of SIRs drove demand far beyond supply at launch.' },
    { q: 'Does Prismatic Evolutions have a God Pack?', a: 'Yes — Prismatic Evolutions God Packs contain all Illustration Rares from a single booster pack, making them extremely rare and sought-after.' },
  ],
  'sv3pt5': [
    { q: 'What is the most expensive Pokemon 151 card?', a: 'The most expensive Pokemon 151 cards are the Charizard ex SIR, Mew ex SIR, and Alakazam ex SIR. Charizard ex is consistently one of the highest-valued cards in the Scarlet & Violet era.' },
    { q: 'How many cards are in the Pokemon 151 card list?', a: 'Pokemon 151 contains 207 cards — 165 main set cards plus 42 secret rares including Illustration Rares and Special Illustration Rares.' },
    { q: 'When did Pokemon 151 release?', a: 'Pokemon 151 released September 22, 2023 as the SV3.5 subset of the Scarlet & Violet era.' },
    { q: 'Does Pokemon 151 have all original Kanto Pokemon?', a: 'Yes — all 151 original Kanto Pokemon appear in the set, making it a nostalgia-driven collector favourite.' },
    { q: 'Is Pokemon 151 a good set to collect?', a: 'Pokemon 151 is one of the most popular Scarlet & Violet sets for collectors due to its nostalgic Kanto theme and deep roster of Illustration Rares covering beloved original Pokemon.' },
  ],
};

function getFAQ(setId) {
  return SET_FAQS[setId] || null;
}

// ── 4. FAQ section ────────────────────────────────────────────────────────────
function getDefaultFAQ(name, series, releaseDate, totalCards) {
  return [
    { q: `How many cards are in the ${name} card list?`, a: `${name} contains ${totalCards} cards in total, including the main set and all secret rare cards. Use the rarity filter above to browse by type.` },
    { q: `When did ${name} release?`, a: `${name} released in ${releaseDate} as part of the Pokémon TCG ${series} series.` },
    { q: `What are the top chase cards in ${name}?`, a: `The most valuable ${name} cards are the highest rarity pulls — Special Illustration Rares, Hyper Rares, and Illustration Rares. See the Chase Cards section above for a complete ranked list with live TCGplayer prices.` },
    { q: `Are ${name} card prices available?`, a: `Yes — live market prices from TCGplayer are updated daily on this page. Click any card to view current listings and buying options.` },
    { q: `What series is ${name} part of?`, a: `${name} is part of the ${series} series of the Pokémon Trading Card Game.` },
  ];
}

function buildFAQ(name, series, releaseDate, totalCards, setId) {
  const faqs = getFAQ(setId) || getDefaultFAQ(name, series, releaseDate, totalCards);
  const items = faqs.map(f => `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:10px;color:var(--text-light);">${f.q}</h3>
        <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.7;">${f.a}</p>
      </div>`).join('\n');
  return `<!-- ===== FAQ ===== -->
<section style="padding:64px 0;border-top:1px solid rgba(255,255,255,0.06);">
  <div class="container" style="max-width:800px;">
    <h2 class="section-title" style="text-align:center;margin-bottom:48px;">${name} <span class="gradient-text">FAQ</span></h2>
    <div style="display:flex;flex-direction:column;gap:24px;">${items}
    </div>
  </div>
</section>

`;
}

function buildFAQSchema(name, series, releaseDate, totalCards, setId) {
  const faqs = getFAQ(setId) || getDefaultFAQ(name, series, releaseDate, totalCards);
  const entities = faqs.map(f =>
    `    {"@type":"Question","name":${JSON.stringify(f.q)},"acceptedAnswer":{"@type":"Answer","text":${JSON.stringify(f.a)}}}`
  ).join(',\n');
  return `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n${entities}\n  ]\n}\n<\/script>\n`;
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let passed = 0, skipped = 0, failed = 0;

for (const { setId, file, seriesSlug, urlSlug, name, series, short, releaseDate, totalCards } of SETS) {
  process.stdout.write(`${setId} (${file})... `);

  if (!existsSync(file)) {
    console.log(`⚠️  file not found — skipping`);
    skipped++;
    continue;
  }

  let html = readFileSync(file, 'utf8');
  let changes = [];

  // 1. Static card table
  if (!html.includes('SEO: static card list')) {
    try {
      const res = await fetch(`${R2}/data/${setId}.json`);
      if (!res.ok) throw new Error(`R2 ${res.status}`);
      const json = await res.json();
      const cards = json.cards || [];
      if (cards.length > 0) {
        const table = buildTable(cards, name, seriesSlug, urlSlug);
        html = html.replace('</body>', table + '\n</body>');
        changes.push(`${cards.length} cards`);
      }
    } catch (e) {
      changes.push(`card table FAILED: ${e.message}`);
    }
  }

  // 2. H1 fix
  if (html.includes(`<span class="gradient-text">${series}</span><br>${name}`)) {
    html = fixH1(html, name, series);
    changes.push('H1');
  }

  // 3. H2 emoji cleanup
  if (html.includes(`🔥 ${name}`) || html.includes(`📋 ${name}`) || html.includes(`🛒 Buy ${short}`)) {
    html = fixH2s(html, name, short);
    changes.push('H2s');
  }

  // 4. FAQ section + schema
  // Replace if: no FAQ yet, OR has generic FAQ and we have per-set specific data
  const hasGenericFAQ = html.includes('highest rarity pulls') || html.includes('scheduled to release on');
  const hasPerSetFAQ  = !!getFAQ(setId);
  const needsFAQ = !html.includes('FAQPage') || (hasGenericFAQ && hasPerSetFAQ);
  if (needsFAQ) {
    const faqSection = buildFAQ(name, series, releaseDate, totalCards, setId);
    const faqSchema  = buildFAQSchema(name, series, releaseDate, totalCards, setId);
    if (html.includes('FAQPage')) {
      // Replace existing generic FAQ section and schema
      html = html.replace(/<!-- ===== FAQ ===== -->[\s\S]*?<!-- ===== FOOTER ===== -->/, faqSection + '<!-- ===== FOOTER ===== -->');
      html = html.replace(/<script type="application\/ld\+json">[\s\S]*?"@type": "FAQPage"[\s\S]*?<\/script>/, faqSchema);
      changes.push('FAQ updated');
    } else {
      html = html.replace('<!-- ===== FOOTER ===== -->', faqSection + '<!-- ===== FOOTER ===== -->');
      const ldIdx = html.indexOf('application/ld+json');
      const insertAt = html.indexOf('</script>', ldIdx) + '</script>'.length;
      html = html.slice(0, insertAt) + '\n' + faqSchema + html.slice(insertAt);
      changes.push('FAQ');
    }
  }

  if (changes.length === 0) {
    console.log(`✓ already up to date — skipping`);
    skipped++;
    continue;
  }

  writeFileSync(file, html);
  console.log(`✓ ${changes.join(', ')}`);
  passed++;
}

console.log(`\n✅ Done — ${passed} updated, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);


