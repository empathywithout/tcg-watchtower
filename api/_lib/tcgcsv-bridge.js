// api/_lib/tcgcsv-bridge.js
//
// Shared bridge logic for JP-phase sets whose English release has already
// had its official reveal, but Scrydex's own English data hasn't caught up
// yet. TCGCSV (TCGplayer's public data mirror) routinely has real, confirmed
// card data (name, rarity, image, number) before Scrydex does.
//
// This is TCGCSV-primary + JP-Scrydex-fallback, keyed by card NUMBER (not
// name) -- TCGCSV is treated as authoritative for position once it exists
// for a given number, since English official numbering can differ from the
// JP source set's numbering (confirmed via real data: insertions/removals
// during localization shift secret-rare positions by +1/+2 for Pitch Black
// specifically). JP Scrydex only fills in numbers TCGCSV has nothing for --
// this is what makes early-lifecycle sets (JP just announced, TCGCSV empty)
// still show something useful, while late-lifecycle sets (TCGCSV complete,
// like Pitch Black 5 days before street date) get fully confirmed data with
// the fallback correctly unused.
//
// Verified against real live data (see scripts/diagnostic-me05-bridge-check.js):
// self-tested with synthetic mock data first (priority/fallback/dedup all
// correct), then run against real TCGCSV + Scrydex JP data for me05 --
// 120/120 cards, 0 duplicates, 0 needed from fallback (TCGCSV fully
// populated), all 3 English-only new cards correctly present.

const TCGCSV_CATEGORY_POKEMON = 3;

/**
 * Fetch TCGCSV's product list for a group ID. Returns raw product objects
 * (not yet merged) -- caller decides how to use them (this module also
 * exports mergeCards for the actual merge step).
 */
async function fetchTcgcsvProducts(groupId, category = TCGCSV_CATEGORY_POKEMON) {
  const res = await fetch(`https://tcgcsv.com/tcgplayer/${category}/${groupId}/products`, {
    headers: { 'User-Agent': 'TCGWatchtower/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TCGCSV products fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

/**
 * Filter TCGCSV products down to individual cards only (excludes sealed
 * product, which has no "Number" extendedData field).
 */
function filterCardProducts(products) {
  return products.filter(p => (p.extendedData || []).some(e => e.name === 'Number'));
}

/**
 * THE merge function. TCGCSV-primary, JP-fallback, keyed by zero-padded
 * card number string. jpScrydexCards should already be shaped as
 * { localId, name, rarity, image } (caller's responsibility to fetch and
 * shape Scrydex data appropriately for their own use of translation.en
 * fields etc. -- this module only handles the TCGCSV side and the merge).
 *
 * Returns { cards: [...], jpFallbackCount } -- cards sorted by localId.
 * Each card has { localId, name, rarity, image, source } where source is
 * 'tcgcsv' or 'jp-fallback', letting callers apply Option C confidence
 * markers (confirmed vs. estimate) per card.
 */
function mergeCards(tcgcsvCardProducts, jpScrydexCards) {
  const merged = {};
  const tcgcsvNames = new Set(); // for name-based dedup against JP fallback

  for (const p of tcgcsvCardProducts) {
    const numEntry = (p.extendedData || []).find(e => e.name === 'Number');
    if (!numEntry) continue;
    const numParts = numEntry.value.split('/');
    const num = numParts[0].trim().padStart(3, '0');
    const denominator = numParts[1] ? numParts[1].trim() : null; // e.g. "084" -- TCGplayer's real main-set-count denominator, previously discarded
    const rarEntry = (p.extendedData || []).find(e => e.name === 'Rarity');
    const cleanName = (p.name || '').replace(/\s*-\s*\d+\/\d+\s*$/, '').trim();
    merged[num] = {
      localId: num,
      name: cleanName,
      rarity: rarEntry?.value || '',
      image: p.imageUrl || null,
      productId: p.productId,
      denominator, // real TCGplayer main-set-count denominator, e.g. "084"
      source: 'tcgcsv',
    };
    tcgcsvNames.add(cleanName.toLowerCase());
  }

  let jpFallbackCount = 0;
  for (const c of jpScrydexCards || []) {
    const num = String(c.localId).padStart(3, '0');
    if (merged[num]) continue; // TCGCSV already authoritative for this position
    // CRITICAL: also skip if TCGCSV has this same card under ANY OTHER
    // number -- prevents the same physical card appearing twice when its
    // position shifted between JP and English AND TCGCSV has partial
    // (not yet complete) coverage. Caught via testing with a mock partial-
    // coverage scenario before this shipped -- did not show up against
    // me05's real data specifically because TCGCSV is already 100%
    // complete there, so this exact bug is dormant for today's target but
    // real for future, less-complete sets.
    if (tcgcsvNames.has((c.name || '').toLowerCase())) continue;
    merged[num] = { localId: num, name: c.name, rarity: c.rarity, image: c.image, source: 'jp-fallback' };
    jpFallbackCount++;
  }

  return {
    cards: Object.values(merged).sort((a, b) => a.localId.localeCompare(b.localId)),
    jpFallbackCount,
  };
}

export { fetchTcgcsvProducts, filterCardProducts, mergeCards, TCGCSV_CATEGORY_POKEMON };
