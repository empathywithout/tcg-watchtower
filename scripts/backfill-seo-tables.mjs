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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

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
  { setId: 'me05',     file: 'pitch-black-card-list.html',               seriesSlug: 'mega-evolution',  urlSlug: 'pitch-black',              name: 'Pitch Black',                series: 'Mega Evolution',   short: 'ME5',  releaseDate: 'Jul 2026', totalCards: '118', phase: 'jp' },
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
    { q: 'What is the most expensive Pitch Black card?', a: "The most expensive Pitch Black card is the Mega Darkrai ex Special Illustration Rare, illustrated by Akira Egawa. Mega Zeraora ex SIR and Gwynn SIR are also top chase pulls." },
    { q: 'How many cards are in the Pitch Black card list?', a: "Pitch Black contains 118 cards — 81 main set cards plus 37 secret rares including Illustration Rares, Special Illustration Rares, and the Mega Darkrai ex Mega Hyper Rare at #118." },
    { q: 'When does Pitch Black release?', a: "Pitch Black releases July 26, 2026. Prerelease events begin July 4, 2026 at participating local game stores." },
    { q: 'What Mega Pokemon are in Pitch Black?', a: "Pitch Black features four confirmed Mega Evolution Pokemon ex: Mega Darkrai ex, Mega Zeraora ex, Mega Chandelure ex, and Mega Excadrill ex." },
    { q: 'Is Pitch Black based on a Japanese set?', a: "Yes — Pitch Black is the English adaptation of the Japanese set Abyss Eye, released May 22, 2026. The sets are nearly identical." },
    { q: 'What is the Pitch Black set code?', a: "The Pitch Black set code is ME05, the fifth expansion in the Pokemon TCG Mega Evolution series." },
  ],
  'me04': [
    { q: 'What is the most expensive Chaos Rising card?', a: "The most expensive Chaos Rising cards are the Mega Greninja ex Mega Hyper Rare (#122) and the Mega Greninja ex Special Illustration Rare. Mega Greninja ex is the standout chase pull of the set." },
    { q: 'How many cards are in the Chaos Rising card list?', a: "Chaos Rising contains 122 cards — 86 main set cards plus 36 secret rares including Illustration Rares, Ultra Rares, six Special Illustration Rares, and the Mega Greninja ex Mega Hyper Rare." },
    { q: 'When did Chaos Rising release?', a: "Chaos Rising released May 22, 2026 as the fourth set in the Pokemon TCG Mega Evolution series. Prerelease events ran May 9–17, 2026." },
    { q: 'What Mega Pokemon are in Chaos Rising?', a: "Chaos Rising features five Mega Evolution Pokemon ex: Mega Greninja ex (the headline card), Mega Floette ex, Mega Pyroar ex, Mega Dragalge ex, and Mega Gallade ex — with Mega Gallade ex added exclusively to the English set." },
    { q: 'What Japanese set is Chaos Rising based on?', a: "Chaos Rising is based on Japan's Ninja Spinner set (M4), released March 13, 2026. The English set adds Mega Gallade ex as an exclusive card not in the Japanese version." },
  ],
  'me03': [
    { q: 'What is the most expensive Perfect Order card?', a: "The most expensive Perfect Order card is the Mega Zygarde ex Mega Ultra Rare (#117). Rosa's Encouragement SIR is also a standout chase pull." },
    { q: 'How many cards are in the Perfect Order card list?', a: "Perfect Order contains 124 cards — 81 main set cards plus secret rares across Illustration Rare, Ultra Rare, Special Illustration Rare, and Mega Ultra Rare tiers." },
    { q: 'When did Perfect Order release?', a: "Perfect Order released March 2026 as the third set in the Pokemon TCG Mega Evolution series." },
    { q: 'What Mega Pokemon are in Perfect Order?', a: "Perfect Order is headlined by Mega Zygarde ex, Mega Starmie ex, and Mega Clefable ex as its three flagship Mega Evolution Pokemon ex." },
  ],
  'sv8pt5': [
    { q: 'What is the most expensive Prismatic Evolutions card?', a: "The most expensive Prismatic Evolutions cards are the Eeveelution Special Illustration Rares. Umbreon ex SIR, Sylveon ex SIR, and Espeon ex SIR consistently rank highest by market value." },
    { q: 'How many cards are in the Prismatic Evolutions card list?', a: "Prismatic Evolutions contains 180 cards — 87 main set cards plus 93 secret rares including Illustration Rares, Ultra Rares, Special Illustration Rares, and Hyper Rares." },
    { q: 'When did Prismatic Evolutions release?', a: "Prismatic Evolutions released January 17, 2025 as the SV8.5 subset of the Scarlet & Violet era." },
    { q: 'Why is Prismatic Evolutions so hard to find?', a: "Prismatic Evolutions was one of the most in-demand Pokemon TCG sets ever printed. The Eevee theme and high concentration of SIRs drove demand far beyond supply at launch." },
    { q: 'Does Prismatic Evolutions have a God Pack?', a: "Yes — Prismatic Evolutions God Packs contain all Illustration Rares from a single booster pack, making them extremely rare and sought-after." },
  ],
  'sv3pt5': [
    { q: 'What is the most expensive Pokemon 151 card?', a: "The most expensive Pokemon 151 card is the Charizard ex Special Illustration Rare (#199). The starter trio SIRs — Blastoise ex and Venusaur ex — and the Gen 1 Illustration Rares like Charmander IR and Squirtle IR also rank among the top pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Pokemon 151 card list?', a: "Pokemon 151 contains 207 cards — 165 main set cards plus 42 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Pokemon 151 release?', a: "Pokemon 151 released September 22, 2023 as the SV3.5 subset of the Scarlet & Violet era." },
    { q: 'Does Pokemon 151 have all original Kanto Pokemon?', a: "Yes — all 151 original Kanto Pokemon appear in the set, making it a nostalgia-driven collector favourite." },
    { q: 'Is Pokemon 151 a good set to collect?', a: "Pokemon 151 is one of the most popular Scarlet & Violet sets for collectors due to its nostalgic Kanto theme and deep roster of Illustration Rares covering beloved original Pokemon." },
  ],
  'me01': [
    { q: 'What is the most expensive Mega Evolution card?', a: "The most expensive Mega Evolution Base Set cards are the Mega Lucario ex Mega Hyper Rare and Mega Gardevoir ex Mega Hyper Rare — both among the rarest pulls in the set. The Mega Lucario ex SIR and Mega Gardevoir ex SIR are also strong chase pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Mega Evolution card list?', a: "Mega Evolution Base Set contains 188 cards — 132 main set cards plus 56 secret rares including Illustration Rares, Ultra Rares, Special Illustration Rares, and two Mega Hyper Rares." },
    { q: 'When did Mega Evolution release?', a: "Mega Evolution Base Set released September 26, 2025 globally. The EMEA release was delayed to October 10, 2025 due to delivery issues." },
    { q: 'What Mega Pokemon are in Mega Evolution Base Set?', a: "Mega Evolution Base Set features ten Mega Evolution Pokemon ex — one for each type — including Mega Lucario ex, Mega Gardevoir ex, Mega Venusaur ex, Mega Latias ex, Mega Kangaskhan ex, and Mega Absol ex." },
    { q: 'What Japanese sets is Mega Evolution based on?', a: "Mega Evolution Base Set is based on Japan's Mega Brave and Mega Symphonia sets, which released August 1, 2025." },
  ],
  'me02': [
    { q: 'What is the most expensive Phantasmal Flames card?', a: "The most expensive Phantasmal Flames cards are the Mega Charizard X ex Special Illustration Rare and the Mega Charizard X ex Mega Hyper Rare gold card — the standout chase pulls of the set. The Dawn SIR and Mega Sharpedo ex SIR are also top pulls. Note: Mega Gengar ex SIR is from Ascended Heroes (ME2.5), not Phantasmal Flames. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Phantasmal Flames card list?', a: "Phantasmal Flames contains 130 cards — 94 main set cards plus 36 secret rares including 13 Illustration Rares, 17 Ultra Rares, and 5 Special Illustration Rares." },
    { q: 'When did Phantasmal Flames release?', a: "Phantasmal Flames released November 14, 2025 as the second main expansion in the Pokemon TCG Mega Evolution series." },
    { q: 'What Mega Pokemon are in Phantasmal Flames?', a: "Phantasmal Flames features six Mega Evolution Pokemon ex: Mega Charizard X ex (the central card), Mega Gengar ex, Mega Heracross ex, Mega Lopunny ex, Mega Sharpedo ex, and Mega Diancie ex. The set focuses on Fire-type and Darkness-type Pokemon." },
    { q: 'What Japanese set is Phantasmal Flames based on?', a: "Phantasmal Flames is based on Japan's Inferno X expansion combined with the Mega Gengar ex and Mega Diancie ex Starter Sets." },
  ],
  'me02pt5': [
    { q: 'What is the most expensive Ascended Heroes card?', a: "The most expensive Ascended Heroes cards include the Mega Gengar ex Special Illustration Rare — often mistakenly attributed to Phantasmal Flames — along with other top SIRs across the 295-card set." },
    { q: 'How many cards are in the Ascended Heroes card list?', a: "Ascended Heroes contains 295 cards in total, making it the largest Pokemon TCG set ever printed." },
    { q: 'When did Ascended Heroes release?', a: "Ascended Heroes released January 2026 as the ME2.5 subset expansion in the Pokemon TCG Mega Evolution series." },
    { q: 'Does Mega Gengar ex SIR come from Ascended Heroes or Phantasmal Flames?', a: "Mega Gengar ex SIR is from Ascended Heroes (ME2.5) — not Phantasmal Flames. Phantasmal Flames only has Mega Gengar ex as a Double Rare. This is one of the most common mix-ups in the Mega Evolution block." },
    { q: 'Is Ascended Heroes worth buying?', a: "Ascended Heroes has a high concentration of premium rarities relative to its set size and is the largest Pokemon TCG set ever printed at 295 cards. Collectors targeting the Mega Gengar ex SIR make it a consistent target for sealed product purchases. Check live prices on TCG Watchtower." },
  ],
  'sv01': [
    { q: 'What is the most expensive Scarlet & Violet Base Set card?', a: "The most expensive Scarlet & Violet Base Set cards are the Gardevoir ex Special Illustration Rare (#245) and the Drowzee Illustration Rare (#210). Surprisingly, Illustration Rares like Ralts, Kirlia, and Slowpoke consistently outperform the Charizard ex SIR in this set. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Scarlet & Violet Base Set card list?', a: "Scarlet & Violet Base Set contains 258 cards — 198 numbered main set cards plus 60 secret rares including Illustration Rares, Ultra Rares, and Special Illustration Rares." },
    { q: 'When did Scarlet & Violet Base Set release?', a: "Scarlet & Violet Base Set released March 31, 2023 as the first expansion of the Scarlet & Violet era, introducing Pokemon ex and the new card design." },
    { q: 'What new mechanics did Scarlet & Violet introduce?', a: "Scarlet & Violet introduced Pokemon ex replacing V cards, plus Illustration Rares and Special Illustration Rares as new chase rarities." },
  ],
  'sv02': [
    { q: 'What is the most expensive Paldea Evolved card?', a: "The most expensive Paldea Evolved card is the Magikarp Illustration Rare (#203) — one of the biggest art-driven anomalies of the Scarlet & Violet era, commanding prices far above the set's SIRs despite being a lower rarity. The Iono SIR is the most iconic Trainer card in the set. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Paldea Evolved card list?', a: "Paldea Evolved contains 279 cards — 193 main set cards plus 86 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Paldea Evolved release?', a: "Paldea Evolved released June 9, 2023 as the second set in the Scarlet & Violet era." },
    { q: 'Why is the Iono card so valuable?', a: "The Iono Special Illustration Rare depicts the popular streamer character in a stunning full-art style. It became one of the most iconic and sought-after Trainer cards in modern Pokemon TCG history." },
  ],
  'sv03': [
    { q: 'What is the most expensive Obsidian Flames card?', a: "The most expensive Obsidian Flames card is the Charizard ex Special Illustration Rare — a Tera Dragon-type Charizard ex with black-and-gold artwork that became one of the most iconic cards of the Scarlet & Violet era." },
    { q: 'How many cards are in the Obsidian Flames card list?', a: "Obsidian Flames contains 230 cards — 151 main set cards plus 79 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Obsidian Flames release?', a: "Obsidian Flames released August 11, 2023 as the third set in the Scarlet & Violet era." },
    { q: 'What is the Tera Charizard ex card?', a: "The Charizard ex SIR in Obsidian Flames depicts a black-and-gold Tera Dragon Charizard. It is one of the most desirable Charizard cards ever printed and commands premium secondary market prices." },
  ],
  'sv04': [
    { q: 'What is the most expensive Paradox Rift card?', a: "The most expensive Paradox Rift card is the Groudon Illustration Rare — one of the most striking IR anomalies of the Scarlet & Violet era, commanding prices well above the set's SIRs. Roaring Moon ex SIR and Iron Valiant ex SIR are the top SIR pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Paradox Rift card list?', a: "Paradox Rift contains 266 cards — 182 main set cards plus 84 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Paradox Rift release?', a: "Paradox Rift released November 3, 2023 as the fourth set in the Scarlet & Violet era." },
    { q: 'What are Ancient and Future Pokemon in Paradox Rift?', a: "Paradox Rift introduced Ancient Pokemon (prehistoric forms like Roaring Moon ex) and Future Pokemon (futuristic forms like Iron Valiant ex) as the two themed factions." },
  ],
  'sv4pt5': [
    { q: 'What is the most expensive Paldean Fates card?', a: "The most expensive Paldean Fates card is the Mew ex SIR (#232), known as Bubble Mew — a fan-favourite depicting Mew sleeping inside a bubble. It consistently tops the set in secondary market value. Shiny Charizard ex SIR is the most iconic pull but trades below Bubble Mew. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Paldean Fates card list?', a: "Paldean Fates contains 245 cards total, including Shiny versions of Paldean Pokemon across all rarity tiers." },
    { q: 'When did Paldean Fates release?', a: "Paldean Fates released January 26, 2024 as the SV4.5 shiny subset of the Scarlet & Violet era." },
    { q: 'Does Paldean Fates have Shiny Pokemon?', a: "Yes — Paldean Fates is the shiny set of the Scarlet & Violet era, featuring Shiny versions of every Paldean Pokemon including Shiny Charizard ex as the headline pull." },
  ],
  'sv05': [
    { q: 'What is the most expensive Temporal Forces card?', a: "The most expensive Temporal Forces cards are the Walking Wake ex SIR (#205) and Raging Bolt ex SIR (#208), which consistently top the set. Iron Crown ex SIR (#206) and Gouging Fire ex SIR (#204) are also strong pulls. Sawsbuck IR is a notable Illustration Rare that punches above its rarity. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Temporal Forces card list?', a: "Temporal Forces contains 218 cards — 162 main set cards plus 56 secret rares including Illustration Rares, ACE SPEC cards, and Special Illustration Rares." },
    { q: 'When did Temporal Forces release?', a: "Temporal Forces released March 22, 2024 as the fifth set in the Scarlet & Violet era." },
    { q: 'What are ACE SPEC cards in Temporal Forces?', a: "ACE SPEC cards are powerful Trainer cards — only one allowed per deck — that Temporal Forces reintroduced to the Pokemon TCG for the first time since the Black & White era." },
  ],
  'sv06': [
    { q: 'What is the most expensive Twilight Masquerade card?', a: "The most expensive Twilight Masquerade card is the Greninja ex Special Illustration Rare (#214) — one of the most valuable cards in the entire Scarlet & Violet era, driven by stunning artwork and competitive playability. Wellspring Mask Ogerpon ex SIR and Perrin SIR are also strong pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Twilight Masquerade card list?', a: "Twilight Masquerade contains 226 cards — 162 main set cards plus 64 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Twilight Masquerade release?', a: "Twilight Masquerade released May 24, 2024 as the sixth set in the Scarlet & Violet era." },
    { q: 'What Pokemon headline Twilight Masquerade?', a: "Twilight Masquerade is built around Ogerpon ex in all four mask forms — Hearthflame, Cornerstone, Wellspring, and Teal Mask — as the defining theme of the set." },
  ],
  'sv6pt5': [
    { q: 'What is the most expensive Shrouded Fable card?', a: "The most expensive Shrouded Fable cards are the Basic Darkness Energy Hyper Rare (#98), Duskull Illustration Rare (#68), Persian Illustration Rare (#78), and Cassiopeia SIR (#94). Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Shrouded Fable card list?', a: "Shrouded Fable contains 99 cards in total, making it a compact subset with higher odds on premium rarities per pack than a standard main set." },
    { q: 'When did Shrouded Fable release?', a: "Shrouded Fable released August 2, 2024 as the SV6.5 subset of the Scarlet & Violet era." },
    { q: 'What Pokemon headline Shrouded Fable?', a: "Shrouded Fable focuses on the Mask of Ruin legendaries — Chien-Pao ex, Ting-Lu ex, Chi-Yu ex, and Wo-Chien ex — alongside the mythical Pecharunt ex." },
  ],
  'sv07': [
    { q: 'What is the most expensive Stellar Crown card?', a: "The most expensive Stellar Crown cards are the Squirtle Illustration Rare (#148) and Bulbasaur Illustration Rare (#143) — Gen 1 starters that consistently top the price charts. The Terapagos ex SIR (#170) and Dachsbun ex SIR (#169) are also top pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Stellar Crown card list?', a: "Stellar Crown contains 175 cards — 142 main set cards plus 33 secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Stellar Crown release?', a: "Stellar Crown released September 13, 2024 as the seventh set in the Scarlet & Violet era." },
    { q: 'What is the Stellar-type mechanic in Stellar Crown?', a: "Stellar Crown introduced Stellar-type Tera Pokemon ex — a special rainbow type that can use any Energy — headlined by Terapagos ex as the iconic Stellar-type card." },
  ],
  'sv08': [
    { q: 'What is the most expensive Surging Sparks card?', a: "The most expensive Surging Sparks card is the Pikachu ex Special Illustration Rare (#238) — the standout chase pull of the set and one of the most sought-after cards of 2024. Latias ex SIR (#239) and Milotic ex SIR (#237) are also top pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Surging Sparks card list?', a: "Surging Sparks contains 252 cards — 191 main set cards plus 61 secret rares — making it the largest standard set in the Scarlet & Violet era." },
    { q: 'When did Surging Sparks release?', a: "Surging Sparks released November 8, 2024 as the eighth set in the Scarlet & Violet era." },
    { q: 'Why does Surging Sparks have so many cards?', a: "Surging Sparks is the largest standard Scarlet & Violet set at 252 cards, featuring multiple Pikachu ex SIR variants and a deep Illustration Rare lineup covering popular Pokemon." },
  ],
  'sv09': [
    { q: 'What is the most expensive Journey Together card?', a: "The most expensive Journey Together card is Lillie's Clefairy ex Special Illustration Rare — the standout chase pull of the set, commanding strong secondary market value. Salamence ex SIR and N's Zoroark ex SIR are also top pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Journey Together card list?', a: "Journey Together contains 190 cards spanning main set cards and secret rares including Illustration Rares and Special Illustration Rares." },
    { q: 'When did Journey Together release?', a: "Journey Together released March 28, 2025 as the ninth set in the Scarlet & Violet era." },
    { q: 'What is the theme of Journey Together?', a: "Journey Together celebrates the bond between trainers and their Pokemon, featuring iconic partnerships and trainer-focused artwork throughout the set." },
  ],
  'sv10': [
    { q: 'What is the most expensive Destined Rivals card?', a: "The most expensive Destined Rivals card is Team Rocket's Mewtwo ex Special Illustration Rare (#231) — one of the priciest SIRs of the Scarlet & Violet era, driven by Team Rocket nostalgia and stunning artwork. Misty's Psyduck IR and Ethan's Typhlosion IR are also strong pulls. Check live prices on TCG Watchtower." },
    { q: 'How many cards are in the Destined Rivals card list?', a: "Destined Rivals contains 244 cards including main set cards and secret rares across all rarity tiers." },
    { q: 'When did Destined Rivals release?', a: "Destined Rivals released May 30, 2025 as the tenth main set in the Scarlet & Violet era." },
    { q: 'What is the theme of Destined Rivals?', a: "Destined Rivals celebrates iconic rival duos from across Pokemon history through its card artwork and set design." },
  ],
  'zsv10pt5': [
    { q: 'What is the most expensive Black Bolt card?', a: "The most expensive Black Bolt cards are the Red Victini Black & White Rare, Zekrom ex SIR, and the God Pack. Red Victini is the rarest and most valuable pull in the set." },
    { q: 'How many cards are in the Black Bolt card list?', a: "Black Bolt contains 172 cards — 86 main set cards plus 86 secret rares including Art Rares, Special Illustration Rares, and Black & White Rares." },
    { q: 'When did Black Bolt release?', a: "Black Bolt released July 18, 2025 alongside White Flare as the SV10.5 split Unova expansion." },
    { q: 'Does Black Bolt have God Packs?', a: "Yes — Black Bolt features God Packs containing 9 Illustration Rares and 1 Special Illustration Rare." },
  ],
  'rsv10pt5': [
    { q: 'What is the most expensive White Flare card?', a: "The most expensive White Flare cards are the Red Victini Black & White Rare, Reshiram ex SIR, and Hydreigon ex SIR. Red Victini is the rarest pull in the set." },
    { q: 'How many cards are in the White Flare card list?', a: "White Flare contains 173 cards — 86 main set cards plus 87 secret rares including Art Rares, Special Illustration Rares, and Black & White Rares." },
    { q: 'When did White Flare release?', a: "White Flare released July 18, 2025 alongside Black Bolt as the SV10.5 split Unova expansion." },
    { q: 'Does White Flare have God Packs?', a: "Yes — White Flare features God Packs containing 9 Illustration Rares and 1 Special Illustration Rare." },
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
    { q: `What are the top chase cards in ${name}?`, a: `The most valuable ${name} cards are the highest rarity pulls — Special Illustration Rares, Hyper Rares, and Illustration Rares. See the Chase Cards section above for a complete ranked list with live prices.` },
    { q: `Are ${name} card prices available?`, a: `Yes — live prices are updated daily on this page. Click any card to view current listings and buying options.` },
    { q: `What series is ${name} part of?`, a: `${name} is part of the ${series} series of the Pokémon Trading Card Game.` },
  ];
}

function buildFAQ(name, series, releaseDate, totalCards, setId, chaseUrl) {
  const faqs = getFAQ(setId) || getDefaultFAQ(name, series, releaseDate, totalCards);
  const chaseLink = chaseUrl
    ? `<a href="${chaseUrl}" style="display:inline-block;margin-top:10px;font-size:0.82rem;font-weight:700;color:#4ade80;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">See all ${name} chase cards ranked by price →</a>`
    : '';
  const items = faqs.map(f => {
    const isMostExpensive = f.q.toLowerCase().includes('most expensive');
    return `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:10px;color:var(--text-light);">${f.q}</h3>
        <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.7;">${f.a}</p>
        ${isMostExpensive ? chaseLink : ''}
      </div>`;
  }).join('\n');
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


// ── Per-set SEO description text ──────────────────────────────────────────────
const SET_INTROS = {
  'sv01': 'Scarlet &amp; Violet Base Set is the first expansion of the Pokémon TCG Scarlet &amp; Violet era, released March 31, 2023. Based on Japan\'s Scarlet ex and Violet ex sets, it introduced Pokémon ex, Illustration Rares, and Special Illustration Rares as new chase rarities. The 258-card set\'s top chase cards include the Gardevoir ex SIR and a surprisingly deep lineup of Illustration Rares — Drowzee, Ralts, Kirlia, and Slowpoke — that consistently outperform the Charizard ex and Miraidon ex SIRs in secondary market value. This complete Scarlet &amp; Violet Base Set card list includes every card with rarity filters and live prices updated daily.',
  'sv02': 'Paldea Evolved is the second Scarlet &amp; Violet expansion, released June 9, 2023. Based on Japan\'s Clay Burst and Snow Hazard sets, it features 279 cards. The standout chase card is the Magikarp Illustration Rare (#203) — one of the most expensive cards in the entire Scarlet &amp; Violet era despite being an IR, driven purely by iconic artwork. The Iono Special Illustration Rare is the most sought-after Trainer card in the set. This complete Paldea Evolved card list includes every card with rarity filters and live prices updated daily.',  'sv03': 'Obsidian Flames is the third Scarlet &amp; Violet expansion, released August 11, 2023. Based on Japan\'s Ruler of the Black Flame set, it introduced Tera-type Pokémon ex in multiple types across the set. The headline card is Charizard ex SIR — depicting Charizard in its black-and-gold Tera Dragon form — one of the most valuable and iconic cards of the Scarlet &amp; Violet era. The 230-card set also features Tyranitar ex, Revavroom ex, and a strong Trainer SIR lineup. This complete Obsidian Flames card list includes every card with rarity filters and live prices updated daily.',
  'sv04': 'Paradox Rift is the fourth Scarlet &amp; Violet expansion, released November 3, 2023. Based on Japan\'s Ancient Roar and Future Flash sets, it introduced Ancient and Future Pokémon ex as two distinct themed factions. The Groudon Illustration Rare is the top chase card, commanding prices above all SIRs in the set. Roaring Moon ex SIR and Iron Valiant ex SIR are the top SIR pulls — both competitively viable and visually stunning. The 266-card set spans 182 main set cards plus 84 secret rares. This complete Paradox Rift card list includes every card with rarity filters and live prices updated daily.',
  'sv3pt5': 'Pokémon 151 is the first Scarlet &amp; Violet subset, released September 22, 2023. It covers all 151 original Kanto Pokémon and is one of the most nostalgic and in-demand collector sets of the modern era. The 207-card set spans 165 main set cards plus 42 secret rares, headlined by Charizard ex SIR (#199) as the top chase card, alongside Blastoise ex SIR, Venusaur ex SIR, and standout Illustration Rares including Charmander IR, Squirtle IR, and Zapdos ex SIR. Every original Kanto Pokémon appears at least once, and the Illustration Rare lineup is among the deepest in any set. This complete Pokémon 151 card list includes every card with rarity filters and live prices updated daily.',
  'sv4pt5': 'Paldean Fates is the fourth Scarlet &amp; Violet subset, released January 26, 2024. It is a shiny vault set featuring Shiny Pokémon ex, Shiny Rare, and Shiny Ultra Rare cards alongside Special Illustration Rares. The top chase card is the Mew ex SIR (#232), known as Bubble Mew — one of the most valuable cards of the Scarlet &amp; Violet era. Shiny Charizard ex SIR is the most recognizable pull. This complete Paldean Fates card list includes every card with rarity filters and live prices updated daily.',  'sv05': 'Temporal Forces is the fifth Scarlet &amp; Violet expansion, released March 22, 2024. Based on Japan\'s Temporal Forces set, it reintroduced ACE SPEC cards to the Pokémon TCG for the first time since the Black &amp; White era. Walking Wake ex SIR (#205) and Raging Bolt ex SIR (#208) are the top chase pulls, alongside Iron Crown ex SIR (#206) and Gouging Fire ex SIR (#204). Sawsbuck IR is the standout Illustration Rare. ACE SPEC Trainer cards are competitively impactful but not the most expensive singles. The 218-card set spans 162 main cards plus 56 secret rares. This complete Temporal Forces card list includes every card with rarity filters and live prices updated daily.',
  'sv06': 'Twilight Masquerade is the sixth Scarlet &amp; Violet expansion, released May 24, 2024. Based on Japan\'s Mask of Change set, it is built around Ogerpon ex in all four mask forms. The Greninja ex Special Illustration Rare (#214) is the top chase pull of the set — one of the most valuable cards in the Scarlet &amp; Violet era, driven by stunning artwork and competitive playability. The Wellspring Mask Ogerpon ex SIR is also a strong pull. The 226-card set spans 162 main set cards plus 64 secret rares. This complete Twilight Masquerade card list includes every card with rarity filters and live prices updated daily.',
  'sv6pt5': 'Shrouded Fable is the third Scarlet &amp; Violet subset, released August 2, 2024. Based on Japan\'s Night Wanderer set, it focuses on the Loyal Three — Fezandipiti ex, Okidogi ex, and Munkidori ex — alongside the mythical Pecharunt ex. At just 99 cards, it has fewer packs cracked than standard sets, which has driven up single prices. The top chase cards are the Basic Darkness Energy Hyper Rare, Duskull IR, Persian IR, and Cassiopeia SIR. This complete Shrouded Fable card list includes every card with rarity filters and live prices updated daily.',
  'sv07': 'Stellar Crown is the seventh Scarlet &amp; Violet expansion, released September 13, 2024. Based on Japan\'s Stellar Miracle set, it introduced Stellar-type Tera Pokémon ex headlined by Terapagos ex. The 175-card set spans 142 main set cards plus 33 secret rares. The top chase cards are the Squirtle IR and Bulbasaur IR — rare Gen 1 starters with some of the most sought-after artwork in the set — alongside the Terapagos ex SIR and Dachsbun ex SIR. This complete Stellar Crown card list includes every card with rarity filters and live prices updated daily.',
  'sv08': 'Surging Sparks is the eighth Scarlet &amp; Violet expansion, released November 8, 2024. Based on Japan\'s Super Electric Breaker set, it is the largest standard set of the Scarlet &amp; Violet era at 252 cards. The set is headlined by multiple Pikachu ex Special Illustration Rare variants that became some of the most popular pull targets of 2024. With 191 main set cards and 61 secret rares, Surging Sparks has the deepest Illustration Rare lineup of any Scarlet &amp; Violet main set. This complete Surging Sparks card list includes every card with rarity filters and live prices updated daily.',
  'sv8pt5': 'Prismatic Evolutions is the fourth Scarlet &amp; Violet subset, released January 17, 2025. Based on Japan\'s Eevee Heroes subset, it features all eight Eeveelutions in multiple art styles across 180 cards. Umbreon ex SIR, Sylveon ex SIR, and Espeon ex SIR are the top chase pulls. God Packs — containing all Illustration Rares in a single pack — are a defining feature of the set. Demand at launch far outpaced supply, making sealed product scarce for months. This complete Prismatic Evolutions card list includes every card with rarity filters and live prices updated daily.',
  'sv09': 'Journey Together is the ninth Scarlet &amp; Violet expansion, released March 28, 2025. It celebrates the bond between trainers and Pokémon through its card artwork and set design, with a strong lineup of trainer-focused Illustration Rares and Special Illustration Rares across 190 cards. This complete Journey Together card list includes every card with rarity filters and live prices updated daily.',
  'sv10': 'Destined Rivals is the tenth main Scarlet &amp; Violet expansion, released May 30, 2025. It celebrates iconic rival duos from across Pokémon history through rivalry-themed artwork and set design, spanning 244 cards with high-demand Special Illustration Rares. This complete Destined Rivals card list includes every card with rarity filters and live prices updated daily.',
  'zsv10pt5': 'Black Bolt is one half of the SV10.5 split expansion, released July 18, 2025 alongside White Flare. Together they cover all 156 Unova Pokémon — Black Bolt focuses on Dark and Lightning types centered around Zekrom ex. Every Pokémon in the set has an Art Rare or SIR variant, making it one of the most artwork-dense sets ever printed. The ultra-rare Red Victini Black &amp; White Rare is the rarest and most valuable pull. God Packs containing 9 Illustration Rares and 1 SIR are also a feature of the set. This complete Black Bolt card list includes every card with rarity filters and live prices updated daily.',
  'rsv10pt5': 'White Flare is one half of the SV10.5 split expansion, released July 18, 2025 alongside Black Bolt. Together they cover all 156 Unova Pokémon — White Flare focuses on Fire and Water types centered around Reshiram ex and Keldeo ex. Every Pokémon has an Art Rare or SIR variant. The ultra-rare Red Victini Black &amp; White Rare is the rarest pull in the set. This complete White Flare card list includes every card with rarity filters and live prices updated daily.',
  'me01': 'Mega Evolution Base Set is the first expansion of the Pokémon TCG Mega Evolution era, released September 26, 2025. Based on Japan\'s Mega Brave and Mega Symphonia sets, it introduced Mega Evolution Pokémon ex — one for each type — to the modern card game for the first time. The 188-card set features ten Mega Evolution Pokémon ex including Mega Lucario ex, Mega Gardevoir ex, and Mega Venusaur ex as the headline Megas. Mega Lucario ex MHR and Mega Gardevoir ex MHR are the top chase pulls in the set. This complete Mega Evolution card list includes every card with rarity filters and live prices updated daily.',
  'me02': 'Phantasmal Flames is the second Mega Evolution expansion, released November 14, 2025. Based on Japan\'s Inferno X set plus the Mega Gengar ex and Mega Diancie ex Starter Sets, it features six Mega Evolution Pokémon ex: Mega Charizard X ex (the central card), Mega Gengar ex, Mega Heracross ex, Mega Lopunny ex, Mega Sharpedo ex, and Mega Diancie ex. The set focuses on Fire and Darkness types. Mega Charizard X ex SIR is the top chase pull in the set. The Dawn SIR and Mega Sharpedo ex SIR are also strong pulls. This complete Phantasmal Flames card list includes every card with rarity filters and live prices updated daily.',
  'me02pt5': 'Ascended Heroes is the ME2.5 subset expansion in the Pokémon TCG Mega Evolution series, released January 2026. At 295 cards, Ascended Heroes is the largest Pokémon TCG set ever printed, with a massive roster of Mega Evolution Pokémon ex and an exceptional density of Special Illustration Rares — including the Mega Gengar ex SIR, which is one of the most valuable singles in the entire Mega Evolution block. This complete Ascended Heroes card list includes every card with rarity filters and live prices updated daily.',
};

function injectIntro(html, setId, name) {
  const intro = SET_INTROS[setId];
  if (!intro) return html; // skip — me03/me04/me05 handled by sync workflow

  const introTag = `<p class="set-desc" style="margin-top:12px;font-size:0.95rem;opacity:0.85;">`;

  // Always replace existing intro with fresh content
  if (html.includes(introTag)) {
    html = html.replace(/<p class="set-desc" style="margin-top:12px;font-size:0\.95rem;opacity:0\.85;">[\s\S]*?<\/p>/, `${introTag}${intro}</p>`);
    return html;
  }

  // Find the last set-desc paragraph (regardless of content) and inject after it
  // Handles: standard generic, set-code variants like "(SV2)", and any custom text
  const lastSetDescMatch = [...html.matchAll(/<p class="set-desc"[^>]*>[\s\S]*?<\/p>/g)].pop();
  if (lastSetDescMatch) {
    const insertAt = lastSetDescMatch.index + lastSetDescMatch[0].length;
    html = html.slice(0, insertAt) + `\n        ${introTag}${intro}</p>` + html.slice(insertAt);
    return html;
  }

  return html;
}

// ── Download buttons ──────────────────────────────────────────────────────────
function injectDownloadButtons(html, setId, name) {
  // Skip if already has download buttons
  // Always replace existing download section with fresh content
  if (html.includes('download-buttons-section')) {
    // Remove everything from the DOWNLOAD BUTTONS comment to the filter-bar
    html = html.replace(/<!-- ===== DOWNLOAD BUTTONS ===== -->[\s\S]*?(?=\n    <div class="filter-bar")/, '');
    // Fallback: try to strip just the section div if comment not found
    if (html.includes('download-buttons-section')) {
      html = html.replace(/<div class="download-buttons-section"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/, '');
    }
  }

  const btnHtml = `
<!-- ===== DOWNLOAD BUTTONS ===== -->
<div class="download-buttons-section" style="margin:0 0 32px;padding:20px 24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;">
  <p style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:4px;">${name} Master Set Tools</p>\n  <p style=\"font-size:0.75rem;color:var(--text-muted);margin-bottom:14px;opacity:0.7;">Free printable binder placeholders &amp; master set checklist — instant download</p>
  <div style="display:flex;flex-wrap:wrap;gap:10px;">
    <div style="position:relative;display:inline-block;">
      <button onclick="(function(b){var p=b.parentElement.querySelector('.cl-picker');p.style.display=p.style.display==='flex'?'none':'flex'})(this)" style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.25);border-radius:8px;color:#4ade80;font-size:0.82rem;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:inherit;" onmouseover="this.style.background='rgba(74,222,128,0.2)'" onmouseout="this.style.background='rgba(74,222,128,0.1)'">
        <span>📋</span> Free Master Set Checklist <span style="font-size:0.7rem;opacity:0.7;">▾</span>
      </button>
      <div class="cl-picker" style="display:none;position:absolute;top:calc(100% + 6px);left:0;flex-direction:column;gap:0;background:#1e293b;border:1px solid rgba(74,222,128,0.3);border-radius:10px;overflow:hidden;z-index:100;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
        <a href="/api/checklist?set=${setId}&type=master&format=xlsx" style="display:flex;align-items:center;gap:10px;padding:12px 16px;color:#4ade80;text-decoration:none;font-size:0.82rem;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.06);transition:background 0.15s;" onmouseover="this.style.background='rgba(74,222,128,0.12)'" onmouseout="this.style.background=''">
          <span style="font-size:1.1rem;">📊</span>
          <span><strong>Google Sheets / Excel</strong><br><span style="font-size:0.72rem;opacity:0.65;font-weight:400;">Dropdowns, color coding, 3 sheets</span></span>
        </a>
        <a href="/api/checklist?set=${setId}&type=master&format=csv" style="display:flex;align-items:center;gap:10px;padding:12px 16px;color:#86efac;text-decoration:none;font-size:0.82rem;font-weight:600;transition:background 0.15s;" onmouseover="this.style.background='rgba(74,222,128,0.08)'" onmouseout="this.style.background=''">
          <span style="font-size:1.1rem;">📄</span>
          <span><strong>CSV</strong><br><span style="font-size:0.72rem;opacity:0.65;font-weight:400;">Works everywhere</span></span>
        </a>
      </div>
    </div>
    <a href="/api/binder-pdf?set=${setId}&size=9" download style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.25);border-radius:8px;color:#c084fc;font-size:0.82rem;font-weight:700;text-decoration:none;transition:all 0.2s;" onmouseover="this.style.background='rgba(168,85,247,0.2)'" onmouseout="this.style.background='rgba(168,85,247,0.1)'">
      <span>📄</span> Binder Placeholders — 9-Pocket
    </a>
    <a href="/api/binder-pdf?set=${setId}&size=12" download style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.25);border-radius:8px;color:#c084fc;font-size:0.82rem;font-weight:700;text-decoration:none;transition:all 0.2s;" onmouseover="this.style.background='rgba(168,85,247,0.2)'" onmouseout="this.style.background='rgba(168,85,247,0.1)'">
      <span>📄</span> Binder Placeholders — 16-Pocket
    </a>
  </div>
</div>`;

  // Insert before the card grid filter bar
  if (html.includes('class="filter-bar"')) {
    html = html.replace('<div class="filter-bar">', btnHtml + '\n    <div class="filter-bar">');
    return html;
  }
  return html;
}


// ── Fix section nav emojis ────────────────────────────────────────────────────
function fixSectionNav(html, name, short) {
  // Replace emoji nav buttons with clean professional text versions
  // These patterns cover both full and short (mobile) label variants
  const replacements = [
    // Home button
    [`<span class="nav-full">🏠 Home</span><span class="nav-short">🏠 Home</span>`,
     `<span class="nav-full">Home</span><span class="nav-short">Home</span>`],
    // Chase Cards
    [`<span class="nav-full">🔥 Chase Cards</span>`,
     `<span class="nav-full">Chase Cards</span>`],
    // Card List
    [`<span class="nav-full">📋 Card List</span>`,
     `<span class="nav-full">Card List</span>`],
    // Sealed Products
    [`<span class="nav-full">🛒 Sealed Products</span>`,
     `<span class="nav-full">Sealed Products</span>`],
    // Sets dropdown
    [`<span class="nav-full">📦 Sets ▾</span>`,
     `<span class="nav-full">Sets ▾</span>`],
    // Short labels
    [`<span class="nav-short">Chase</span>`, `<span class="nav-short">Chase</span>`],
    [`<span class="nav-short">Cards</span>`, `<span class="nav-short">Cards</span>`],
    [`<span class="nav-short">Sealed</span>`, `<span class="nav-short">Sealed</span>`],
    [`<span class="nav-short">Sets ▾</span>`, `<span class="nav-short">Sets ▾</span>`],
    // Hero badge — replace emoji with clean text
    [`<span style="color:var(--accent-amber)">★</span>\n          <span>Complete Set Guide</span>`,
     `<span>Complete Set Guide</span>`],
    [`<span style="color:var(--accent-amber)">★</span>\n          <span>Complete Set Guide</span>`,
     `<span>Complete Set Guide</span>`],
    // Discord CTA badge
    [`<span style="color:var(--accent-amber)">⚡</span>\n      <span>Never miss a restock</span>`,
     `<span>Never miss a restock</span>`],
  ];

  for (const [from, to] of replacements) {
    if (from !== to) html = html.replaceAll(from, to);
  }
  return html;
}


// ── Inject editorial content into top-chase-cards.html pages ─────────────────
function injectChaseEditorial(html, cards, name, seriesSlug, urlSlug) {
  if (html.includes('class="editorial"')) return html; // already injected
  const isMostValuable = html.includes('/most-valuable"') || html.includes('Most Valuable');

  const SECRET = new Set([
    'Illustration Rare','Art Rare','Special Illustration Rare','Ultra Rare',
    'Hyper Rare','Mega Hyper Rare','Mega Attack Rare','Black White Rare','Treasure Rare',
  ]);
  const norm = r => (r||'').split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');

  const chaseCards = cards
    .filter(c => SECRET.has(norm(c.rarity||'')))
    .sort((a,b) => parseInt(a.localId)-parseInt(b.localId));

  const total = chaseCards.length;
  const topCard = chaseCards[chaseCards.length - 1]; // highest number = MHR/HR usually
  // Better: sort by rarity tier for top card
  const RARITY_TIER = {
    'Mega Hyper Rare':0,'Hyper Rare':1,'Special Illustration Rare':2,
    'Black White Rare':2,'Ultra Rare':3,'Illustration Rare':4,'Art Rare':4,
  };
  const sorted = [...chaseCards].sort((a,b) =>
    (RARITY_TIER[norm(a.rarity)]??99) - (RARITY_TIER[norm(b.rarity)]??99)
  );
  const top1 = sorted[0];
  const top2 = sorted[1];

  if (!top1) return html;

  const cardListUrl = `https://tcgwatchtower.com/pokemon/sets/${seriesSlug}/${urlSlug}/cards`;

  const intro = isMostValuable
    ? `The most valuable ${name} cards ranked by live market price — ${top1.name}${top2 ? ` and ${top2.name}` : ''} lead as the top pulls. Prices updated daily.`
    : `${name} has ${total} chase cards — ${top1.name}${top2 ? ` and ${top2.name}` : ''} lead as the top pulls. All ${total} cards are ranked below by live market price, updated daily.`;

  const editorial = `
  <p class="editorial" style="max-width:720px;margin:0 auto 32px;font-size:0.95rem;color:rgba(226,232,240,0.8);line-height:1.7;text-align:center;">
    ${intro}
    Check live prices on TCG Watchtower or <a href="${cardListUrl}" style="color:#4ade80;text-decoration:none;">browse the full ${name} card list</a>.
  </p>`;

  // Inject after subtitle p tag and before cards-grid
  return html.replace(
    /(<p class="subtitle">.*?<\/p>\s*)/s,
    `$1${editorial}
  `
  );
}

const AMAZON_TAG = 'cehutto01-20';


// ── Patch Amazon links into existing chase/most-valuable pages ────────────────
function injectChasePageAmazon(html) {
  if (html.includes('btn-amazon')) return html; // already done
  // Add btn-amazon style after btn-ebay style
  html = html.replace(
    '.btn-ebay{background:#e43137;color:#fff}',
    '.btn-ebay{background:#e43137;color:#fff}\n.btn-amazon{background:#f90;color:#111}'
  );
  // Add Amazon button after every eBay button in buy-btns sections
  // Pattern: <a class="btn btn-ebay" href="...">eBay</a>\n        </div>
  html = html.replace(
    /(<a class="btn btn-ebay" href="([^"]+)"[^>]*>eBay<\/a>)\s*<\/div>/g,
    (match, ebayBtn, ebayUrl) => {
      // Derive Amazon search from eBay URL's _nkw param
      const nkwMatch = ebayUrl.match(/_nkw=([^&]+)/);
      const query = nkwMatch ? nkwMatch[1] : encodeURIComponent('Pokemon Card');
      const amazonUrl = `https://www.amazon.com/s?k=${query}&linkCode=ll2&tag=${AMAZON_TAG}&language=en_US`;
      return `${ebayBtn}\n          <a class="btn btn-amazon" href="${amazonUrl}" target="_blank" rel="noopener">Amazon</a>\n        </div>`;
    }
  );
  return html;
}


// ── Generate missing top-chase-cards / most-valuable pages ───────────────────
function generateChasePage({ pageUrl, pageTitle, pageDesc, h1, breadcrumbLabel,
                              cards, name, seriesSlug, urlSlug, setId, series, releaseDate }) {
  const SITE_URL = 'https://tcgwatchtower.com';
  const cardListUrl = `${SITE_URL}/pokemon/sets/${seriesSlug}/${urlSlug}/cards`;
  const seriesUrl   = `${SITE_URL}/pokemon/sets/${seriesSlug}`;

  const SECRET = new Set(['Illustration Rare','Art Rare','Special Illustration Rare','Ultra Rare',
    'Hyper Rare','Mega Hyper Rare','Mega Attack Rare','Black White Rare','Treasure Rare']);
  const norm = r => (r||'').split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');
  const RARITY_TIER  = {'Mega Hyper Rare':0,'Hyper Rare':1,'Special Illustration Rare':2,'Black White Rare':2,'Ultra Rare':3,'Illustration Rare':4,'Art Rare':4,'Mega Attack Rare':4};
  const RARITY_LABEL = {'Mega Hyper Rare':'MHR','Hyper Rare':'HR','Special Illustration Rare':'SIR','Black White Rare':'BWR','Ultra Rare':'UR','Illustration Rare':'IR','Art Rare':'AR','Mega Attack Rare':'MAR'};
  const CHASE_RARITIES = new Set(Object.keys(RARITY_TIER));

  const chaseCards = cards
    .filter(c => CHASE_RARITIES.has(norm(c.rarity||'')))
    .sort((a,b) => (RARITY_TIER[norm(a.rarity)]??99)-(RARITY_TIER[norm(b.rarity)]??99) || parseInt(a.localId)-parseInt(b.localId));

  const cardItems = chaseCards.map(c => {
    const r = norm(c.rarity||'');
    const rarityClass = (RARITY_TIER[r]<=1)?'rarity-hr':(RARITY_TIER[r]===2)?'rarity-sir':(RARITY_TIER[r]===3)?'rarity-ur':'rarity-ir';
    const label = RARITY_LABEL[r] || r;
    const img   = `https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev/cards/${setId}/${c.localId}.webp`;
    const slug  = c.name.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + c.localId;
    const tcgpSlug = urlSlug;
    const tcgpUrl  = `https://partner.tcgplayer.com/c/7068180/1830156/21018?u=${encodeURIComponent(`https://www.tcgplayer.com/search/pokemon/${tcgpSlug}?productLineName=pokemon&q=${encodeURIComponent(c.name)}&view=grid&Language=English&productTypeName=Cards`)}`;
    const ebayUrl  = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(c.name+' '+c.localId+' '+name+' Pokemon Card')}&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339145069&customid=&toolid=10001&mkevt=1`;
    const amazonUrl= `https://www.amazon.com/s?k=${encodeURIComponent(c.name+' '+name+' Pokemon Card')}&linkCode=ll2&tag=${AMAZON_TAG}&language=en_US`;
    return `
    <div class="card-item">
      <a href="/pokemon/sets/${seriesSlug}/${urlSlug}/cards/${slug}">
        <img src="${img}" alt="${c.name} ${c.localId} ${name} Pokemon Card" width="180" height="251" loading="lazy" onerror="this.style.background='#1e293b'">
      </a>
      <div class="card-info">
        <div class="card-name">${c.name}</div>
        <div class="card-num">#${c.localId}</div>
        <span class="card-rarity ${rarityClass}">${label}</span>
        <div class="card-price loading" data-local-id="${c.localId}">Loading...</div>
        <div class="buy-btns">
          <a class="btn btn-tcgp" href="${tcgpUrl}" target="_blank" rel="noopener">TCGplayer</a>
          <a class="btn btn-ebay" href="${ebayUrl}" target="_blank" rel="noopener">eBay</a>
          <a class="btn btn-amazon" href="${amazonUrl}" target="_blank" rel="noopener">Amazon</a>
        </div>
      </div>
    </div>`;
  }).join('');

  const top1 = chaseCards[0];
  const top2 = chaseCards[1];
  const editorial = top1 ? `
  <p class="editorial" style="max-width:720px;margin:0 auto 32px;font-size:0.95rem;color:rgba(226,232,240,0.8);line-height:1.7;text-align:center;">
    ${pageDesc} ${top1 ? `${top1.name}${top2?' and '+top2.name:''} lead as the top pulls.` : ''} Prices updated daily.
    <a href="${cardListUrl}" style="color:#4ade80;text-decoration:none;">Browse the full ${name} card list →</a>
  </p>` : '';

  const TCGP_GROUP = {'me05':'24688','me04':'24655','me03':'24519','me02':'24416','me01':'24290',
    'sv01':'23055','sv02':'23120','sv03':'23253','sv3pt5':'23364','sv04':'23440','sv4pt5':'23353',
    'sv05':'23567','sv06':'23714','sv6pt5':'23831','sv07':'23928','sv08':'24073','sv8pt5':'24131',
    'sv09':'24267','sv10':'24480','zsv10pt5':'24506','rsv10pt5':'24507','me02pt5':'24505'}[setId]||'';

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
{"@context":"https://schema.org","@type":"CollectionPage","name":"${pageTitle}","description":"${pageDesc}","url":"${pageUrl}","breadcrumb":{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${SITE_URL}"},{"@type":"ListItem","position":2,"name":"Pokémon TCG","item":"${SITE_URL}/pokemon"},{"@type":"ListItem","position":3,"name":"${series}","item":"${seriesUrl}"},{"@type":"ListItem","position":4,"name":"${name}","item":"${cardListUrl}"},{"@type":"ListItem","position":5,"name":"${breadcrumbLabel}","item":"${pageUrl}"}]}}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap"></noscript>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#263548;--border:#334155;--text:#f1f5f9;--text-muted:#94a3b8;--accent:#3b82f6}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 1.5rem;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px}
.nav-logo img{width:32px;height:32px;border-radius:8px;object-fit:cover}
.nav-logo span{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.05em}
.nav-back{color:var(--text-muted);font-size:0.85rem}
.nav-back:hover{color:var(--text)}
.breadcrumb{padding:0.75rem 1.5rem;font-size:0.8rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--border)}
.breadcrumb a:hover{color:var(--text)}
.breadcrumb span{opacity:0.5}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-family:'Bebas Neue',sans-serif;font-size:2.5rem;margin-bottom:0.5rem;letter-spacing:0.02em}
.subtitle{color:var(--text-muted);font-size:0.95rem;margin-bottom:2rem}
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
.card-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color 0.2s,transform 0.2s}
.card-item:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-item img{width:100%;aspect-ratio:245/337;object-fit:contain;background:var(--surface2)}
.card-info{padding:0.75rem}
.card-name{font-weight:600;font-size:0.85rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-num{font-size:0.75rem;color:var(--text-muted);margin-bottom:4px}
.card-rarity{display:inline-block;padding:2px 8px;border-radius:99px;font-size:0.7rem;font-weight:700;margin-bottom:6px}
.rarity-hr{background:rgba(251,191,36,0.2);color:#fbbf24;border:1px solid rgba(251,191,36,0.4)}
.rarity-sir{background:rgba(168,85,247,0.2);color:#c084fc;border:1px solid rgba(168,85,247,0.4)}
.rarity-ur{background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4)}
.rarity-ir{background:rgba(251,191,36,0.15);color:#fde68a;border:1px solid rgba(251,191,36,0.3)}
.card-price{font-size:0.8rem;font-weight:700;color:#22c55e;margin-bottom:6px;min-height:1.1rem}
.card-price.loading{color:var(--text-muted);font-weight:400;font-style:italic}
.buy-btns{display:flex;gap:4px;flex-wrap:wrap}
.btn{flex:1;padding:5px 4px;border-radius:6px;font-size:0.7rem;font-weight:600;text-align:center;border:none;cursor:pointer;min-width:0}
.btn-tcgp{background:#1a6ef5;color:#fff}
.btn-ebay{background:#e43137;color:#fff}
.btn-amazon{background:#f90;color:#111}
.set-link{display:inline-flex;align-items:center;gap:6px;color:var(--accent);font-size:0.9rem;margin-top:1rem}
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
  <a href="${cardListUrl}" class="nav-back">← ${name} Card List</a>
</nav>
<div style="padding:3px 16px;text-align:center;font-size:.65rem;color:rgba(148,163,184,.4);letter-spacing:.02em;border-bottom:1px solid rgba(255,255,255,.04);">This site contains affiliate links for which we may be compensated.</div>
<div class="breadcrumb">
  <a href="/">Home</a><span>›</span>
  <a href="/pokemon">Pokémon TCG</a><span>›</span>
  <a href="${seriesUrl}">${series}</a><span>›</span>
  <a href="${cardListUrl}">${name}</a><span>›</span>
  <span>${breadcrumbLabel}</span>
</div>
<div class="container">
  <h1>${h1}</h1>
  <p class="subtitle">${chaseCards.length} cards ranked by market price — updated daily</p>
  ${editorial}
  <div class="cards-grid" id="cards-grid">
    ${cardItems}
  </div>
  <a href="${cardListUrl}" class="set-link">← View Full ${name} Card List</a>
</div>
<footer>
  <p>TCG Watchtower is not affiliated with Nintendo, Game Freak, or The Pokémon Company. All card images and names are property of their respective owners.</p>
</footer>
<script>
const TCGP_GROUP_ID = '${TCGP_GROUP}';
if (TCGP_GROUP_ID) {
  fetch('/api/tcgplayer-prices?groupId=' + TCGP_GROUP_ID)
    .then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return;
      const prices = data.prices || {};
      document.querySelectorAll('[data-local-id]').forEach(el => {
        const id = el.dataset.localId;
        const p  = prices[id.padStart(3,'0')] ?? prices[String(parseInt(id,10))];
        if (p != null) { el.textContent = '$' + p.toFixed(2); el.classList.remove('loading'); }
        else { el.textContent = ''; el.classList.remove('loading'); }
      });
    }).catch(() => {});
}
</script>
<script type="text/javascript">(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})('https://utt.impactcdn.com/P-A7068180-c39f-4b4a-817c-cfa976acce5d1.js','script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');</script>
</body>
</html>`;
}


// ── Patch Amazon into individual card pages ───────────────────────────────────
function patchCardPageAmazon(html, cardName, setName) {
  if (html.includes('class="btn btn-amazon"')) return html; // already done — check button not just CSS

  // Add CSS
  html = html.replace(
    '.btn-ebay{background:#e43137;color:#fff}',
    '.btn-ebay{background:#e43137;color:#fff}\n.btn-amazon{background:#f90;color:#111}'
  );

  // Add Amazon button after Find on eBay button
  const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(cardName + ' ' + setName + ' Pokemon Card')}&linkCode=ll2&tag=cehutto01-20&language=en_US`;
  html = html.replace(
    /(<a class="btn btn-ebay"[^>]*>\s*<span>Find on eBay<\/span><span>→<\/span>\s*<\/a>)/,
    `$1\n        <a class="btn btn-amazon" href="${amazonUrl}" target="_blank" rel="noopener">\n          <span>Find on Amazon</span><span>→</span>\n        </a>`
  );
  return html;
}


// ── Fix user-facing TCGplayer pricing attribution text ───────────────────────
function fixTCGPlayerText(html) {
  const REPLACEMENTS = [
    ['real-time secondary market prices from TCGplayer that update daily', 'live prices updated daily on TCG Watchtower'],
    ['real-time secondary market prices from TCGplayer', 'live prices on TCG Watchtower'],
    ['live market prices from TCGplayer updated daily', 'live prices updated daily on TCG Watchtower'],
    ['live market prices from TCGplayer', 'live prices on TCG Watchtower'],
    ['live TCGplayer prices updated daily', 'live prices updated daily on TCG Watchtower'],
    ['live TCGplayer prices', 'live prices on TCG Watchtower'],
    ['live pricing from TCGplayer', 'live prices on TCG Watchtower'],
    ['real-time prices from TCGplayer', 'live prices on TCG Watchtower'],
    ['daily updated prices from TCGplayer', 'live prices updated daily on TCG Watchtower'],
    ['daily updated market prices sourced from TCGplayer', 'live prices on TCG Watchtower'],
    ['prices sourced from TCGplayer via TCGCSV', 'prices on TCG Watchtower'],
    ['prices from TCGplayer updated daily', 'live prices updated daily on TCG Watchtower'],
    ['updated daily from TCGplayer', 'updated daily on TCG Watchtower'],
    ['from TCGplayer updated daily', 'updated daily on TCG Watchtower'],
    ['TCGplayer prices will be added', 'prices will be added'],
  ];
  const JS_MARKERS = ['fetch(', 'function ', 'loadTCG', 'console.', 'TCGP_GROUP',
    'const ', 'let ', 'var ', '//', 'async ', 'await ', '/api/tcgplayer',
    'tcgplayer.com', 'tcgplayerCard', 'tcgplayerAffiliate', 'partner.tcgplayer'];
  return html.split('\n').map(line => {
    if (JS_MARKERS.some(m => line.includes(m))) return line;
    for (const [old, replacement] of REPLACEMENTS) {
      if (line.includes(old)) line = line.split(old).join(replacement);
    }
    return line;
  }).join('\n');
}


// ── Add Amazon to chase slider buy-links ─────────────────────────────────────
function fixChaseSliderAmazon(html) {
  if (!html.includes('renderChaseCardsHTML')) return html;
  if (html.includes('buy-link buy-amazon')) return html;
  // Shorten TCGplayer label to TCGp so 3 buttons fit in card width
  html = html.replace('>TCGplayer</a>', '>TCGp</a>');
  // Fix buy-links CSS so 3 buttons fit cleanly — reduce padding + font, allow wrap
  // Fix buy-links CSS — handle both original and any previously patched version
  const BUY_LINKS_FINAL = '.buy-links { display:flex; gap:3px; margin-top:auto; padding-top:10px; flex-wrap:wrap; justify-content:center; }\n.buy-links .buy-link { flex:1; text-align:center; justify-content:center; min-width:0; max-width:66px; overflow:hidden; }';
  for (const old of [
    '.buy-links { display:flex; gap:6px; margin-top:auto; padding-top:12px; flex-wrap:wrap; justify-content:center; }\n.buy-links .buy-link { flex:1; text-align:center; justify-content:center; min-width:0; }',
    '.buy-links { display:flex; gap:4px; margin-top:auto; padding-top:10px; flex-wrap:wrap; justify-content:center; }\n.buy-links .buy-link { flex:1; text-align:center; justify-content:center; min-width:52px; }',
  ]) { if (html.includes(old)) html = html.split(old).join(BUY_LINKS_FINAL); }
  const BTN_FINAL = 'padding:3px 4px; border-radius:6px; font-size:0.6rem; font-weight:700; white-space:nowrap;';
  for (const old of [
    'padding:4px 7px; border-radius:6px; font-size:0.68rem; font-weight:700;',
    'padding:4px 5px; border-radius:6px; font-size:0.63rem; font-weight:700;',
  ]) { if (html.includes(old)) html = html.split(old).join(BTN_FINAL); }
  // The HTML file contains real \n and real " chars — match exactly what Node reads
  const OLD = 'class=\\"buy-links\\">\\n          <a class=\\"buy-link buy-ebay\\"';
  const NEW = 'class=\\"buy-links\\">\\n          <a class=\\"buy-link buy-amazon\\" href=\\"${amazonLink(c.searchName)}\\" target=\\"_blank\\" rel=\\"noopener\\" onclick=\\"event.stopPropagation()\\">Amazon</a>\\n          <a class=\\"buy-link buy-ebay\\"';
  // Try both escaped (as stored in file) and unescaped (as read by Node)
  if (html.includes(OLD)) return html.split(OLD).join(NEW);
  // Fallback: real newline + real quotes version
  const OLD2 = 'class=\"buy-links\">\n          <a class=\"buy-link buy-ebay\"';
  const NEW2 = 'class=\"buy-links\">\n          <a class=\"buy-link buy-amazon\" href=\"${amazonLink(c.searchName)}\" target=\"_blank\" rel=\"noopener\" onclick=\"event.stopPropagation()\">Amazon</a>\n          <a class=\"buy-link buy-ebay\"';
  if (html.includes(OLD2)) return html.split(OLD2).join(NEW2);
  return html;
}


// ── Fix modal buy links — add Amazon, ensure correct order ───────────────────
function fixModalLinks(html) {
  if (html.includes('pl-amazon')) return html; // already done

  // Add Amazon as first button in modal-links, before eBay
  // Pattern: <div class="modal-links">

        <a class="modal-buy-link pl-ebay"
  html = html.replace(
    '<div class="modal-links">\n\n        <a class="modal-buy-link pl-ebay"',
    '<div class="modal-links">\n\n        <a class="modal-buy-link pl-amazon" href="${amazonLink(searchQuery)}" target="_blank" rel="noopener">\n          <span>🛒 Find on Amazon</span><span>→</span>\n        </a>\n        <a class="modal-buy-link pl-ebay"'
  );
  // Also handle variation without double newline
  html = html.replace(
    '<div class="modal-links">\n        <a class="modal-buy-link pl-ebay"',
    '<div class="modal-links">\n        <a class="modal-buy-link pl-amazon" href="${amazonLink(searchQuery)}" target="_blank" rel="noopener">\n          <span>🛒 Find on Amazon</span><span>→</span>\n        </a>\n        <a class="modal-buy-link pl-ebay"'
  );
  // Fix TCGplayer label — should always say "Find on TCGplayer" not just "TCGplayer"
  html = html.replace(
    "${directUrl ? 'TCGplayer' : '🔍 Find on TCGplayer'}",
    'Find on TCGplayer'
  );
  // Add pl-amazon CSS if not present
  if (!html.includes('.pl-amazon')) {
    html = html.replace(
      '.pl-tcgp { background:rgba(74,222,128,0.12); border:1px solid rgba(74,222,128,0.3); color:var(--accent-green); }',
      '.pl-amazon { background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.3); color:var(--accent-amber); }\n.pl-tcgp { background:rgba(74,222,128,0.12); border:1px solid rgba(74,222,128,0.3); color:var(--accent-green); }'
    );
  }
  return html;
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let passed = 0, skipped = 0, failed = 0;


// ── Master set hero injection ──────────────────────────────────────────────────
function injectMasterSetHero(html, cards, name, releaseDate, short) {
  const SECRET = new Set([
    'Illustration Rare','Art Rare','Special Illustration Rare','Ultra Rare',
    'Hyper Rare','Mega Hyper Rare','Mega Attack Rare','Black White Rare','Treasure Rare'
  ]);

  // Normalise rarity capitalisation
  const norm = r => (r||'').split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');

  const total      = cards.length;
  const secretCards = cards.filter(c => SECRET.has(norm(c.rarity||'')));
  const mainCards   = cards.filter(c => !SECRET.has(norm(c.rarity||'')));
  const rhCards     = mainCards; // reverse holos exist for all non-secret cards
  const masterTotal = total + rhCards.length;

  // releaseDate is 'Mar 2023' format — split directly, no Date parsing needed
  const relParts     = releaseDate ? releaseDate.split(' ') : [];
  const releaseMonth = relParts[0] || '';
  const releaseYear  = relParts[1] || '';

  // ── Master set paragraph (SEO text, injected after second set-desc) ──────
  const masterPara = `
<p class="set-desc set-master-desc" style="font-size:0.88rem;color:rgba(148,163,184,0.9);line-height:1.65;margin-top:0;margin-bottom:24px;border-left:2px solid rgba(74,222,128,0.4);padding-left:12px;">
  A complete ${name} master set contains <strong style="color:#e2e8f0;">${masterTotal} cards</strong> — ${total} main set and secret rare cards plus ${rhCards.length} reverse holos (one for each Common, Uncommon, Rare, and Double Rare). Secret rares do not have reverse holo variants.
</p>`;

  // ── Replace stat bubbles: 3 → 5 ──────────────────────────────────────────
  // Match the existing set-stats div and replace contents
  const newStats = `<div class="set-stats" style="grid-template-columns:repeat(5,1fr);">
          <div class="stat-card stat-card-logo">
            <img id="set-logo-hero" alt="${name} Logo" width="150" height="60" style="width: 100%; max-width: 150px; height: auto; object-fit: contain;">
            <div class="stat-label">${short || ''}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${mainCards.length}</div>
            <div class="stat-label">Main Set</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#fbbf24;">${secretCards.length}</div>
            <div class="stat-label">Secret Rares</div>
          </div>
          <div class="stat-card" style="background:rgba(74,222,128,0.08);border-color:rgba(74,222,128,0.2);">
            <div class="stat-value" style="color:#4ade80;">${masterTotal}</div>
            <div class="stat-label">Master Set</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${releaseMonth || 'TBD'}</div>
            <div class="stat-label">${releaseYear || 'Release'}</div>
          </div>
        </div>`;

  // Always replace set-stats div (handles 3-col original and 5-col updated)
  if (html.includes('<div class="set-stats"')) {
    // Match from <div class="set-stats" to the closing of the last stat-card </div></div>
    // Works for both 3-col and 5-col versions
    html = html.replace(
      /<div class="set-stats"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/,
      newStats
    );
    // Fallback for 3-col version (3 stat-cards = 3 inner divs)
    if (html.includes('<div class="set-stats">') || html.includes('<div class="set-stats" ')) {
      html = html.replace(
        /<div class="set-stats"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
        newStats
      );
    }
  }

  // Always refresh master paragraph (remove old one first, then re-inject)
  if (html.includes('set-master-desc')) {
    html = html.replace(/<p class="set-desc set-master-desc"[\s\S]*?<\/p>\s*/, '');
  }
  // Inject master paragraph just before set-stats
  const statsPos = html.indexOf('<div class="set-stats"');
  if (statsPos > 0) {
    html = html.slice(0, statsPos) + masterPara + '        ' + html.slice(statsPos);
  }

  return html;
}

for (const { setId, file, seriesSlug, urlSlug, name, series, short, releaseDate, totalCards, phase = 'en' } of SETS) {
  process.stdout.write(`${setId} (${file})... `);

  if (!existsSync(file)) {
    console.log(`⚠️  file not found — skipping`);
    skipped++;
    continue;
  }

  let html = readFileSync(file, 'utf8');
  let changes = [];

  // 1. Fetch card data (used for static table + master set hero)
  let cards = [];
  try {
    const res = await fetch(`${R2}/data/${setId}.json`);
    if (!res.ok) throw new Error(`R2 ${res.status}`);
    const json = await res.json();
    cards = json.cards || [];
  } catch (e) {
    changes.push(`R2 fetch FAILED: ${e.message}`);
  }

  // 1a. Static card table (only inject once)
  if (cards.length > 0 && !html.includes('SEO: static card list')) {
    const table = buildTable(cards, name, seriesSlug, urlSlug);
    html = html.replace('</body>', table + '\n</body>');
    changes.push(`${cards.length} cards`);
  }

  // 1b. Master set hero — always update (paragraph + expanded stat bubbles)
  if (cards.length > 0) {
    const htmlBefore = html;
    html = injectMasterSetHero(html, cards, name, releaseDate, short);
    if (html !== htmlBefore) changes.push('master set hero');
  }

  // 1d. Patch Amazon into individual card pages
  if (cards.length > 0 && phase !== 'jp') {
    const cardsDir = `pokemon/sets/${seriesSlug}/${urlSlug}/cards`;
    if (existsSync(cardsDir)) {
      const cardFiles = readdirSync(cardsDir).filter(f => f.endsWith('.html'));
      let cardPatched = 0;
      for (const cf of cardFiles) {
        const cfPath = `${cardsDir}/${cf}`;
        let cfHtml = readFileSync(cfPath, 'utf8');
        if (cfHtml.includes('btn-amazon')) continue;
        // Extract card name from title tag for Amazon search
        // Extract clean card name: title is "Card Name 123 Price, Rarity & Card Info | ..."
        // We want just "Card Name" without the number or extra text
        const titleMatch = cfHtml.match(/<title>([^|<]+)/);
        const rawTitle = titleMatch ? titleMatch[1].trim() : name;
        // Strip trailing number, rarity info etc — keep just the card name
        const cardName = rawTitle.replace(/\s+#?\d+.*$/, '').replace(/\s+\d+\s+Price.*$/, '').trim() || name;
        const patched = patchCardPageAmazon(cfHtml, cardName, name);
        if (patched !== cfHtml) {
          writeFileSync(cfPath, patched);
          cardPatched++;
        }
      }
      if (cardPatched > 0) changes.push(`${cardPatched} card pages`);
    }
  }

  // 1c. Chase/most-valuable pages — generate missing, patch existing (EN phase only)
  if (cards.length > 0 && phase !== 'jp') {
    const SITE_URL = 'https://tcgwatchtower.com';
    const cardListUrl = `${SITE_URL}/pokemon/sets/${seriesSlug}/${urlSlug}/cards`;

    const pageConfigs = [
      {
        file: `pokemon/sets/${seriesSlug}/${urlSlug}/top-chase-cards.html`,
        url:  `${SITE_URL}/pokemon/sets/${seriesSlug}/${urlSlug}/top-chase-cards`,
        title: `${name} Top Chase Cards | Best Pulls & Rare Cards | Pokémon TCG`,
        desc:  `The most valuable ${name} chase cards ranked by price — Illustration Rares, Special Illustration Rares, Hyper Rares and more. Prices updated daily.`,
        h1: `${name} Top Chase Cards`,
        label: 'Top Chase Cards',
        isChase: true,
      },
      {
        file: `pokemon/sets/${seriesSlug}/${urlSlug}/most-valuable.html`,
        url:  `${SITE_URL}/pokemon/sets/${seriesSlug}/${urlSlug}/most-valuable`,
        title: `Most Valuable ${name} Cards | Prices & Rankings | Pokémon TCG`,
        desc:  `The most valuable ${name} Pokémon cards ranked by price. See current market prices for all Hyper Rare, Special Illustration Rare, and Ultra Rare cards.`,
        h1: `Most Valuable ${name} Cards`,
        label: 'Most Valuable Cards',
        isChase: false,
      },
    ];

    for (const cfg of pageConfigs) {
      if (!existsSync(cfg.file)) {
        // Generate missing page from scratch
        const pageHtml = generateChasePage({
          pageUrl: cfg.url, pageTitle: cfg.title, pageDesc: cfg.desc,
          h1: cfg.h1, breadcrumbLabel: cfg.label,
          cards, name, seriesSlug, urlSlug, setId, series, releaseDate,
        });
        const pageDir = cfg.file.substring(0, cfg.file.lastIndexOf('/'));
        if (!existsSync(pageDir)) mkdirSync(pageDir, { recursive: true });
        writeFileSync(cfg.file, pageHtml);
        changes.push(`generated ${cfg.label}`);
      } else {
        // Patch existing page — add editorial + Amazon + fix TCGplayer text
        let pageHtml = readFileSync(cfg.file, 'utf8');
        const pageBefore = pageHtml;
        pageHtml = injectChaseEditorial(pageHtml, cards, name, seriesSlug, urlSlug);
        pageHtml = injectChasePageAmazon(pageHtml);
        pageHtml = fixTCGPlayerText(pageHtml);
        if (pageHtml !== pageBefore) {
          writeFileSync(cfg.file, pageHtml);
          changes.push(cfg.isChase ? 'chase page' : 'most-valuable page');
        }
      }
    }
  }

  // 1c. Section nav — strip emojis from nav buttons (unprofessional on authority site)
  const htmlBeforeNav = html;
  html = fixSectionNav(html, name, short);
  if (html !== htmlBeforeNav) changes.push('nav');

  // 1c-ii. Fix TCGplayer pricing attribution in user-facing text
  const htmlBeforeTCGP = html;
  html = fixTCGPlayerText(html);
  if (html !== htmlBeforeTCGP) changes.push('tcgp text');

  // 1c-iv. Fix modal buy links — add Amazon, fix TCGplayer label
  const htmlBeforeModal = html;
  html = fixModalLinks(html);
  if (html !== htmlBeforeModal) changes.push('modal links');

  // 1c-iii. Add Amazon to chase slider buy-links + shorten TCGplayer label
  const htmlBeforeChaseAmazon = html;
  html = fixChaseSliderAmazon(html);
  // Also shorten on pages that already had Amazon (e.g. me04)
  if (html.includes('buy-link buy-amazon') && html.includes('>TCGplayer</a>')) {
    html = html.replace(/>TCGplayer<\/a>/g, '>TCGp</a>');
  }
  if (html !== htmlBeforeChaseAmazon) changes.push('chase slider amazon');

  // 2. H1 fix
  if (html.includes(`<span class="gradient-text">${series}</span><br>${name}`)) {
    html = fixH1(html, name, series);
    changes.push('H1');
  }

  // 2b. Description text injection
  const htmlBeforeIntro = html;
  html = injectIntro(html, setId, name);
  if (html !== htmlBeforeIntro) changes.push('intro');

  // 2c. Download buttons injection
  const htmlBeforeDownload = html;
  html = injectDownloadButtons(html, setId, name);
  if (html !== htmlBeforeDownload) changes.push('download buttons');

  // 3. H2 emoji cleanup
  if (html.includes(`🔥 ${name}`) || html.includes(`📋 ${name}`) || html.includes(`🛒 Buy ${short}`)) {
    html = fixH2s(html, name, short);
    changes.push('H2s');
  }

  // 4. FAQ section + schema
  // Replace if: no FAQ yet, OR has generic FAQ and we have per-set specific data
  // Always rebuild FAQ fresh every run
  if (true) {
    const chaseUrl = `https://tcgwatchtower.com/pokemon/sets/${seriesSlug}/${urlSlug}/top-chase-cards`;
    const faqSection = buildFAQ(name, series, releaseDate, totalCards, setId, chaseUrl);
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








































