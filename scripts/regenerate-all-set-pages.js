// scripts/regenerate-all-set-pages.js
//
// Regenerates EVERY Pokemon set's page (not One Piece -- different generator)
// by looping through sets.json and invoking generate-set-page.js once per
// set as a child process, then committing everything together in one commit.
//
// This exists specifically to fix staleness: editing generate-set-page.js or
// set-template.html does NOT retroactively update already-generated static
// HTML files. Each set's page needs to be actually regenerated to pick up
// changes -- this automates that across all sets instead of 22 manual runs.
//
// Usage:
//   node scripts/regenerate-all-set-pages.js --dry-run   (just print what
//     would run, don't actually generate anything -- verify derived values
//     look right first, especially SET_URL_SLUG given inconsistent slug
//     formats in sets.json)
//   node scripts/regenerate-all-set-pages.js             (actually run)
//
// Required env vars (same as generate-set-page.js expects):
//   CF_R2_PUBLIC_URL, CF_R2_ENDPOINT, CF_R2_ACCESS_KEY, CF_R2_SECRET_KEY,
//   CF_R2_BUCKET, SCRYDEX_API_KEY, SCRYDEX_TEAM_ID

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');

// Mirrors SCRYDEX_JP_ID_MAP in api/scrydex-cards.js -- needed here too since
// sets.json doesn't carry the Scrydex JP expansion ID directly.
const SCRYDEX_JP_ID_MAP = {
  me01: 'me1', me02: 'me2', me02pt5: 'me2pt5', me03: 'm3_ja', me04: 'm4_ja', me05: 'm5_ja',
};

const SERIES_SLUG_MAP = {
  'Scarlet & Violet': 'scarlet-violet',
  'Mega Evolution': 'mega-evolution',
};

// Must match SET_URL_SLUG_MAP in generate-set-page.js exactly -- that map
// exists specifically because naive derivation gets these particular IDs
// wrong (e.g. sv01 would derive to "scarlet-violet-base-set", but the real
// live URL is "base-set"). Checked first, before any derivation fallback.
const SET_URL_SLUG_MAP = {
  sv01: 'base-set',
  me01: 'base-set',
};
// Confirmed against the real existing directory
// (pokemon/sets/scarlet-violet/151/cards): naive derivation produces
// "scarlet-violet-151" for both SET_URL_SLUG and this generator's own
// SET_SLUG (note: in THIS generator, "SET_SLUG" means the flat filename
// slug, e.g. "sv3pt5-card-list" -- opposite of what "SET_SLUG" means in
// generate-card-pages.js, where it's the URL segment. Confusing, but
// confirmed by reading each script's own default derivation directly).
// Real correct values: SET_URL_SLUG="151", SET_SLUG="scarlet-violet-151-card-list".
const SET_URL_SLUG_OVERRIDE = { sv3pt5: '151' };
const SET_SLUG_FILENAME_OVERRIDE = { sv3pt5: 'scarlet-violet-151-card-list' };

function deriveUrlSlug(set, seriesSlug) {
  if (SET_URL_SLUG_MAP[set.setId]) return SET_URL_SLUG_MAP[set.setId];

  const slug = set.slug || '';
  // Nested-path pattern, e.g. "pokemon/sets/mega-evolution/pitch-black/cards"
  // -- the URL slug is the segment right before the trailing "/cards".
  if (slug.includes('/cards')) {
    const parts = slug.split('/').filter(Boolean);
    const cardsIdx = parts.indexOf('cards');
    if (cardsIdx > 0) return parts[cardsIdx - 1];
  }
  // Flat pattern, e.g. "paldea-evolved-card-list" -- strip the suffix.
  if (slug.endsWith('-card-list')) {
    return slug.slice(0, -'-card-list'.length);
  }
  // Fall back to the generator's own SET_ID-based default by not passing
  // SET_URL_SLUG at all (leave it unset).
  return null;
}

const allSets = JSON.parse(readFileSync('sets.json', 'utf8'));
const pokemonSets = allSets.filter(s => s.series !== 'One Piece TCG');

console.log(`Found ${pokemonSets.length} Pokemon sets to regenerate (of ${allSets.length} total).\n`);

const plan = pokemonSets.map(set => {
  const seriesSlug = SERIES_SLUG_MAP[set.series] || set.series.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const urlSlug = deriveUrlSlug(set, seriesSlug);
  const env = {
    SET_ID: set.setId,
    SET_FULL_NAME: set.name,
    SET_SERIES: set.series,
    SET_SERIES_SLUG: seriesSlug,
    PHASE: set.phase || 'en',
  };
  const finalUrlSlug = SET_URL_SLUG_OVERRIDE[set.setId] || urlSlug;
  if (finalUrlSlug) env.SET_URL_SLUG = finalUrlSlug;
  if (SET_SLUG_FILENAME_OVERRIDE[set.setId]) env.SET_SLUG = SET_SLUG_FILENAME_OVERRIDE[set.setId];
  if (set.phase === 'jp' && SCRYDEX_JP_ID_MAP[set.setId]) {
    env.JP_SCRYDEX_ID = SCRYDEX_JP_ID_MAP[set.setId];
  }
  return { set, env };
});

for (const { set, env } of plan) {
  console.log(`${set.setId}: ${set.name}`);
  console.log(`  ${JSON.stringify(env)}`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Nothing was actually generated. Review the derived values above.');
  process.exit(0);
}

console.log('\nRunning for real...\n');
let successCount = 0;
let failCount = 0;

for (const { set, env } of plan) {
  console.log(`\n=== Generating ${set.setId} (${set.name}) ===`);
  try {
    execFileSync('node', ['scripts/generate-set-page.js'], {
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
