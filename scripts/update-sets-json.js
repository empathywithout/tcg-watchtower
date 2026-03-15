/**
 * update-sets-json.js
 * Upserts a set entry into sets.json.
 * Called automatically by the Generate Card Pages workflow.
 *
 * Required env vars:
 *   SET_ID          — e.g. me01
 *   SET_FULL_NAME   — e.g. Mega Evolution Base Set
 *   SET_SLUG        — e.g. mega-evolution-base-set
 *   SET_SERIES_SLUG — e.g. mega-evolution
 *   SET_SERIES      — e.g. Mega Evolution
 *
 * Optional env vars:
 *   SET_SHORT        — e.g. ME1  (falls back to uppercased SET_ID)
 *   SET_RELEASE_DATE — e.g. March 28, 2025
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SET_ID           = process.env.SET_ID;
const SET_FULL_NAME    = process.env.SET_FULL_NAME;
const SET_SLUG         = process.env.SET_SLUG;
const SET_SERIES_SLUG  = process.env.SET_SERIES_SLUG  || 'scarlet-violet';
const SET_SERIES       = process.env.SET_SERIES       || 'Scarlet & Violet';
const SET_SHORT        = process.env.SET_SHORT        || SET_ID?.toUpperCase() || '';
const SET_RELEASE_DATE = process.env.SET_RELEASE_DATE || '';

if (!SET_ID || !SET_FULL_NAME || !SET_SLUG) {
  console.error('Missing required: SET_ID, SET_FULL_NAME, SET_SLUG');
  process.exit(1);
}

// Legacy SV sets use old root-level slugs e.g. /stellar-crown-card-list
// New sets (me01+, future series) use canonical /pokemon/sets/{series}/{set}/cards
const LEGACY_SV_IDS = new Set([
  'sv01','sv02','sv03','sv3pt5','sv04','sv4pt5',
  'sv05','sv06','sv6pt5','sv07','sv08','sv8pt5','sv09','sv10',
]);

function buildSlug(setId, setSlug, seriesSlug) {
  if (LEGACY_SV_IDS.has(setId)) {
    // Legacy: keep the old root slug (e.g. "stellar-crown-card-list")
    // The workflow passes set_slug_full for these, but set_slug is the URL slug.
    // For legacy sets the full slug = set_slug + '-card-list' is already in sets.json,
    // so we just preserve what's already there if the entry exists.
    return null; // signal: preserve existing slug if present
  }
  // New sets: canonical path
  return `pokemon/sets/${seriesSlug}/${setSlug}/cards`;
}

const setsPath = path.join(ROOT, 'sets.json');
const sets = JSON.parse(fs.readFileSync(setsPath, 'utf8'));

// Check if this set already exists (match on setId)
const existingIndex = sets.findIndex(s => s.setId === SET_ID);

const newSlug = buildSlug(SET_ID, SET_SLUG, SET_SERIES_SLUG);

const entry = {
  // For legacy sets preserve the existing slug if the entry already exists,
  // otherwise use newSlug (which may be null — we handle that below)
  slug: existingIndex >= 0 && newSlug === null
    ? sets[existingIndex].slug
    : (newSlug || `pokemon/sets/${SET_SERIES_SLUG}/${SET_SLUG}/cards`),
  name:    SET_FULL_NAME,
  series:  SET_SERIES,
  short:   SET_SHORT,
  setId:   SET_ID,
  live:    true,
  ...(SET_RELEASE_DATE ? { releaseDate: SET_RELEASE_DATE } : {}),
};

if (existingIndex >= 0) {
  // Update in place — preserve slug for legacy sets
  sets[existingIndex] = { ...sets[existingIndex], ...entry };
  console.log(`✏️  Updated existing entry for ${SET_ID} (${SET_FULL_NAME})`);
} else {
  // Append new set
  sets.push(entry);
  console.log(`➕ Added new entry for ${SET_ID} (${SET_FULL_NAME})`);
}

fs.writeFileSync(setsPath, JSON.stringify(sets, null, 2));
console.log(`✅ sets.json updated — ${sets.length} total sets`);
console.log(`   slug: ${entry.slug}`);
console.log(`   series: ${entry.series}`);
