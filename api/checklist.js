// api/checklist.js
// GET /api/checklist?set=me05&type=master

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

const RARITY_ORDER = [
  'Common','Uncommon','Rare','Double Rare',
  'Illustration Rare','Art Rare',
  'Ultra Rare',
  'Special Illustration Rare','Black White Rare',
  'Hyper Rare','Mega Hyper Rare','Mega Attack Rare','Treasure Rare',
];

const SECRET_RARITIES = new Set([
  'Illustration Rare','Art Rare','Special Illustration Rare','Ultra Rare',
  'Hyper Rare','Mega Hyper Rare','Mega Attack Rare','Black White Rare','Treasure Rare',
]);

const RARITY_ABBREV = {
  'Common':'C','Uncommon':'U','Rare':'R','Double Rare':'DR',
  'Illustration Rare':'IR','Art Rare':'AR','Ultra Rare':'UR',
  'Special Illustration Rare':'SIR','Black White Rare':'BWR',
  'Hyper Rare':'HR','Mega Hyper Rare':'MHR','Mega Attack Rare':'MAR','Treasure Rare':'TR',
};

const RARITY_DESC = {
  'Common':                  'Circle symbol. ~6-7 per pack. Lowest rarity.',
  'Uncommon':                'Diamond symbol. ~2-3 per pack.',
  'Rare':                    '1 black star. 1 per pack. Holo or non-holo.',
  'Double Rare':             '2 black stars. Regular-art Pokemon ex. Guaranteed strong pull.',
  'Illustration Rare':       '1 gold star. Full-art alternate scene of a non-Rule Box Pokemon.',
  'Art Rare':                '1 gold star. Black Bolt / White Flare exclusive. Similar to IR.',
  'Ultra Rare':              '2 foil silver stars. Full-art textured Pokemon ex or Supporter.',
  'Special Illustration Rare': '2 gold stars. Premium story-scene full art. Top collector target.',
  'Black White Rare':        '2 gold stars. Black Bolt / White Flare exclusive. Similar to SIR.',
  'Hyper Rare':              '3 gold stars. Gold-bordered card. Rarer than SIR by pull rate.',
  'Mega Hyper Rare':         '1 gold star (black border). Gold-etched Mega ex. Mega Evolution era only. ~1 per 35 boxes.',
  'Mega Attack Rare':        'Pink & green stars. Pop-art attack illustrations. Introduced in Ascended Heroes.',
  'Treasure Rare':           'One Piece TCG exclusive rarity. Extremely rare.',
};

export default async function handler(req, res) {
  const { set, type } = req.query;
  if (!set) return res.status(400).json({ error: 'set parameter required' });

  const setName = SET_NAMES[set] || set;
  const master  = type === 'master';
  const today   = new Date().toISOString().split('T')[0];

  try {
    const r2Res = await fetch(`${R2_BASE}/data/${set}.json`);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const data  = await r2Res.json();
    const cards = data.cards || [];
    if (cards.length === 0) throw new Error('No cards found');

    const normalized = cards.map(c => ({
      ...c,
      rarity: normalizeRarity(c.rarity || ''),
    }));

    // Group by rarity in tier order
    const groups = {};
    for (const r of RARITY_ORDER) groups[r] = [];
    for (const card of normalized) {
      const r = card.rarity || 'Unknown';
      if (!groups[r]) groups[r] = [];
      groups[r].push(card);
    }
    // Sort each group by card number
    for (const r of Object.keys(groups)) {
      groups[r].sort((a, b) => naturalSort(a.localId, b.localId));
    }

    const rhCards = master ? normalized.filter(c => !SECRET_RARITIES.has(c.rarity)) : [];
    const totalCards = cards.length + (master ? rhCards.length : 0);

    const rows = [];
    const SEP = ''; // blank cell used as visual separator

    // Column layout: #(A) | Card Name(B) | Rarity(C) | Have(D) | Grade(E) | Notes(F)
    // Col widths driven by content — Name col has longest values forcing natural sizing

    // ── WIDTH HINT ROW (hidden row 1 — sets natural column widths) ────────────
    rows.push(['###', 'Card Name — Full Name Here          ', 'Rarity           ', 'Have', 'Grade (PSA/BGS/TAG)', 'Notes / Comments        ']);

    // ── HEADER ────────────────────────────────────────────────────────────────
    rows.push(['', '', '', '', '', '']);
    rows.push([`${setName}${master ? ' — Master Set Checklist' : ' — Card Checklist'}`, '', '', '', '', '']);
    rows.push([`Set: ${set.toUpperCase()}`, `${totalCards} total cards`, `Generated: ${today}`, '', '', '']);
    rows.push(['tcgwatchtower.com', 'Free to use and share', '', '', '', '']);
    rows.push(['', '', '', '', '', '']);
    rows.push(['HOW TO USE', '1. Mark Y in Have when you pull or buy a card', '', '', '', '']);
    rows.push(['', '2. Enter a grade (PSA 10 / BGS 9.5 / TAG 8) in the Grade column', '', '', '', '']);
    rows.push(['', '3. Use Notes for purchase price, seller, or condition details', '', '', '']);
    rows.push(['', '', '', '', '', '']);

    // ── RARITY LEGEND ─────────────────────────────────────────────────────────
    rows.push(['RARITY LEGEND', '', '', '', '', '']);
    rows.push(['Abbrev', 'Full Name', 'What It Means', '', '', '']);
    for (const r of RARITY_ORDER) {
      const abbrev = RARITY_ABBREV[r];
      const desc   = RARITY_DESC[r];
      if (abbrev) rows.push([abbrev, r, desc, '', '', '']);
    }
    rows.push(['RH', 'Reverse Holo', 'Foil on card border/background instead of artwork. Available for C / U / R / DR cards.', '', '', '']);
    rows.push(['', '', '', '', '', '']);

    // ── SET SUMMARY ───────────────────────────────────────────────────────────
    rows.push(['SET SUMMARY', '', '', '', '', '']);
    rows.push(['Rarity', 'Abbrev', 'Cards in Set', 'You Have', 'Still Need', '']);
    for (const r of RARITY_ORDER) {
      const group = groups[r];
      if (!group || group.length === 0) continue;
      rows.push([r, RARITY_ABBREV[r] || '', group.length, '', '', '']);
    }
    if (master && rhCards.length > 0) {
      rows.push(['Reverse Holos', 'RH', rhCards.length, '', '', '']);
    }
    rows.push(['TOTAL', '', totalCards, '', '', '']);
    rows.push(['', '', '', '', '', '']);

    // ── CARD LIST ─────────────────────────────────────────────────────────────
    rows.push(['CARD LIST', '', '', '', '', '']);

    for (const r of RARITY_ORDER) {
      const group = groups[r];
      if (!group || group.length === 0) continue;

      rows.push(['', '', '', '', '', '']);
      rows.push([`${r}  (${RARITY_ABBREV[r] || r})  —  ${group.length} card${group.length !== 1 ? 's' : ''}`, '', '', '', '', '']);
      rows.push(['#', 'Card Name', 'Rarity', 'Have (Y/N)', 'Grade (PSA/BGS/TAG)', 'Notes']);

      for (const card of group) {
        rows.push([
          padId(card.localId),
          card.name,
          RARITY_ABBREV[card.rarity] || card.rarity,
          '',
          '',
          '',
        ]);
      }
    }

    // ── REVERSE HOLOS ─────────────────────────────────────────────────────────
    if (master && rhCards.length > 0) {
      rows.push(['', '', '', '', '', '']);
      rows.push([`REVERSE HOLOS  (RH)  —  ${rhCards.length} cards`, '', '', '', '', '']);
      rows.push(['Foil versions of all C / U / R / DR cards in the set.', '', '', '', '', '']);
      rows.push(['#', 'Card Name', 'Base Rarity', 'Have (Y/N)', 'Grade (PSA/BGS/TAG)', 'Notes']);
      for (const card of rhCards.sort((a,b) => naturalSort(a.localId, b.localId))) {
        rows.push([
          `${padId(card.localId)} RH`,
          card.name,
          RARITY_ABBREV[card.rarity] || card.rarity,
          '',
          '',
          '',
        ]);
      }
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    rows.push(['', '', '', '', '', '']);
    rows.push(['TCG Watchtower', 'tcgwatchtower.com', 'Live prices  •  Restock alerts  •  Binder placeholders  •  Set guides', '', '', '']);
    rows.push(['Free to print and share.', 'Please credit TCG Watchtower if sharing online.', '', '', '', '']);

    // Encode CSV
    const csv = rows.map(row =>
      row.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    ).join('\r\n');

    const slug = setName.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g,'-');
    const filename = `${slug}-${master ? 'master-set-' : ''}checklist-tcgwatchtower.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send('\uFEFF' + csv);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function normalizeRarity(r) {
  return r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

function padId(id) {
  const n = parseInt(id, 10);
  return isNaN(n) ? id : String(n).padStart(3, '0');
}

function naturalSort(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}


