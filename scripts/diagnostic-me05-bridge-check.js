// scripts/diagnostic-me05-bridge-check.js
//
// READ-ONLY diagnostic for Phase 1 of the me05 (Pitch Black) EN bridge plan.
// Makes NO changes to any file, NO writes to R2/Redis/production endpoints --
// purely fetches and compares data, printing a report.
//
// Answers three specific questions before any real code gets touched:
//   1. Is TCGP_GROUP_ID 24688 actually real and populated for this set?
//   2. For cards that exist in BOTH the JP source (Abyss Eye) and the
//      English release, does the card NUMBER stay the same, or shift?
//      (This is the single check that determines whether the portfolio-
//      safety concern is real or moot -- see prior conversation.)
//   3. How many of the 120 English cards does TCGCSV currently have
//      images for right now (confirmed by the user as "incomplete")?
//
// Run via: node scripts/diagnostic-me05-bridge-check.js
// Needs no env vars -- TCGCSV is a public, unauthenticated API.
// Must be run somewhere with real network access (GitHub Actions, or
// locally) -- this sandbox's network is restricted and cannot reach
// tcgcsv.com or api.scrydex.com directly.

import { mergeCards } from '../api/_lib/tcgcsv-bridge.js';

const TCGCSV_GROUP_ID = '24688';
const TCGCSV_CATEGORY = 3; // Pokemon
const SCRYDEX_JP_EXPANSION_ID = 'm5_ja'; // matches SCRYDEX_JP_ID_MAP['me05'] in production
const SCRYDEX_BASE = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

// A handful of KNOWN reference cards (from real, cross-checked sources
// this session) to manually verify the numbering question directly,
// rather than trusting any single secondary source. These are cards
// confirmed to exist in the JP source (Abyss Eye) AND in the English
// release, per PokeBeach/Bill's Archive coverage.
const REFERENCE_CARDS = [
  { name: 'Mega Darkrai ex', jpBasedNumber_SIR: 114, jpBasedNumber_MHR: 118 },
  { name: 'Mega Zeraora ex', jpBasedNumber_SIR: 112 },
  { name: 'Gwynn', jpBasedNumber_SIR: 117 },
];

// The 3 cards confirmed (via PokeBeach's official-reveal coverage) to be
// NEW additions -- these should NOT exist in the JP source Scrydex fetch
// at all, and are the clearest test of whether TCGCSV alone (not the JP
// source) is what surfaces them.
const KNOWN_NEW_ENGLISH_ONLY_CARDS = [
  { name: 'Mega Slowbro ex', expectedNumber: 31 },
  { name: 'Jett', expectedNumber: 79 },
  { name: 'Mega Delphox ex', expectedNumber: 8 },
];

/**
 * Fetch JP source card data from Scrydex (real pattern used in production).
 * Returns array of { localId, name, rarity, image } using Scrydex's own
 * translation.en fields as the JP-side name/rarity guess.
 */
async function fetchJpScrydexCards() {
  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    console.log('   (no SCRYDEX_API_KEY/TEAM_ID set -- skipping JP fetch, testing TCGCSV-only path)');
    return [];
  }
  let allCards = [], page = 1, total = null;
  while (true) {
    const res = await fetch(
      `${SCRYDEX_BASE}/ja/expansions/${SCRYDEX_JP_EXPANSION_ID}/cards?select=id,name,translation,rarity,images&pageSize=100&page=${page}`,
      { headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) { console.warn(`   Scrydex JP fetch failed: HTTP ${res.status}`); break; }
    const data = await res.json();
    const pageCards = data.data || [];
    if (total === null) total = data.totalCount || data.total || null;
    allCards = allCards.concat(pageCards);
    if (pageCards.length === 0 || pageCards.length < 100) break;
    if (total !== null && allCards.length >= total) break;
    page++;
  }
  return allCards.map(c => {
    const rawId = c.id ? c.id.split('-').slice(1).join('-') : '';
    const localId = rawId.includes('/') ? rawId.split('/')[0].trim() : rawId;
    const scrydexImage = c.images?.[0]?.small || c.images?.[0]?.medium || null;
    return {
      localId,
      name: c.translation?.en?.name || (c.name || '').trim(),
      rarity: c.translation?.en?.rarity || c.rarity || '',
      image: scrydexImage,
    };
  });
}


async function testMerge(cardProducts) {
  console.log(`\n=== Testing the actual merge function against real data ===`);
  const jpCards = await fetchJpScrydexCards();
  console.log(`   JP Scrydex cards fetched: ${jpCards.length}`);

  const { cards: mergedCards, jpFallbackCount } = mergeCards(cardProducts, jpCards);

  console.log(`\n   Merged result: ${mergedCards.length} total cards`);
  console.log(`   From TCGCSV (confirmed): ${mergedCards.filter(c => c.source === 'tcgcsv').length}`);
  console.log(`   From JP fallback (estimate): ${jpFallbackCount}`);

  const expectedTotal = 120;
  if (mergedCards.length === expectedTotal) {
    console.log(`   ✅ Matches expected total of ${expectedTotal}`);
  } else {
    console.log(`   ⚠️  Expected ${expectedTotal}, got ${mergedCards.length} -- investigate before trusting this merge`);
  }

  // Verify no duplicate localIds (a real risk if number-parsing has an edge case)
  const idCounts = {};
  mergedCards.forEach(c => { idCounts[c.localId] = (idCounts[c.localId] || 0) + 1; });
  const dupes = Object.entries(idCounts).filter(([, count]) => count > 1);
  if (dupes.length === 0) {
    console.log(`   ✅ No duplicate localIds`);
  } else {
    console.log(`   ⚠️  DUPLICATE localIds found: ${dupes.map(([id]) => id).join(', ')}`);
  }

  // Spot-check the 3 known new cards actually made it through the merge correctly
  console.log(`\n   Spot-check known new cards in merged output:`);
  for (const known of KNOWN_NEW_ENGLISH_ONLY_CARDS) {
    const found = mergedCards.find(c => c.name.toLowerCase() === known.name.toLowerCase());
    console.log(`   ${found ? '✅' : '❌'} ${known.name}: ${found ? `#${found.localId}, source=${found.source}` : 'MISSING from merged output'}`);
  }
}

async function main() {
  console.log(`=== Diagnostic check: TCGCSV group ${TCGCSV_GROUP_ID} ===\n`);

  let productsData;
  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY}/${TCGCSV_GROUP_ID}/products`, {
      headers: { 'User-Agent': 'TCGWatchtower-Diagnostic/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`❌ TCGCSV request failed: HTTP ${res.status}`);
      console.error(`   This means group ID ${TCGCSV_GROUP_ID} may be wrong, or TCGCSV is down.`);
      process.exit(1);
    }
    productsData = await res.json();
  } catch (e) {
    console.error(`❌ TCGCSV request threw: ${e.message}`);
    process.exit(1);
  }

  const products = productsData.results || [];
  console.log(`✅ Group ${TCGCSV_GROUP_ID} is real and responding.`);
  console.log(`   Total products (cards + sealed): ${products.length}\n`);

  // Separate individual cards (have a "Number" extendedData field) from
  // sealed product (booster boxes, ETBs, etc. -- no card number).
  const cardProducts = products.filter(p => (p.extendedData || []).some(e => e.name === 'Number'));
  const sealedProducts = products.filter(p => !(p.extendedData || []).some(e => e.name === 'Number'));
  console.log(`   Individual card products: ${cardProducts.length}`);
  console.log(`   Sealed products: ${sealedProducts.length}\n`);

  // ── Check 1: image completeness ──────────────────────────────────────
  const withImages = cardProducts.filter(p => p.imageUrl);
  console.log(`=== Image completeness ===`);
  console.log(`   ${withImages.length} of ${cardProducts.length} card products have an imageUrl`);
  console.log(`   (${((withImages.length / cardProducts.length) * 100).toFixed(1)}% populated)\n`);

  // ── Check 2: does TCGCSV data for known-new cards actually appear? ──
  console.log(`=== Checking for the 3 known English-only new cards ===`);
  for (const known of KNOWN_NEW_ENGLISH_ONLY_CARDS) {
    const match = cardProducts.find(p => {
      const cleanName = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').trim().toLowerCase();
      return cleanName === known.name.toLowerCase();
    });
    if (match) {
      const numEntry = (match.extendedData || []).find(e => e.name === 'Number');
      console.log(`   ✅ FOUND: ${known.name} -- TCGCSV number: ${numEntry?.value || '(none)'}, expected ~${known.expectedNumber}`);
    } else {
      console.log(`   ❌ NOT FOUND: ${known.name} (expected around #${known.expectedNumber}) -- TCGCSV may not have this card listed yet`);
    }
  }
  console.log();

  // ── Check 3: THE critical numbering-shift question ──────────────────
  console.log(`=== Checking whether overlapping cards' numbers SHIFTED between JP-based and TCGCSV ===`);
  console.log(`(This determines whether the portfolio-safety concern is real or moot)\n`);
  for (const ref of REFERENCE_CARDS) {
    const matches = cardProducts.filter(p => {
      const cleanName = (p.name || '').replace(/\s*\(.*?\)\s*$/, '').trim().toLowerCase();
      return cleanName === ref.name.toLowerCase();
    });
    if (matches.length === 0) {
      console.log(`   ⚠️  ${ref.name}: no TCGCSV match found at all yet`);
      continue;
    }
    console.log(`   ${ref.name}: found ${matches.length} product(s) in TCGCSV`);
    for (const m of matches) {
      const numEntry = (m.extendedData || []).find(e => e.name === 'Number');
      const rarEntry = (m.extendedData || []).find(e => e.name === 'Rarity');
      const tcgcsvNum = numEntry ? parseInt(numEntry.value.split('/')[0], 10) : null;
      console.log(`      TCGCSV number: ${tcgcsvNum ?? '?'}, rarity: ${rarEntry?.value || '?'}, product: ${m.name}`);

      // Compare against whichever JP-based reference number applies
      const jpRefs = Object.entries(ref).filter(([k]) => k.startsWith('jpBasedNumber'));
      for (const [label, jpNum] of jpRefs) {
        if (tcgcsvNum !== null) {
          const shifted = tcgcsvNum !== jpNum;
          console.log(`      vs current site's JP-based ${label}=${jpNum}: ${shifted ? `⚠️ SHIFTED (${jpNum} -> ${tcgcsvNum})` : '✅ same position'}`);
        }
      }
    }
    console.log();
  }

  console.log(`=== Summary ===`);
  console.log(`Review the numbering comparison above carefully. If ANY overlapping`);
  console.log(`card shows "SHIFTED", the merge logic (Phase 2) MUST remap existing`);
  console.log(`localIds correctly, not just enrich the current JP-based list --`);
  console.log(`and the portfolio-safety concern from the prior conversation is real,`);
  console.log(`not hypothetical, for that specific card.`);

  // ── Debug: raw partial-match dump for cards that found zero exact matches ──
  // If a reference card above showed "no TCGCSV match found", print every
  // product whose name PARTIALLY contains that card's name, so we can see
  // the real naming format TCGCSV actually uses (e.g. rarity suffixes,
  // dash-separated variant markers) instead of guessing.
  console.log(`\n=== Debug: raw partial-name matches for reference cards ===`);
  for (const ref of REFERENCE_CARDS) {
    const searchTerm = ref.name.toLowerCase();
    const partial = cardProducts.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
    console.log(`\n${ref.name}: ${partial.length} partial match(es)`);
    for (const p of partial) {
      const numEntry = (p.extendedData || []).find(e => e.name === 'Number');
      const rarEntry = (p.extendedData || []).find(e => e.name === 'Rarity');
      console.log(`   raw name: "${p.name}" | number: ${numEntry?.value || '?'} | rarity: ${rarEntry?.value || '?'}`);
    }
  }

  await testMerge(cardProducts);
}

main().catch(e => {
  console.error('Diagnostic script crashed:', e);
  process.exit(1);
});
