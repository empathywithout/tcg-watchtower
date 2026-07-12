// scripts/regenerate-all-card-pages.js
//
// Regenerates individual card pages for EVERY Pokemon set (not One Piece --
// different generator) by looping through sets.json and invoking
// generate-card-pages.js once per set as a child process.
//
// IMPORTANT SCALE NOTE: this generates thousands of individual HTML files
// across 22 sets (one page per card) -- expect this to take significantly
// longer than the set-page bulk regeneration (which only touches 22 files
// total, not thousands). Budget real time for a live run.
//
// Usage:
//   node scripts/regenerate-all-card-pages.js --dry-run
//   node scripts/regenerate-all-card-pages.js
//   node scripts/regenerate-all-card-pages.js --only=me05,sv10   (limit to
//     specific sets -- recommended for a first real test before running
//     all 22, given the scale)
//
// Required env vars (same as generate-card-pages.js expects):
//   CF_R2_PUBLIC_URL, CF_R2_ENDPOINT, CF_R2_ACCESS_KEY, CF_R2_SECRET_KEY,
//   CF_R2_BUCKET, SCRYDEX_API_KEY, SCRYDEX_TEAM_ID

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null;

// Same maps as regenerate-all-set-pages.js -- kept in sync manually since
// these mirror data that lives inside generate-set-page.js /
// generate-card-pages.js themselves, not a single shared source of truth.
const SCRYDEX_JP_ID_MAP = {
  me01: 'me1', me02: 'me2', me02pt5: 'me2pt5', me03: 'm3_ja', me04: 'm4_ja', me05: 'm5_ja',
};
const SERIES_SLUG_MAP = {
  'Scarlet & Violet': 'scarlet-violet',
  'Mega Evolution': 'mega-evolution',
};
// Verified against generate-set-page.js's own GROUP_ID_MAP as of this
// writing (including the me02pt5 typo fix and me05 -> '0' correction made
// earlier in this same session) -- keep these two in sync if that map
// changes again.
const GROUP_ID_MAP = {
  sv01: '22873', sv02: '23120', sv03: '23228', sv04: '23286',
  sv3pt5: '23237', sv4pt5: '23353', sv05: '23381', sv06: '23473',
  sv6pt5: '23529', sv07: '23537', sv08: '23651', sv8pt5: '23821',
  sv09: '24073', sv10: '24269',
  me01: '24380', me02: '24448', me02pt5: '24541', me03: '24587',
  me04: '24655', me05: '0', // JP-phase, no real English group ID yet
  zsv10pt5: '24325', rsv10pt5: '24326',
};
const SET_URL_SLUG_MAP = {
  sv01: 'base-set',
  me01: 'base-set',
};
// Confirmed via generate-card-pages.js's own safety guard (which exits
// with an error if SET_SLUG starts with SET_SERIES_SLUG + '-') that naive
// derivation is wrong for this specific set: it would produce
// "scarlet-violet-151", triggering that guard. The real correct SET_SLUG
// is "151" (verified against the actual existing directory
// pokemon/sets/scarlet-violet/151/cards), but SET_SLUG_FULL (the flat
// filename) is "scarlet-violet-151-card-list" -- doesn't auto-derive from
// the short SET_SLUG, so both need explicit overrides here.
const SET_SLUG_OVERRIDE = { sv3pt5: '151' };
const SET_SLUG_FULL_OVERRIDE = {
  sv3pt5: 'scarlet-violet-151-card-list',
  sv01: 'scarlet-violet-base-set-card-list',
  me01: 'mega-evolution-base-set-card-list',
};

function deriveUrlSlug(set) {
  if (SET_URL_SLUG_MAP[set.setId]) return SET_URL_SLUG_MAP[set.setId];
  const slug = set.slug || '';
  if (slug.includes('/cards')) {
    const parts = slug.split('/').filter(Boolean);
    const cardsIdx = parts.indexOf('cards');
    if (cardsIdx > 0) return parts[cardsIdx - 1];
  }
  if (slug.endsWith('-card-list')) return slug.slice(0, -'-card-list'.length);
  return null;
}

const allSets = JSON.parse(readFileSync('sets.json', 'utf8'));
let pokemonSets = allSets.filter(s => s.series !== 'One Piece TCG');
if (ONLY) pokemonSets = pokemonSets.filter(s => ONLY.has(s.setId));

console.log(`Found ${pokemonSets.length} Pokemon set(s) to regenerate card pages for.\n`);

const plan = pokemonSets.map(set => {
  const seriesSlug = SERIES_SLUG_MAP[set.series] || set.series.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const urlSlug = deriveUrlSlug(set);
  const groupId = GROUP_ID_MAP[set.setId] || '0';
  const env = {
    SET_ID: set.setId,
    SET_FULL_NAME: set.name,
    SET_SERIES: set.series,
    SET_SERIES_SLUG: seriesSlug,
    TCGP_GROUP_ID: groupId,
  };
  const finalUrlSlug = SET_SLUG_OVERRIDE[set.setId] || urlSlug;
  if (finalUrlSlug) env.SET_SLUG = finalUrlSlug;
  if (SET_SLUG_FULL_OVERRIDE[set.setId]) env.SET_SLUG_FULL = SET_SLUG_FULL_OVERRIDE[set.setId];
  if (set.phase === 'jp' && SCRYDEX_JP_ID_MAP[set.setId]) {
    env.PHASE = 'jp';
    env.JP_SCRYDEX_ID = SCRYDEX_JP_ID_MAP[set.setId];
  }
  return { set, env };
});

for (const { set, env } of plan) {
  console.log(`${set.setId}: ${set.name}`);
  console.log(`  ${JSON.stringify(env)}`);
  if (env.TCGP_GROUP_ID === '0') {
    console.log(`  ⚠️  TCGP_GROUP_ID is '0' (unconfirmed) -- prices will not be fetched for this set.`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Nothing was actually generated. Review the derived values above,');
  console.log('especially any set showing TCGP_GROUP_ID: "0" -- confirm that\'s actually correct');
  console.log('(expected for JP-phase sets with no English release yet) before a real run.');
  process.exit(0);
}

console.log('\nRunning for real -- this generates thousands of files, budget real time...\n');
let successCount = 0;
let failCount = 0;

for (const { set, env } of plan) {
  console.log(`\n=== Generating card pages for ${set.setId} (${set.name}) ===`);
  try {
    execFileSync('node', ['scripts/generate-card-pages.js'], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    successCount++;
  } catch (e) {
    console.error(`FAILED for ${set.setId}: ${e.message}`);
    failCount++;
  }
}

console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
