// api/checklist.js
// GET /api/checklist?set=me05&type=master&format=xlsx
// GET /api/checklist?set=me05&type=master&format=csv

const R2_BASE  = process.env.CF_R2_PUBLIC_URL
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function trackDownload(set, format) {
  if (!KV_URL || !KV_TOKEN) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    await Promise.all([
      fetch(`${KV_URL}/incr/downloads:checklist:${set}:${format}`, {
        method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
      }),
      fetch(`${KV_URL}/incr/downloads:daily:${today}`, {
        method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` },
      }),
    ]);
  } catch (e) {
    console.error('[checklist] tracking failed:', e.message);
  }
} || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

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
  'Illustration Rare','Art Rare','Ultra Rare',
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

// Rarity row background colors (subtle, readable)
const RARITY_COLORS = {
  'Common':                  'FFFFFF',
  'Uncommon':                'F0F4FF',
  'Rare':                    'E8F5E9',
  'Double Rare':             'E3F2FD',
  'Illustration Rare':       'FFF8E1',
  'Art Rare':                'FFF8E1',
  'Ultra Rare':              'FCE4EC',
  'Special Illustration Rare':'F3E5F5',
  'Black White Rare':        'F3E5F5',
  'Hyper Rare':              'FFF3E0',
  'Mega Hyper Rare':         'FFE0B2',
  'Mega Attack Rare':        'F0FFF0',
  'Treasure Rare':           'E8EAF6',
};

export default async function handler(req, res) {
  const { set, type, format = 'xlsx' } = req.query;
  if (!set) return res.status(400).json({ error: 'set parameter required' });

  const setName = SET_NAMES[set] || set;
  const master  = type === 'master';
  const today   = new Date().toISOString().split('T')[0];

  try {
    const r2Res = await fetch(`${R2_BASE}/data/${set}.json`);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const data  = await r2Res.json();
    const cards = (data.cards || []).map(c => ({
      ...c, rarity: normalizeRarity(c.rarity || ''),
    }));
    if (cards.length === 0) throw new Error('No cards found');

    const groups = {};
    for (const r of RARITY_ORDER) groups[r] = [];
    for (const card of cards) {
      const r = card.rarity || 'Unknown';
      if (!groups[r]) groups[r] = [];
      groups[r].push(card);
    }
    for (const r of Object.keys(groups)) {
      groups[r].sort((a, b) => naturalSort(a.localId, b.localId));
    }

    const rhCards = master ? cards.filter(c => !SECRET_RARITIES.has(c.rarity)) : [];
    const slug = setName.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-');

    if (format === 'csv') {
      const csv = buildCSV(setName, set, cards, groups, rhCards, master, today);
      // Track download (fire and forget)
    trackDownload(set, 'csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master ? 'master-set-' : ''}checklist.csv"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send('\uFEFF' + csv);
    }

    // XLSX
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TCG Watchtower';
    wb.created = new Date();

    await buildXLSX(wb, setName, set, cards, groups, rhCards, master, today, ExcelJS);

    const buffer = await wb.xlsx.writeBuffer();
    // Track download (fire and forget)
    trackDownload(set, 'xlsx');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master ? 'master-set-' : ''}checklist.xlsx"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(Buffer.from(buffer));

  } catch (e) {
    console.error('[checklist]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ── XLSX builder ──────────────────────────────────────────────────────────────
async function buildXLSX(wb, setName, setId, cards, groups, rhCards, master, today, ExcelJS) {
  const totalCards = cards.length + (master ? rhCards.length : 0);

  // ── Sheet 1: Checklist ────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Checklist', { views: [{ state: 'frozen', ySplit: 1 }] });

  // Column widths
  ws.columns = [
    { key: 'num',    width: 7  },  // A: #
    { key: 'name',   width: 32 },  // B: Card Name
    { key: 'rarity', width: 10 },  // C: Abbrev
    { key: 'have',   width: 10 },  // D: Have
    { key: 'grade',  width: 18 },  // E: Grade
    { key: 'notes',  width: 24 },  // F: Notes
  ];

  // Header row
  const headerRow = ws.addRow(['#', 'Card Name', 'Rarity', 'Have ✓', 'Grade', 'Notes']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF3949AB' } } };
  });
  headerRow.height = 22;

  let dataStartRow = 2;

  // Card rows grouped by rarity
  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group || group.length === 0) continue;

    // Rarity section header
    const sectionRow = ws.addRow([`${rarity} (${RARITY_ABBREV[rarity] || rarity}) — ${group.length} cards`]);
    ws.mergeCells(`A${sectionRow.number}:F${sectionRow.number}`);
    sectionRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF37474F' } };
    sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    sectionRow.getCell(1).alignment = { horizontal: 'left', indent: 1 };
    sectionRow.height = 18;

    const rowColor = RARITY_COLORS[rarity] || 'FFFFFF';

    for (const card of group) {
      const row = ws.addRow([
        padId(card.localId),
        card.name,
        RARITY_ABBREV[card.rarity] || card.rarity,
        '',   // Have
        '',   // Grade
        '',   // Notes
      ]);
      row.height = 18;

      // Row background
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rowColor } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
      });

      // Card number — mono
      row.getCell(1).font = { name: 'Courier New', size: 10, color: { argb: 'FF607D8B' } };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

      // Card name
      row.getCell(2).font = { size: 10 };

      // Rarity abbrev — centered
      row.getCell(3).font = { bold: true, size: 9, color: { argb: 'FF455A64' } };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };

      // Have column — dropdown Y/N/W (W = Wishlisted)
      const haveCell = row.getCell(4);
      haveCell.alignment = { horizontal: 'center', vertical: 'middle' };
      haveCell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Y,N,W"'],
        showDropDown: false,
        showErrorMessage: true,
        errorTitle: 'Invalid',
        error: 'Enter Y (have it), N (missing), or W (wishlisted)',
      };

      // Grade column — dropdown
      const gradeCell = row.getCell(5);
      gradeCell.alignment = { horizontal: 'center', vertical: 'middle' };
      gradeCell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"PSA 10,PSA 9,PSA 8,BGS 9.5,BGS 9,TAG 8,TAG 7,Raw"'],
        showDropDown: false,
      };

      // Notes
      row.getCell(6).font = { size: 9, color: { argb: 'FF78909C' } };
    }
  }

  // Reverse holos
  if (master && rhCards.length > 0) {
    ws.addRow([]);
    const rhHeader = ws.addRow([`Reverse Holos (RH) — ${rhCards.length} cards`]);
    ws.mergeCells(`A${rhHeader.number}:F${rhHeader.number}`);
    rhHeader.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF37474F' } };
    rhHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    rhHeader.getCell(1).alignment = { horizontal: 'left', indent: 1 };
    rhHeader.height = 18;

    for (const card of rhCards) {
      const row = ws.addRow([
        `${padId(card.localId)} RH`,
        card.name,
        'RH',
        '', '', '',
      ]);
      row.height = 18;
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
      });
      row.getCell(1).font = { name: 'Courier New', size: 10, color: { argb: 'FF607D8B' } };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).font = { bold: true, size: 9, color: { argb: 'FF455A64' } };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"Y,N,W"'], showDropDown: false,
      };
      row.getCell(5).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: ['"PSA 10,PSA 9,PSA 8,BGS 9.5,BGS 9,TAG 8,TAG 7,Raw"'], showDropDown: false,
      };
    }
  }

  // ── Sheet 2: Summary ──────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Summary');
  ws2.columns = [
    { width: 28 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 },
  ];

  // Title
  const titleRow = ws2.addRow([`${setName} — ${master ? 'Master Set ' : ''}Checklist`]);
  ws2.mergeCells(`A1:E1`);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1A237E' } };
  titleRow.getCell(1).alignment = { horizontal: 'center' };
  titleRow.height = 28;

  ws2.addRow([`Set: ${setId.toUpperCase()}   |   Generated: ${today}   |   tcgwatchtower.com`]);
  ws2.mergeCells(`A2:E2`);
  ws2.getRow(2).getCell(1).font = { size: 9, color: { argb: 'FF78909C' } };
  ws2.getRow(2).getCell(1).alignment = { horizontal: 'center' };
  ws2.addRow([]);

  // Summary header
  const sh = ws2.addRow(['Rarity', 'Abbrev', 'In Set', 'Have', 'Missing']);
  sh.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.alignment = { horizontal: 'center' };
  });

  let totalHave = 0;
  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group || group.length === 0) continue;
    const row = ws2.addRow([rarity, RARITY_ABBREV[rarity] || '', group.length, 0, group.length]);
    const rowColor = RARITY_COLORS[rarity] || 'FFFFFF';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rowColor } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
    });
    row.getCell(1).alignment = { horizontal: 'left', indent: 1 };
  }
  if (master && rhCards.length > 0) {
    const rhRow = ws2.addRow(['Reverse Holos', 'RH', rhCards.length, 0, rhCards.length]);
    rhRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      cell.alignment = { horizontal: 'center' };
    });
    rhRow.getCell(1).alignment = { horizontal: 'left', indent: 1 };
  }
  const totalRow = ws2.addRow(['TOTAL', '', totalCards, 0, totalCards]);
  totalRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
    cell.alignment = { horizontal: 'center' };
  });
  totalRow.getCell(1).alignment = { horizontal: 'left', indent: 1 };

  ws2.addRow([]);
  ws2.addRow(['HOW TO USE THE CHECKLIST TAB:']);
  ws2.getRow(ws2.lastRow.number).getCell(1).font = { bold: true, size: 10 };
  ws2.addRow(['→ In the Have column: select Y (have it), N (need it), or W (wishlisted)']);
  ws2.addRow(['→ In the Grade column: select your grade from the dropdown (PSA/BGS/TAG/Raw)']);
  ws2.addRow(['→ Use Notes for anything extra — purchase price, condition, seller etc.']);
  ws2.addRow([]);
  ws2.addRow(['→ Live prices for every card: tcgwatchtower.com']);
  ws2.getRow(ws2.lastRow.number).getCell(1).font = { color: { argb: 'FF1565C0' }, underline: true };

  // ── Sheet 3: Legend ───────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Rarity Legend');
  ws3.columns = [{ width: 8 }, { width: 26 }, { width: 60 }];

  const lh = ws3.addRow(['Abbrev', 'Rarity', 'What It Means']);
  lh.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.alignment = { horizontal: 'center' };
  });

  const RARITY_DESC = {
    'Common':                  'Circle symbol. Most common pull — ~6-7 per pack.',
    'Uncommon':                'Diamond symbol. ~2-3 per pack.',
    'Rare':                    '1 black star. Guaranteed 1 per pack. Holo or non-holo.',
    'Double Rare':             '2 black stars. Regular-art Pokemon ex. Scarlet & Violet era.',
    'Illustration Rare':       '1 gold star. Full-art alternate scene of a non-Rule Box Pokemon.',
    'Art Rare':                '1 gold star. Black Bolt / White Flare exclusive. Similar to IR.',
    'Ultra Rare':              '2 foil silver stars. Full-art textured Pokemon ex or Supporter.',
    'Special Illustration Rare': '2 gold stars. Premium story-scene full art. Top collector target.',
    'Black White Rare':        '2 gold stars. Black Bolt / White Flare exclusive. Similar to SIR.',
    'Hyper Rare':              '3 gold stars. Gold-bordered card. Very rare pull.',
    'Mega Hyper Rare':         '1 gold star (black border). Gold-etched Mega ex. ~1 per 35 boxes. Mega Evolution era only.',
    'Mega Attack Rare':        'Pink & green stars. Pop-art attack illustrations. Introduced in Ascended Heroes.',
    'Treasure Rare':           'One Piece TCG exclusive rarity. Extremely rare.',
  };

  for (const r of RARITY_ORDER) {
    const row = ws3.addRow([RARITY_ABBREV[r] || '', r, RARITY_DESC[r] || '']);
    const rowColor = RARITY_COLORS[r] || 'FFFFFF';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rowColor } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { bold: true, size: 10 };
    row.height = 20;
  }
  ws3.addRow(['RH', 'Reverse Holo', 'Foil on card border/background. Available for C / U / R / DR cards. Not a secret rare.']);
}

// ── CSV builder ───────────────────────────────────────────────────────────────
function buildCSV(setName, setId, cards, groups, rhCards, master, today) {
  const totalCards = cards.length + (master ? rhCards.length : 0);
  const rows = [];

  rows.push(['###', 'Card Name — Full Name Here                ', 'Rarity    ', 'Have', 'Grade (PSA/BGS/TAG)', 'Notes / Comments        ']);
  rows.push([`${setName}${master ? ' — Master Set Checklist' : ' — Card Checklist'}`, '', '', '', '', '']);
  rows.push([`Set: ${setId.toUpperCase()}`, `${totalCards} total cards`, `Generated: ${today}`, '', '', '']);
  rows.push(['tcgwatchtower.com', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['RARITY LEGEND', '', '', '', '', '']);
  rows.push(['Abbrev', 'Full Name', 'What It Means', '', '', '']);
  const RARITY_DESC = {
    'Common':'Circle symbol — ~6-7 per pack','Uncommon':'Diamond symbol — ~2-3 per pack',
    'Rare':'1 black star — 1 per pack','Double Rare':'2 black stars — Pokemon ex cards',
    'Illustration Rare':'1 gold star — full-art non-Rule Box Pokemon',
    'Art Rare':'1 gold star — Black Bolt/White Flare exclusive',
    'Ultra Rare':'2 foil silver stars — full-art textured Pokemon ex/Supporter',
    'Special Illustration Rare':'2 gold stars — premium story-scene full art',
    'Black White Rare':'2 gold stars — Black Bolt/White Flare exclusive',
    'Hyper Rare':'3 gold stars — gold-bordered card',
    'Mega Hyper Rare':'1 gold star (black border) — gold-etched Mega ex. Mega Evolution era only',
    'Mega Attack Rare':'Pink & green stars — pop-art attack illustrations. Introduced in Ascended Heroes',
    'Treasure Rare':'One Piece TCG exclusive rarity',
    'RH':'Reverse Holo — foil on border/background. Available for C/U/R/DR cards',
  };
  for (const r of RARITY_ORDER) {
    if (RARITY_ABBREV[r]) rows.push([RARITY_ABBREV[r], r, RARITY_DESC[r] || '', '', '', '']);
  }
  rows.push(['RH', 'Reverse Holo', RARITY_DESC['RH'], '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['CARD LIST', '', '', '', '', '']);
  rows.push(['Have options: Y = have it  |  N = need it  |  W = wishlisted', '', '', '', '', '']);

  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group || group.length === 0) continue;
    rows.push(['', '', '', '', '', '']);
    rows.push([`${rarity} (${RARITY_ABBREV[rarity] || rarity}) — ${group.length} cards`, '', '', '', '', '']);
    rows.push(['#', 'Card Name', 'Rarity', 'Have (Y/N/W)', 'Grade (PSA/BGS/TAG)', 'Notes']);
    for (const card of group) {
      rows.push([padId(card.localId), card.name, RARITY_ABBREV[card.rarity] || card.rarity, '', '', '']);
    }
  }

  if (master && rhCards.length > 0) {
    rows.push(['', '', '', '', '', '']);
    rows.push([`Reverse Holos (RH) — ${rhCards.length} cards`, '', '', '', '', '']);
    rows.push(['#', 'Card Name', 'Base Rarity', 'Have (Y/N/W)', 'Grade (PSA/BGS/TAG)', 'Notes']);
    for (const card of rhCards.sort((a, b) => naturalSort(a.localId, b.localId))) {
      rows.push([`${padId(card.localId)} RH`, card.name, RARITY_ABBREV[card.rarity] || card.rarity, '', '', '']);
    }
  }

  rows.push(['', '', '', '', '', '']);
  rows.push(['TCG Watchtower', 'tcgwatchtower.com', 'Live prices  •  Restock alerts  •  Binder placeholders', '', '', '']);

  return rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  ).join('\r\n');
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

