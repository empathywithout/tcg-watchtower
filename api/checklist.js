// api/checklist.js
// GET /api/checklist?set=me05&type=master&format=xlsx
// GET /api/checklist?set=me05&type=master&format=csv
// Zero external dependencies — xlsx built with Node built-ins only

import { deflateRawSync } from 'zlib';

const R2_BASE  = process.env.CF_R2_PUBLIC_URL || 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

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

// Subtle rarity row colors (ARGB hex, no #)
const RARITY_COLOR = {
  'Common':'FFFFFFFF','Uncommon':'FFF0F4FF','Rare':'FFE8F5E9','Double Rare':'FFE3F2FD',
  'Illustration Rare':'FFFFF8E1','Art Rare':'FFFFF8E1','Ultra Rare':'FFFCE4EC',
  'Special Illustration Rare':'FFF3E5F5','Black White Rare':'FFF3E5F5',
  'Hyper Rare':'FFFFF3E0','Mega Hyper Rare':'FFFFE0B2','Mega Attack Rare':'FFF0FFF0','Treasure Rare':'FFE8EAF6',
};

const RARITY_DESC = {
  'Common':'Circle symbol. ~6-7 per pack. Most common pull.',
  'Uncommon':'Diamond symbol. ~2-3 per pack.',
  'Rare':'1 black star. Guaranteed 1 per pack. Holo or non-holo.',
  'Double Rare':'2 black stars. Regular-art Pokemon ex.',
  'Illustration Rare':'1 gold star. Full-art alternate scene of a non-Rule Box Pokemon.',
  'Art Rare':'1 gold star. Black Bolt / White Flare exclusive.',
  'Ultra Rare':'2 foil silver stars. Full-art textured Pokemon ex or Supporter.',
  'Special Illustration Rare':'2 gold stars. Premium story-scene full art. Top collector target.',
  'Black White Rare':'2 gold stars. Black Bolt / White Flare exclusive.',
  'Hyper Rare':'3 gold stars. Gold-bordered card.',
  'Mega Hyper Rare':'1 gold star (black border). Gold-etched Mega ex. Mega Evolution era only.',
  'Mega Attack Rare':'Pink & green stars. Pop-art attack illustrations. Introduced in Ascended Heroes.',
  'Treasure Rare':'One Piece TCG exclusive rarity.',
};

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
}

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

    const rhCards  = master ? cards.filter(c => !SECRET_RARITIES.has(c.rarity)) : [];
    const slug     = setName.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-');

    if (format === 'csv') {
      trackDownload(set, 'csv');
      const csv = buildCSV(setName, set, cards, groups, rhCards, master, today);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master ? 'master-set-' : ''}checklist.csv"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send('\uFEFF' + csv);
    }

    // XLSX — zero external deps
    trackDownload(set, 'xlsx');
    const xlsxBuf = buildXLSX(setName, set, cards, groups, rhCards, master, today);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master ? 'master-set-' : ''}checklist.xlsx"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(xlsxBuf);

  } catch (e) {
    console.error('[checklist]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── ZIP / xlsx builder ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

  const entries = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(Buffer.from(data), { level: 6 });
    const crc = crc32(Buffer.from(data));

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    entries.push({ nameBytes, crc, compressed, uncompLen: data.length, local, offset, dosDate, dosTime });
    offset += local.length + compressed.length;
  }

  const cdParts = entries.map(e => {
    const cd = Buffer.alloc(46 + e.nameBytes.length);
    cd.writeUInt32LE(0x02014B50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(e.dosTime, 12); cd.writeUInt16LE(e.dosDate, 14);
    cd.writeUInt32LE(e.crc, 16); cd.writeUInt32LE(e.compressed.length, 20); cd.writeUInt32LE(e.uncompLen, 24);
    cd.writeUInt16LE(e.nameBytes.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(e.offset, 42);
    e.nameBytes.copy(cd, 46);
    return cd;
  });

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...entries.flatMap(e => [e.local, e.compressed]), cdBuf, eocd]);
}

function buildXLSX(setName, setId, cards, groups, rhCards, master, today) {
  // Shared string table — collect all unique strings
  const sst = [];
  const sstMap = {};
  function si(s) {
    const str = String(s ?? '');
    if (sstMap[str] === undefined) { sstMap[str] = sst.length; sst.push(str); }
    return sstMap[str];
  }

  // Pre-register all strings
  const HDR_COLOR = '1A237E'; // dark blue header
  const SECTION_COLOR = 'E0E0E0';

  // Build sheet rows: [{cells: [{v, t, bold, bg, color, italic}]}]
  const rows = [];

  function addHeader(label, bg = HDR_COLOR) {
    rows.push({ type: 'header', cells: [
      { v: si(label), t:'s', bold:true, color:'FFFFFF', bg },
      { v: si(''), t:'s', bg }, { v: si(''), t:'s', bg },
      { v: si(''), t:'s', bg }, { v: si(''), t:'s', bg }, { v: si(''), t:'s', bg },
    ], merge: true });
  }

  function addColHeaders() {
    rows.push({ type: 'colheader', cells: [
      { v: si('#'),       t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR, center:true },
      { v: si('Card Name'), t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR },
      { v: si('Rarity'),  t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR, center:true },
      { v: si('Have ✓'), t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR, center:true },
      { v: si('Grade'),   t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR, center:true },
      { v: si('Notes'),   t:'s', bold:true, color:'FFFFFF', bg: HDR_COLOR },
    ]});
  }

  function addBlank() { rows.push({ cells: Array(6).fill({ v: si(''), t:'s' }) }); }

  // Title
  addHeader(`${setName}${master ? ' — Master Set Checklist' : ' — Checklist'}`);
  rows.push({ cells: [
    { v: si(`Set: ${setId.toUpperCase()}`), t:'s', color:'78909C' },
    { v: si(`${cards.length + (master ? rhCards.length : 0)} cards`), t:'s', color:'78909C' },
    { v: si(`Generated: ${today}`), t:'s', color:'78909C' },
    { v: si(''), t:'s' }, { v: si(''), t:'s' }, { v: si('tcgwatchtower.com'), t:'s', color:'1565C0', italic:true },
  ]});
  addBlank();

  // How to use
  rows.push({ cells: [{ v: si('HOW TO USE'), t:'s', bold:true }, { v: si(''), t:'s'}, { v: si(''), t:'s'}, { v: si(''), t:'s'}, { v: si(''), t:'s'}, { v: si(''), t:'s'}] });
  rows.push({ cells: [{ v: si('Have column:'), t:'s', bold:true, color:'455A64' }, { v: si('Y = have it  |  N = need it  |  W = wishlisted'), t:'s', color:'607D8B' }, ...Array(4).fill({v:si(''),t:'s'})] });
  rows.push({ cells: [{ v: si('Grade column:'), t:'s', bold:true, color:'455A64' }, { v: si('PSA 10 / PSA 9 / BGS 9.5 / TAG 8 / Raw — pick from dropdown'), t:'s', color:'607D8B' }, ...Array(4).fill({v:si(''),t:'s'})] });
  addBlank();

  // Card list
  addColHeaders();

  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group || group.length === 0) continue;

    addBlank();
    // Section header
    rows.push({ type:'section', cells: [
      { v: si(`${rarity}  (${RARITY_ABBREV[rarity] || rarity})  —  ${group.length} card${group.length !== 1 ? 's' : ''}`),
        t:'s', bold:true, color:'37474F', bg: SECTION_COLOR },
      ...Array(5).fill({ v: si(''), t:'s', bg: SECTION_COLOR }),
    ], merge: true });

    const rowBg = (RARITY_COLOR[rarity] || 'FFFFFFFF').slice(2); // strip FF alpha prefix
    for (const card of group) {
      rows.push({ rarity, cells: [
        { v: si(padId(card.localId)), t:'s', color:'607D8B', center:true, mono:true, bg: rowBg },
        { v: si(card.name),           t:'s', bg: rowBg },
        { v: si(RARITY_ABBREV[card.rarity] || card.rarity), t:'s', bold:true, color:'455A64', center:true, bg: rowBg },
        { v: si(''), t:'s', center:true, bg: rowBg, dropdown:'have' },
        { v: si(''), t:'s', center:true, bg: rowBg, dropdown:'grade' },
        { v: si(''), t:'s', bg: rowBg },
      ]});
    }
  }

  if (master && rhCards.length > 0) {
    addBlank();
    rows.push({ type:'section', cells: [
      { v: si(`Reverse Holos  (RH)  —  ${rhCards.length} cards`), t:'s', bold:true, color:'37474F', bg: SECTION_COLOR },
      ...Array(5).fill({ v: si(''), t:'s', bg: SECTION_COLOR }),
    ], merge: true });
    rows.push({ cells: [
      { v: si('Foil versions of all C / U / R / DR cards.'), t:'s', color:'78909C', italic:true },
      ...Array(5).fill({ v: si(''), t:'s' }),
    ]});
    addColHeaders();
    for (const card of rhCards.sort((a,b) => naturalSort(a.localId, b.localId))) {
      rows.push({ cells: [
        { v: si(padId(card.localId) + ' RH'), t:'s', color:'607D8B', center:true, mono:true, bg:'F9F9F9' },
        { v: si(card.name),  t:'s', bg:'F9F9F9' },
        { v: si('RH'),       t:'s', bold:true, color:'455A64', center:true, bg:'F9F9F9' },
        { v: si(''), t:'s', center:true, bg:'F9F9F9', dropdown:'have' },
        { v: si(''), t:'s', center:true, bg:'F9F9F9', dropdown:'grade' },
        { v: si(''), t:'s', bg:'F9F9F9' },
      ]});
    }
  }

  addBlank();
  rows.push({ cells: [
    { v: si('TCG Watchtower'), t:'s', bold:true, color:'1565C0' },
    { v: si('tcgwatchtower.com'), t:'s', color:'1565C0', italic:true },
    { v: si('Live prices  •  Restock alerts  •  Binder placeholders  •  Set guides'), t:'s', color:'78909C' },
    ...Array(3).fill({ v: si(''), t:'s' }),
  ]});

  // ── Build styles ──────────────────────────────────────────────────────────
  // Collect unique style combos
  const styleKeys = [];
  const styleMap = {};
  function getStyle(cell) {
    const key = JSON.stringify({ bold: !!cell.bold, color: cell.color||'', bg: cell.bg||'', center: !!cell.center, italic: !!cell.italic, mono: !!cell.mono });
    if (styleMap[key] === undefined) { styleMap[key] = styleKeys.length; styleKeys.push(JSON.parse(key)); }
    return styleMap[key];
  }

  // Assign style IDs
  for (const row of rows) {
    for (const cell of row.cells) cell.xf = getStyle(cell);
  }

  // Build styles XML
  const numFmts = '';
  const fonts = styleKeys.map(s => `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.mono ? '<name val="Courier New"/>' : '<name val="Calibri"/>'}${s.color ? `<color rgb="FF${s.color}"/>` : ''}<sz val="10"/></font>`);
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    ...styleKeys.map(s => s.bg ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg}"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>')
  ];
  const borders = '<border><left/><right/><top/><bottom/><diagonal/></border>';
  const xfs = styleKeys.map((s, i) =>
    `<xf numFmtId="0" fontId="${i}" fillId="${s.bg ? i + 2 : 0}" borderId="0" xfId="0"${s.center ? ' applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' : ' applyAlignment="1"><alignment vertical="center"/></xf>'}`
  );

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`;

  // ── Build sheet XML ───────────────────────────────────────────────────────
  const cols = `<cols><col min="1" max="1" width="7" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="4" width="11" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/><col min="6" max="6" width="24" customWidth="1"/></cols>`;

  const merges = [];
  const dvList = [];
  let rowXml = '';
  let dataRowStart = 0;
  let inDataSection = false;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rn = ri + 1;
    if (row.merge) merges.push(`<mergeCell ref="A${rn}:F${rn}"/>`);

    let cellXml = '';
    for (let ci = 0; ci < row.cells.length; ci++) {
      const cell = row.cells[ci];
      const colLetter = 'ABCDEF'[ci];
      const ref = `${colLetter}${rn}`;
      const s = cell.xf || 0;
      if (cell.t === 's') {
        cellXml += `<c r="${ref}" t="s" s="${s}"><v>${cell.v}</v></c>`;
      } else {
        cellXml += `<c r="${ref}" s="${s}"/>`;
      }

      // Data validations for have/grade dropdowns
      if (cell.dropdown === 'have') {
        dvList.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" sqref="${ref}"><formula1>"Y,N,W"</formula1></dataValidation>`);
      } else if (cell.dropdown === 'grade') {
        dvList.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" sqref="${ref}"><formula1>"PSA 10,PSA 9,PSA 8,BGS 9.5,BGS 9,TAG 8,TAG 7,Raw"</formula1></dataValidation>`);
      }
    }
    rowXml += `<row r="${rn}" ht="18" customHeight="1">${cellXml}</row>`;
  }

  // Freeze first row
  const sheetView = `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '';
  const dvXml    = dvList.length ? `<dataValidations count="${dvList.length}">${dvList.join('')}</dataValidations>` : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="18"/>${sheetView}${cols}<sheetData>${rowXml}</sheetData>${mergeXml}${dvXml}</worksheet>`;

  // ── Shared strings XML ────────────────────────────────────────────────────
  const sstXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;

  // ── Workbook ──────────────────────────────────────────────────────────────
  const wbXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Checklist" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  return buildZip([
    { name: '[Content_Types].xml',          data: contentTypes },
    { name: '_rels/.rels',                   data: pkgRels },
    { name: 'xl/workbook.xml',              data: wbXml },
    { name: 'xl/_rels/workbook.xml.rels',   data: wbRels },
    { name: 'xl/worksheets/sheet1.xml',     data: sheetXml },
    { name: 'xl/sharedStrings.xml',         data: sstXml },
    { name: 'xl/styles.xml',               data: stylesXml },
  ]);
}

// ── CSV builder ───────────────────────────────────────────────────────────────
function buildCSV(setName, setId, cards, groups, rhCards, master, today) {
  const totalCards = cards.length + (master ? rhCards.length : 0);
  const rows = [];
  rows.push(['###', 'Card Name — Full Name Here                ', 'Rarity    ', 'Have', 'Grade (PSA/BGS/TAG)', 'Notes / Comments        ']);
  rows.push([`${setName}${master ? ' — Master Set Checklist' : ' — Checklist'}`, '', '', '', '', '']);
  rows.push([`Set: ${setId.toUpperCase()}`, `${totalCards} total cards`, `Generated: ${today}`, '', '', '']);
  rows.push(['tcgwatchtower.com', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['RARITY LEGEND', '', '', '', '', '']);
  rows.push(['Abbrev', 'Full Name', 'What It Means', '', '', '']);
  for (const r of RARITY_ORDER) {
    if (RARITY_ABBREV[r]) rows.push([RARITY_ABBREV[r], r, RARITY_DESC[r] || '', '', '', '']);
  }
  rows.push(['RH', 'Reverse Holo', 'Foil on card border/background. Available for C/U/R/DR cards.', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['CARD LIST', '', '', '', '', '']);
  rows.push(['Have: Y = have it  |  N = need it  |  W = wishlisted', '', '', '', '', '']);
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
    for (const card of rhCards.sort((a,b) => naturalSort(a.localId, b.localId))) {
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

function xmlEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
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
