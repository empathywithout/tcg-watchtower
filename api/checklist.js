// api/checklist.js
// Generates a downloadable CSV checklist for a set
// GET /api/checklist?set=me05
// GET /api/checklist?set=me05&type=master  (includes reverse holo rows)

const R2_BASE = process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

const SET_NAMES = {
  'sv01':'Scarlet & Violet Base Set','sv02':'Paldea Evolved','sv03':'Obsidian Flames',
  'sv3pt5':'Pokemon 151','sv04':'Paradox Rift','sv4pt5':'Paldean Fates',
  'sv05':'Temporal Forces','sv06':'Twilight Masquerade','sv6pt5':'Shrouded Fable',
  'sv07':'Stellar Crown','sv08':'Surging Sparks','sv8pt5':'Prismatic Evolutions',
  'sv09':'Journey Together','sv10':'Destined Rivals',
  'zsv10pt5':'Black Bolt','rsv10pt5':'White Flare',
  'me01':'Mega Evolution','me02':'Phantasmal Flames','me02pt5':'Ascended Heroes',
  'me03':'Perfect Order','me04':'Chaos Rising','me05':'Pitch Black',
};

// Secret rare rarities — these don't get reverse holos
const SECRET_RARITIES = new Set([
  'Illustration Rare','Special Illustration Rare','Ultra Rare',
  'Hyper Rare','Mega Hyper Rare','Mega Ultra Rare','Black White Rare','Art Rare',
]);

export default async function handler(req, res) {
  const { set, type } = req.query;

  if (!set) {
    return res.status(400).json({ error: 'set parameter required' });
  }

  const setName = SET_NAMES[set] || set;
  const master = type === 'master';

  try {
    // Fetch card data from R2
    const r2Res = await fetch(`${R2_BASE}/data/${set}.json`);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const data = await r2Res.json();
    const cards = data.cards || [];

    if (cards.length === 0) throw new Error('No cards found');

    // Build CSV rows
    const rows = [];

    // Header
    rows.push(['#', 'Card Name', 'Rarity', 'Have', 'Notes']);

    // Main set cards
    for (const card of cards) {
      const rarity = normalizeRarity(card.rarity || '');
      rows.push([card.localId, card.name, rarity, '', '']);
    }

    // Reverse holos — same cards but only non-secret-rare ones
    if (master) {
      rows.push([]); // blank separator
      rows.push(['--- REVERSE HOLOS ---', '', '', '', '']);
      for (const card of cards) {
        const rarity = normalizeRarity(card.rarity || '');
        if (!SECRET_RARITIES.has(rarity) && rarity !== '') {
          rows.push([`${card.localId} RH`, card.name, `${rarity} (Reverse Holo)`, '', '']);
        }
      }
    }

    // Encode as CSV
    const csv = rows.map(row =>
      row.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    ).join('\r\n');

    const filename = master
      ? `${set}-master-set-checklist.csv`
      : `${set}-card-checklist.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function normalizeRarity(r) {
  return r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}
