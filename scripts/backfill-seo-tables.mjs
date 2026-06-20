/**
 * backfill-seo-tables.mjs
 * Injects a visually-hidden static card table into every set HTML page
 * so Google can index all card names, numbers, and rarities as static HTML.
 * Safe to re-run — skips files that already have the table.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const R2 = process.env.CF_R2_PUBLIC_URL;
if (!R2) { console.error('❌ CF_R2_PUBLIC_URL not set'); process.exit(1); }

const SETS = [
  { setId: 'sv01',     file: 'scarlet-violet-base-set-card-list.html',  seriesSlug: 'scarlet-violet',  urlSlug: 'scarlet-violet-base-set',  name: 'Scarlet & Violet Base Set' },
  { setId: 'sv02',     file: 'paldea-evolved-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'paldea-evolved',           name: 'Paldea Evolved' },
  { setId: 'sv03',     file: 'obsidian-flames-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'obsidian-flames',          name: 'Obsidian Flames' },
  { setId: 'sv04',     file: 'paradox-rift-card-list.html',              seriesSlug: 'scarlet-violet',  urlSlug: 'paradox-rift',             name: 'Paradox Rift' },
  { setId: 'sv3pt5',   file: 'scarlet-violet-151-card-list.html',        seriesSlug: 'scarlet-violet',  urlSlug: '151',                      name: 'Scarlet & Violet 151' },
  { setId: 'sv4pt5',   file: 'paldean-fates-card-list.html',             seriesSlug: 'scarlet-violet',  urlSlug: 'paldean-fates',            name: 'Paldean Fates' },
  { setId: 'sv05',     file: 'temporal-forces-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'temporal-forces',          name: 'Temporal Forces' },
  { setId: 'sv06',     file: 'twilight-masquerade-card-list.html',       seriesSlug: 'scarlet-violet',  urlSlug: 'twilight-masquerade',      name: 'Twilight Masquerade' },
  { setId: 'sv6pt5',   file: 'shrouded-fable-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'shrouded-fable',           name: 'Shrouded Fable' },
  { setId: 'sv07',     file: 'stellar-crown-card-list.html',             seriesSlug: 'scarlet-violet',  urlSlug: 'stellar-crown',            name: 'Stellar Crown' },
  { setId: 'sv08',     file: 'surging-sparks-card-list.html',            seriesSlug: 'scarlet-violet',  urlSlug: 'surging-sparks',           name: 'Surging Sparks' },
  { setId: 'sv8pt5',   file: 'prismatic-evolutions-card-list.html',      seriesSlug: 'scarlet-violet',  urlSlug: 'prismatic-evolutions',     name: 'Prismatic Evolutions' },
  { setId: 'sv09',     file: 'journey-together-card-list.html',          seriesSlug: 'scarlet-violet',  urlSlug: 'journey-together',         name: 'Journey Together' },
  { setId: 'sv10',     file: 'destined-rivals-card-list.html',           seriesSlug: 'scarlet-violet',  urlSlug: 'destined-rivals',          name: 'Destined Rivals' },
  { setId: 'zsv10pt5', file: 'black-bolt-card-list.html',                seriesSlug: 'scarlet-violet',  urlSlug: 'black-bolt',               name: 'Black Bolt' },
  { setId: 'rsv10pt5', file: 'white-flare-card-list.html',               seriesSlug: 'scarlet-violet',  urlSlug: 'white-flare',              name: 'White Flare' },
  { setId: 'me01',     file: 'mega-evolution-base-set-card-list.html',   seriesSlug: 'mega-evolution',  urlSlug: 'base-set',                 name: 'Mega Evolution' },
  { setId: 'me02',     file: 'phantasmal-flames-card-list.html',         seriesSlug: 'mega-evolution',  urlSlug: 'phantasmal-flames',        name: 'Phantasmal Flames' },
  { setId: 'me02pt5',  file: 'ascended-heroes-card-list.html',           seriesSlug: 'mega-evolution',  urlSlug: 'ascended-heroes',          name: 'Ascended Heroes' },
  { setId: 'me03',     file: 'perfect-order-card-list.html',             seriesSlug: 'mega-evolution',  urlSlug: 'perfect-order',            name: 'Perfect Order' },
  { setId: 'me04',     file: 'chaos-rising-card-list.html',              seriesSlug: 'mega-evolution',  urlSlug: 'chaos-rising',             name: 'Chaos Rising' },
];

function toSlug(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildTable(cards, setName, seriesSlug, urlSlug) {
  const rows = cards.map(c => {
    const cardPath = `/pokemon/sets/${seriesSlug}/${urlSlug}/cards/${toSlug(c.name)}-${c.localId}`;
    return `<tr><td>${c.localId}</td><td><a href="${cardPath}">${c.name}</a></td><td>${c.rarity || ''}</td></tr>`;
  }).join('\n');

  return `
<!-- SEO: static card list for search engine indexing -->
<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0" aria-hidden="true">
<h2>${setName} Card List — All ${cards.length} Cards</h2>
<table>
<thead><tr><th>Number</th><th>Card Name</th><th>Rarity</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

let passed = 0, skipped = 0, failed = 0;

for (const { setId, file, seriesSlug, urlSlug, name } of SETS) {
  process.stdout.write(`${setId} (${file})... `);

  if (!existsSync(file)) {
    console.log(`⚠️  file not found — skipping`);
    skipped++;
    continue;
  }

  let html = readFileSync(file, 'utf8');

  if (html.includes('SEO: static card list')) {
    const existing = (html.match(/<tr><td>/g) || []).length;
    console.log(`✓ already has table (${existing} cards) — skipping`);
    skipped++;
    continue;
  }

  try {
    const res = await fetch(`${R2}/data/${setId}.json`);
    if (!res.ok) throw new Error(`R2 returned ${res.status}`);
    const json = await res.json();
    const cards = json.cards || [];

    if (cards.length === 0) {
      console.log(`⚠️  0 cards in R2 metadata — skipping`);
      skipped++;
      continue;
    }

    const table = buildTable(cards, name, seriesSlug, urlSlug);
    html = html.replace('</body>', table + '\n</body>');
    writeFileSync(file, html);
    console.log(`✓ ${cards.length} cards injected`);
    passed++;

  } catch (e) {
    console.log(`✗ FAILED: ${e.message}`);
    failed++;
  }
}

console.log(`\n✅ Done — ${passed} injected, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);
