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
  // One Piece
  'op14':"The Azure Sea's Seven",'eb03':'Heroines Edition',
  'op15':"Adventure on Kami's Island",'op16':'The Time of Battle',
};

const SET_URL_PATHS = {
  'sv01': 'scarlet-violet/scarlet-violet-base-set',
  'sv02': 'scarlet-violet/paldea-evolved',
  'sv03': 'scarlet-violet/obsidian-flames',
  'sv3pt5': 'scarlet-violet/151',
  'sv04': 'scarlet-violet/paradox-rift',
  'sv4pt5': 'scarlet-violet/paldean-fates',
  'sv05': 'scarlet-violet/temporal-forces',
  'sv06': 'scarlet-violet/twilight-masquerade',
  'sv6pt5': 'scarlet-violet/shrouded-fable',
  'sv07': 'scarlet-violet/stellar-crown',
  'sv08': 'scarlet-violet/surging-sparks',
  'sv8pt5': 'scarlet-violet/prismatic-evolutions',
  'sv09': 'scarlet-violet/journey-together',
  'sv10': 'scarlet-violet/destined-rivals',
  'zsv10pt5': 'scarlet-violet/black-bolt',
  'rsv10pt5': 'scarlet-violet/white-flare',
  'me01': 'mega-evolution/mega-evolution',
  'me02': 'mega-evolution/phantasmal-flames',
  'me02pt5': 'mega-evolution/ascended-heroes',
  'me03': 'mega-evolution/perfect-order',
  'me04': 'mega-evolution/chaos-rising',
  'me05': 'mega-evolution/pitch-black'
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

const RARITY_DESC = {
  'Common':'Circle symbol. ~6-7 per pack.',
  'Uncommon':'Diamond symbol. ~2-3 per pack.',
  'Rare':'1 black star. 1 guaranteed per pack.',
  'Double Rare':'2 black stars. Regular-art Pokemon ex.',
  'Illustration Rare':'1 gold star. Full-art alternate scene, non-Rule Box Pokemon.',
  'Art Rare':'1 gold star. Black Bolt / White Flare exclusive.',
  'Ultra Rare':'2 foil silver stars. Full-art textured Pokemon ex or Supporter.',
  'Special Illustration Rare':'2 gold stars. Premium story-scene full art. Top collector target.',
  'Black White Rare':'2 gold stars. Black Bolt / White Flare exclusive.',
  'Hyper Rare':'3 gold stars. Gold-bordered card.',
  'Mega Hyper Rare':'1 gold star (black border). Gold-etched Mega ex. Mega Evolution era only.',
  'Mega Attack Rare':'Pink & green stars. Pop-art attack illustrations. Introduced in Ascended Heroes.',
  'Treasure Rare':'One Piece TCG exclusive rarity.',
};

// ── Fixed style index map ─────────────────────────────────────────────────────
// Excel requires fills[0]=none, fills[1]=gray125, then custom fills from index 2
// We define a fixed palette so indices are stable

// FONT indices
const F_DEFAULT  = 0;  // Calibri 11
const F_HEADER   = 1;  // Calibri 11 bold white
const F_SECTION  = 2;  // Calibri 10 bold dark
const F_CARD     = 3;  // Calibri 10 normal
const F_NUM      = 4;  // Courier New 10 muted
const F_MUTED    = 5;  // Calibri 10 muted grey
const F_LINK     = 6;  // Calibri 10 blue italic
const F_BOLD     = 7;  // Calibri 10 bold dark

// FILL indices (0 & 1 are reserved by Excel spec)
const FILL_NONE      = 0;
const FILL_GRAY125   = 1;
const FILL_HEADER    = 2;  // dark blue #1A237E
const FILL_SECTION   = 3;  // light grey #E0E0E0
const FILL_COMMON    = 4;  // white
const FILL_UNCOMMON  = 5;  // #F0F4FF
const FILL_RARE      = 6;  // #E8F5E9
const FILL_DR        = 7;  // #E3F2FD
const FILL_IR        = 8;  // #FFF8E1
const FILL_UR        = 9;  // #FCE4EC
const FILL_SIR       = 10; // #F3E5F5
const FILL_HR        = 11; // #FFF3E0
const FILL_MHR       = 12; // #FFE0B2
const FILL_MAR       = 13; // #F0FFF0
const FILL_TR        = 14; // #E8EAF6
const FILL_RH        = 15; // #F9F9F9

const RARITY_FILL = {
  'Common': FILL_COMMON, 'Uncommon': FILL_UNCOMMON,
  'Rare': FILL_RARE, 'Double Rare': FILL_DR,
  'Illustration Rare': FILL_IR, 'Art Rare': FILL_IR,
  'Ultra Rare': FILL_UR,
  'Special Illustration Rare': FILL_SIR, 'Black White Rare': FILL_SIR,
  'Hyper Rare': FILL_HR, 'Mega Hyper Rare': FILL_MHR,
  'Mega Attack Rare': FILL_MAR, 'Treasure Rare': FILL_TR,
};

// XF (cell format) indices — each is a combo of font + fill + alignment
const XF_DEFAULT    = 0;
const XF_HEADER     = 1;  // bold white on dark blue, center
const XF_HEADER_L   = 2;  // bold white on dark blue, left
const XF_SECTION    = 3;  // bold dark on grey, left
const XF_NUM        = 4;  // monospace muted, center — card number
const XF_CARD       = 5;  // normal, left
const XF_ABBREV     = 6;  // bold dark, center
const XF_BLANK      = 7;  // default, center (have/grade cells)
const XF_MUTED      = 8;  // muted, left (sub-labels)
const XF_LINK       = 9;  // blue italic, left
const XF_BOLD       = 10; // bold, left

// Rarity-tinted cell formats: card number, name, abbrev, blank for each rarity
// We'll generate them dynamically per row using inline style or just use a few base styles
// and skip per-rarity coloring to keep the style table manageable & valid
// (Excel has no issues with many xfs, just needs correct fill refs)

// Build rarity XF sets: for each fill we need num/card/abbrev/blank variants
// fillId offset from FILL_COMMON (4)
function rarityXf(fillId, type) {
  // Returns xf index for this rarity+type combo
  // Base XF count is 11 (XF_DEFAULT..XF_BOLD)
  // Then per-fill: 4 variants each
  // rarityXfBase = 11 + (fillId - FILL_COMMON) * 4 + typeOffset
  const base = 11;
  // fillId ranges from FILL_COMMON(4) to FILL_RH(15) — direct arithmetic, no lookup needed
  const fillIdx = (fillId >= FILL_COMMON && fillId <= FILL_RH) ? fillId - FILL_COMMON : -1;
  const typeOffset = { num:0, card:1, abbrev:2, blank:3 }[type] || 0;
  if (fillIdx < 0) return XF_CARD;
  return base + fillIdx * 4 + typeOffset;
}

const STYLES_XML = buildStylesXml();

function buildStylesXml() {
  const fonts = [
    `<font><sz val="11"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>`,
    `<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF37474F"/></font>`,
    `<font><sz val="10"/><name val="Calibri"/></font>`,
    `<font><sz val="10"/><name val="Courier New"/><color rgb="FF607D8B"/></font>`,
    `<font><sz val="10"/><name val="Calibri"/><color rgb="FF78909C"/></font>`,
    `<font><i/><sz val="10"/><name val="Calibri"/><color rgb="FF1565C0"/></font>`,
    `<font><b/><sz val="10"/><name val="Calibri"/></font>`,
  ];

  const fillDefs = [
    ['none', ''],
    ['gray125', ''],
    ['solid', 'FF1A237E'], // FILL_HEADER
    ['solid', 'FFE0E0E0'], // FILL_SECTION
    ['solid', 'FFFFFFFF'], // FILL_COMMON
    ['solid', 'FFF0F4FF'], // FILL_UNCOMMON
    ['solid', 'FFE8F5E9'], // FILL_RARE
    ['solid', 'FFE3F2FD'], // FILL_DR
    ['solid', 'FFFFF8E1'], // FILL_IR
    ['solid', 'FFFCE4EC'], // FILL_UR
    ['solid', 'FFF3E5F5'], // FILL_SIR
    ['solid', 'FFFFF3E0'], // FILL_HR
    ['solid', 'FFFFE0B2'], // FILL_MHR
    ['solid', 'FFF0FFF0'], // FILL_MAR
    ['solid', 'FFE8EAF6'], // FILL_TR
    ['solid', 'FFF9F9F9'], // FILL_RH
  ];

  const fills = fillDefs.map(([pat, color]) =>
    pat === 'none' ? `<fill><patternFill patternType="none"/></fill>` :
    pat === 'gray125' ? `<fill><patternFill patternType="gray125"/></fill>` :
    `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`
  );

  const border = `<border><left/><right/><top/><bottom/><diagonal/></border>`;

  // Build xf list
  const xfs = [];
  const xf = (fontId, fillId, center=false, left=false) =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="${center?'center':left?'left':'general'}" vertical="center"/></xf>`;

  // Fixed XFs 0-10
  xfs.push(xf(F_DEFAULT, FILL_NONE));         // 0 default
  xfs.push(xf(F_HEADER,  FILL_HEADER, true)); // 1 header center
  xfs.push(xf(F_HEADER,  FILL_HEADER, false, true)); // 2 header left
  xfs.push(xf(F_SECTION, FILL_SECTION, false, true)); // 3 section
  xfs.push(xf(F_NUM,     FILL_NONE, true));   // 4 card# (no fill, added per row)
  xfs.push(xf(F_CARD,    FILL_NONE, false, true)); // 5 card name
  xfs.push(xf(F_BOLD,    FILL_NONE, true));   // 6 abbrev center
  xfs.push(xf(F_DEFAULT, FILL_NONE, true));   // 7 blank center
  xfs.push(xf(F_MUTED,   FILL_NONE, false, true)); // 8 muted left
  xfs.push(xf(F_LINK,    FILL_NONE, false, true)); // 9 link
  xfs.push(xf(F_BOLD,    FILL_NONE, false, true)); // 10 bold left

  // Per-rarity XFs (fillId 4..15, 4 variants each = 48 more)
  for (let fillId = FILL_COMMON; fillId <= FILL_RH; fillId++) {
    xfs.push(xf(F_NUM,     fillId, true));        // num
    xfs.push(xf(F_CARD,    fillId, false, true)); // card name
    xfs.push(xf(F_BOLD, fillId, true)); // abbrev
    xfs.push(xf(F_DEFAULT, fillId, true));        // blank
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${fonts.length}">${fonts.join('')}</fonts>
  <fills count="${fills.length}">${fills.join('')}</fills>
  <borders count="1">${border}</borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
</styleSheet>`;
}

async function trackDownload(set, format) {
  if (!KV_URL || !KV_TOKEN) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    await Promise.all([
      fetch(`${KV_URL}/incr/downloads:checklist:${set}:${format}`, { method:'POST', headers:{Authorization:`Bearer ${KV_TOKEN}`} }),
      fetch(`${KV_URL}/incr/downloads:daily:${today}`,             { method:'POST', headers:{Authorization:`Bearer ${KV_TOKEN}`} }),
    ]);
  } catch {}
}

export default async function handler(req, res) {
  const { set, type, format = 'xlsx', game = '' } = req.query;
  if (!set) return res.status(400).json({ error: 'set parameter required' });

  const isOnePiece = game === 'onepiece' || /^(op|eb|st)\d+/.test(set);
  const setName = SET_NAMES[set] || set;
  const master  = type === 'master';
  const today   = new Date().toISOString().split('T')[0];

  try {
    const r2Path = isOnePiece ? `${R2_BASE}/data/op/${set}.json` : `${R2_BASE}/data/${set}.json`;
    const r2Res = await fetch(r2Path);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const json = await r2Res.json();
    const rawCards = isOnePiece ? (json.cards || json) : (json.cards || json);
    if (!rawCards.length) throw new Error('No cards found');

    const cards = rawCards.map(c => ({ ...c, rarity: normalizeRarity(c.rarity || '') }));

    const groups = {};
    for (const r of RARITY_ORDER) groups[r] = [];
    for (const c of cards) { const r = c.rarity || 'Unknown'; (groups[r] = groups[r]||[]).push(c); }
    for (const r of Object.keys(groups)) groups[r].sort((a,b) => naturalSort(a.localId, b.localId));

    const rhCards = master ? cards.filter(c => !SECRET_RARITIES.has(c.rarity)) : [];
    const slug = setName.replace(/[^a-z0-9]/gi,'-').toLowerCase().replace(/-+/g,'-');

    if (format === 'csv') {
      trackDownload(set, 'csv');
      const csv = buildCSV(setName, set, cards, groups, rhCards, master, today);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master?'master-set-':''}checklist.csv"`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(200).send('\uFEFF' + csv);
    }

    trackDownload(set, 'xlsx');
    const xlsxBuf = buildXLSX(setName, set, cards, groups, rhCards, master, today);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${master?'master-set-':''}checklist.xlsx"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(xlsxBuf);

  } catch (e) {
    console.error('[checklist]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── ZIP builder ───────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}
  return t;
})();
function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=(c>>>8)^CRC_TABLE[(c^buf[i])&0xFF];return(c^0xFFFFFFFF)>>>0;}

function buildZip(files) {
  const now=new Date();
  const dd=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  const dt=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  const entries=[]; let offset=0;
  for(const {name,data} of files){
    const nb=Buffer.from(name,'utf8'),db=Buffer.from(data);
    const comp=deflateRawSync(db,{level:6}),crc=crc32(db);
    const loc=Buffer.alloc(30+nb.length);
    loc.writeUInt32LE(0x04034B50,0);loc.writeUInt16LE(20,4);loc.writeUInt16LE(0,6);loc.writeUInt16LE(8,8);
    loc.writeUInt16LE(dt,10);loc.writeUInt16LE(dd,12);loc.writeUInt32LE(crc,14);
    loc.writeUInt32LE(comp.length,18);loc.writeUInt32LE(db.length,22);
    loc.writeUInt16LE(nb.length,26);loc.writeUInt16LE(0,28);nb.copy(loc,30);
    entries.push({nb,crc,comp,ul:db.length,loc,offset,dd,dt});
    offset+=loc.length+comp.length;
  }
  const cds=entries.map(e=>{
    const cd=Buffer.alloc(46+e.nb.length);
    cd.writeUInt32LE(0x02014B50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);
    cd.writeUInt16LE(0,8);cd.writeUInt16LE(8,10);cd.writeUInt16LE(e.dt,12);cd.writeUInt16LE(e.dd,14);
    cd.writeUInt32LE(e.crc,16);cd.writeUInt32LE(e.comp.length,20);cd.writeUInt32LE(e.ul,24);
    cd.writeUInt16LE(e.nb.length,28);cd.writeUInt16LE(0,30);cd.writeUInt16LE(0,32);
    cd.writeUInt16LE(0,34);cd.writeUInt16LE(0,36);cd.writeUInt32LE(0,38);cd.writeUInt32LE(e.offset,42);
    e.nb.copy(cd,46);return cd;
  });
  const cdb=Buffer.concat(cds),eocd=Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50,0);eocd.writeUInt16LE(0,4);eocd.writeUInt16LE(0,6);
  eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);
  eocd.writeUInt32LE(cdb.length,12);eocd.writeUInt32LE(offset,16);eocd.writeUInt16LE(0,20);
  return Buffer.concat([...entries.flatMap(e=>[e.loc,e.comp]),cdb,eocd]);
}

// ── XLSX builder ──────────────────────────────────────────────────────────────
function buildXLSX(setName, setId, cards, groups, rhCards, master, today) {
  const setPath = SET_URL_PATHS[setId] || setId;
  const setUrl = `https://tcgwatchtower.com/pokemon/sets/${setPath}/cards`;
  const sst = []; const sstMap = {};
  function si(s) {
    const str = String(s??'');
    if (sstMap[str]===undefined){sstMap[str]=sst.length;sst.push(str);}
    return sstMap[str];
  }

  const rowsXml = [];
  const dvs = [];
  let rn = 0;

  function row(cells, height=18) {
    rn++;
    rowsXml.push(`<row r="${rn}" ht="${height}" customHeight="1">${cells}</row>`);
    return rn;
  }

  function cell(col, rowNum, sstIdx, xfId) {
    return `<c r="${col}${rowNum}" t="s" s="${xfId}"><v>${sstIdx}</v></c>`;
  }
  function blank(col, rowNum, xfId) {
    return `<c r="${col}${rowNum}" s="${xfId}"/>`;
  }

  function addTitleRow(text) {
    const r = row(
      cell('A',rn+1,si(text),XF_HEADER_L) +
      'BCDEF'.split('').map(c=>blank(c,rn+1,XF_HEADER)).join(''),
      22
    );
    // merge A:F
    return r;
  }

  function addSectionRow(text) {
    const r = row(
      cell('A',rn+1,si(text),XF_SECTION) +
      'BCDEF'.split('').map(c=>blank(c,rn+1,XF_SECTION)).join(''),
      18
    );
    return r;
  }

  function addColHeaderRow() {
    const labels = ['#','Card Name','Rarity','Have ✓','Grade','Notes'];
    const xfs = [XF_HEADER,XF_HEADER_L,XF_HEADER,XF_HEADER,XF_HEADER,XF_HEADER_L];
    row(labels.map((l,i)=>cell('ABCDEF'[i],rn+1,si(l),xfs[i])).join(''), 20);
  }

  function addBlank() {
    row('ABCDEF'.split('').map(c=>blank(c,rn+1,XF_DEFAULT)).join(''));
  }

  function addCardRow(localId, name, rarityAbbrev, rarity) {
    const fi = RARITY_FILL[rarity] ?? FILL_COMMON;
    const xfNum    = rarityXf(fi, 'num');
    const xfCard   = rarityXf(fi, 'card');
    const xfAbbrev = rarityXf(fi, 'abbrev');
    const xfBlank  = rarityXf(fi, 'blank');
    const r = rn + 1;
    dvs.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" sqref="D${r}"><formula1>"Y,N,W"</formula1></dataValidation>`);
    dvs.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" sqref="E${r}"><formula1>"PSA 10,PSA 9,PSA 8,BGS 9.5,BGS 9,TAG 8,TAG 7,Raw"</formula1></dataValidation>`);
    row(
      cell('A',r,si(localId),   xfNum)  +
      cell('B',r,si(name),      xfCard) +
      cell('C',r,si(rarityAbbrev),xfAbbrev)+
      blank('D',r,xfBlank)+blank('E',r,xfBlank)+blank('F',r,xfBlank)
    );
  }

  const merges = [];
  function mergeFull(r) { merges.push(`<mergeCell ref="A${r}:F${r}"/>`); }

  // ── Title ──
  mergeFull(rn+1);
  addTitleRow(`${setName}${master?' — Master Set Checklist':' — Checklist'}`);

  row(
    cell('A',rn+1,si(`Set: ${setId.toUpperCase()}`),XF_MUTED)+
    cell('B',rn+1,si(`${cards.length+(master?rhCards.length:0)} cards`),XF_MUTED)+
    cell('C',rn+1,si(`Generated: ${today}`),XF_MUTED)+
    blank('D',rn+1,XF_DEFAULT)+
    cell('E',rn+1,si('Live prices:'),XF_MUTED)+
    cell('F',rn+1,si(setUrl),XF_LINK)
  );

  addBlank();

  // ── How to use ──
  row(cell('A',rn+1,si('HOW TO USE'),XF_BOLD)+'BCDEF'.split('').map(c=>blank(c,rn+1,XF_DEFAULT)).join(''));
  row(cell('A',rn+1,si('Have column:'),XF_BOLD)+cell('B',rn+1,si('Y = have it  |  N = need it  |  W = wishlisted'),XF_MUTED)+'CDEF'.split('').map(c=>blank(c,rn+1,XF_DEFAULT)).join(''));
  row(cell('A',rn+1,si('Grade column:'),XF_BOLD)+cell('B',rn+1,si('PSA 10 / PSA 9 / BGS 9.5 / TAG 8 / Raw — pick from dropdown'),XF_MUTED)+'CDEF'.split('').map(c=>blank(c,rn+1,XF_DEFAULT)).join(''));

  addBlank();

  // ── Card list ──
  addColHeaderRow();

  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group?.length) continue;
    addBlank();
    const secR = rn+1; mergeFull(secR);
    addSectionRow(`${rarity}  (${RARITY_ABBREV[rarity]||rarity})  —  ${group.length} card${group.length!==1?'s':''}`);
    for (const card of group) {
      addCardRow(padId(card.localId), card.name, RARITY_ABBREV[card.rarity]||card.rarity, card.rarity);
    }
  }

  // ── Reverse holos ──
  if (master && rhCards.length > 0) {
    addBlank();
    const rhSecR = rn+1; mergeFull(rhSecR);
    addSectionRow(`Reverse Holos  (RH)  —  ${rhCards.length} cards`);
    row(cell('A',rn+1,si('Foil versions of all Common, Uncommon, Rare, and Double Rare cards.'),XF_MUTED)+'BCDEF'.split('').map(c=>blank(c,rn+1,XF_DEFAULT)).join(''));
    addColHeaderRow();
    for (const card of rhCards.sort((a,b)=>naturalSort(a.localId,b.localId))) {
      addCardRow(padId(card.localId)+' RH', card.name, 'RH', card.rarity);
    }
  }

  addBlank();
  // Footer separator
  mergeFull(rn+1);
  row(cell('A',rn+1,si('━━━ TCG WATCHTOWER ━━━'),XF_HEADER_L)+'BCDEF'.split('').map(c=>blank(c,rn+1,XF_HEADER)).join(''),18);

  // Row 1: brand + homepage
  row(
    cell('A',rn+1,si('TCG Watchtower'),XF_BOLD)+
    cell('B',rn+1,si('https://tcgwatchtower.com'),XF_LINK)+
    cell('C',rn+1,si('Free Pokémon TCG price tracking, restock alerts & collector tools'),XF_MUTED)+
    blank('D',rn+1,XF_DEFAULT)+blank('E',rn+1,XF_DEFAULT)+blank('F',rn+1,XF_DEFAULT)
  );
  // Row 2: direct set link
  row(
    cell('A',rn+1,si(`${setName} prices:`),XF_BOLD)+
    cell('B',rn+1,si(setUrl),XF_LINK)+
    cell('C',rn+1,si('Live card prices updated daily for this set'),XF_MUTED)+
    blank('D',rn+1,XF_DEFAULT)+blank('E',rn+1,XF_DEFAULT)+blank('F',rn+1,XF_DEFAULT)
  );
  // Row 3: other tools
  row(
    cell('A',rn+1,si('Free tools:'),XF_BOLD)+
    cell('B',rn+1,si('Binder placeholders  •  Restock alerts  •  Portfolio tracker  •  Set checklists'),XF_MUTED)+
    blank('C',rn+1,XF_DEFAULT)+blank('D',rn+1,XF_DEFAULT)+blank('E',rn+1,XF_DEFAULT)+blank('F',rn+1,XF_DEFAULT)
  );
  // Row 4: share credit
  row(
    cell('A',rn+1,si('Share freely:'),XF_BOLD)+
    cell('B',rn+1,si('Please credit TCG Watchtower if sharing online — tcgwatchtower.com'),XF_MUTED)+
    blank('C',rn+1,XF_DEFAULT)+blank('D',rn+1,XF_DEFAULT)+blank('E',rn+1,XF_DEFAULT)+blank('F',rn+1,XF_DEFAULT)
  );

  // ── XML assembly ──

  // ── Legend sheet ─────────────────────────────────────────────────────────
  const legendRows = [];
  let lr = 0;
  function lrow(cells, height=18) { lr++; legendRows.push(`<row r="${lr}" ht="${height}" customHeight="1">${cells}</row>`); }
  function lc(col, sstIdx, xfId) { return `<c r="${col}${lr+1}" t="s" s="${xfId}"><v>${sstIdx}</v></c>`; }
  function lb(col, xfId) { return `<c r="${col}${lr+1}" s="${xfId}"/>`; }

  // Header row
  lrow([lc('A',si('#'),XF_HEADER), lc('B',si('Rarity'),XF_HEADER_L), lc('C',si('Abbrev'),XF_HEADER), lc('D',si('What It Means'),XF_HEADER_L), lb('E',XF_HEADER)].join(''), 20);

  const LEGEND_DESC = {
    'Common':                  'Circle symbol. ~6-7 per pack. Most common pull.',
    'Uncommon':                'Diamond symbol. ~2-3 per pack.',
    'Rare':                    '1 black star. 1 guaranteed per pack.',
    'Double Rare':             '2 black stars. Regular-art Pokemon ex.',
    'Illustration Rare':       '1 gold star. Full-art alternate scene, non-Rule Box Pokemon.',
    'Art Rare':                '1 gold star. Black Bolt / White Flare exclusive.',
    'Ultra Rare':              '2 foil silver stars. Full-art textured Pokemon ex or Supporter.',
    'Special Illustration Rare': '2 gold stars. Premium story-scene full art. Top collector target.',
    'Black White Rare':        '2 gold stars. Black Bolt / White Flare exclusive.',
    'Hyper Rare':              '3 gold stars. Gold-bordered card.',
    'Mega Hyper Rare':         '1 gold star (black border). Gold-etched Mega ex. Mega Evolution era only.',
    'Mega Attack Rare':        'Pink & green stars. Pop-art attack illustrations. Introduced in Ascended Heroes.',
    'Treasure Rare':           'One Piece TCG exclusive rarity.',
    'RH':                      'Reverse Holo. Foil on card border/background instead of artwork. Available for C / U / R / DR cards.',
  };
  const LEGEND_RARITIES = [...RARITY_ORDER, 'RH'];
  const LEGEND_ABBREV = { ...RARITY_ABBREV, 'RH': 'RH' };

  for (const rarity of LEGEND_RARITIES) {
    const fi = RARITY_FILL[rarity] ?? FILL_NONE;
    const xfNum  = (fi >= FILL_COMMON && fi <= FILL_RH) ? rarityXf(fi, 'num')  : XF_DEFAULT;
    const xfCard = (fi >= FILL_COMMON && fi <= FILL_RH) ? rarityXf(fi, 'card') : XF_DEFAULT;
    const xfBlank= (fi >= FILL_COMMON && fi <= FILL_RH) ? rarityXf(fi, 'blank'): XF_DEFAULT;
    const abbrev = LEGEND_ABBREV[rarity] || '';
    const desc   = LEGEND_DESC[rarity]   || '';
    lrow([lc('A',si(abbrev), xfNum), lc('B',si(rarity), xfCard), lc('C',si(abbrev), xfNum), lc('D',si(desc), xfCard), lb('E', xfBlank)].join(''));
  }

  // Footer
  lrow([lb('A',XF_DEFAULT), lb('B',XF_DEFAULT), lb('C',XF_DEFAULT), lb('D',XF_DEFAULT), lb('E',XF_DEFAULT)].join(''));
  lrow([lc('A',si('TCG Watchtower'),XF_BOLD), lc('B',si('tcgwatchtower.com'),XF_LINK), lb('C',XF_DEFAULT), lb('D',XF_DEFAULT), lb('E',XF_DEFAULT)].join(''));

  const legendSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView tabSelected="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="3" width="8" customWidth="1"/><col min="4" max="4" width="55" customWidth="1"/><col min="5" max="5" width="4" customWidth="1"/></cols><sheetData>${legendRows.join('')}</sheetData></worksheet>`;

  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map(s=>`<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;

  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '';
  const dvXml = dvs.length ? `<dataValidations count="${dvs.length}">${dvs.join('')}</dataValidations>` : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="4" width="11" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/><col min="6" max="6" width="24" customWidth="1"/></cols><sheetData>${rowsXml.join('')}</sheetData>${mergeXml}${dvXml}</worksheet>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Checklist" sheetId="1" r:id="rId1"/><sheet name="Rarity Legend" sheetId="2" r:id="rId4"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  return buildZip([
    { name: '[Content_Types].xml',         data: contentTypes },
    { name: '_rels/.rels',                 data: pkgRels },
    { name: 'xl/workbook.xml',             data: wbXml },
    { name: 'xl/_rels/workbook.xml.rels',  data: wbRels },
    { name: 'xl/worksheets/sheet1.xml',    data: sheetXml },
    { name: 'xl/worksheets/sheet2.xml',    data: legendSheetXml },
    { name: 'xl/sharedStrings.xml',        data: sstXml },
    { name: 'xl/styles.xml',              data: STYLES_XML },
  ]);
}

// ── CSV builder ───────────────────────────────────────────────────────────────
function buildCSV(setName, setId, cards, groups, rhCards, master, today) {
  const totalCards = cards.length + (master ? rhCards.length : 0);
  const setPath = SET_URL_PATHS[setId] || setId;
  const setUrl = `https://tcgwatchtower.com/pokemon/sets/${setPath}/cards`;
  const rows = [];

  // Width hint row — forces natural column widths on open
  rows.push(['###','Card Name — Full Name Here              ','Rarity  ','Have','Grade (PSA/BGS/TAG)','Notes / Comments        ']);

  // Header
  rows.push(['']);
  rows.push([`${setName}${master ? ' — Master Set Checklist' : ' — Checklist'}`]);
  rows.push([`Set: ${setId.toUpperCase()}`, `${totalCards} cards total`, `Generated: ${today}`]);
  rows.push(['']);
  rows.push(['=== TCG WATCHTOWER ===', 'Live prices, restock alerts & more']);
  rows.push(['View this set online:', setUrl]);
  rows.push(['Binder placeholders:', 'Free PDF on every set page at tcgwatchtower.com']);
  rows.push(['']);

  // How to use
  rows.push(['=== HOW TO USE ===']);
  rows.push(['Have column:', 'Y = I have it   N = I need it   W = Wishlisted']);
  rows.push(['Grade column:', 'PSA 10 / PSA 9 / PSA 8 / BGS 9.5 / BGS 9 / TAG 8 / TAG 7 / Raw']);
  rows.push(['Notes column:', 'Purchase price, seller, condition, trade info etc.']);
  rows.push(['']);

  // Rarity Legend
  rows.push(['=== RARITY LEGEND ===']);
  rows.push(['Abbrev', 'Full Rarity Name', 'What It Means']);
  rows.push(['------', '----------------', '-------------']);
  for (const r of RARITY_ORDER) {
    if (RARITY_ABBREV[r]) rows.push([RARITY_ABBREV[r], r, RARITY_DESC[r] || '']);
  }
  rows.push(['RH', 'Reverse Holo', 'Foil pattern on card border/background. Any C / U / R / DR card can have a RH version.']);
  rows.push(['']);

  // Card list
  rows.push(['=== CARD LIST ===']);
  rows.push(['']);

  for (const rarity of RARITY_ORDER) {
    const group = groups[rarity];
    if (!group?.length) continue;
    rows.push([`--- ${rarity.toUpperCase()} (${RARITY_ABBREV[rarity]||rarity}) -- ${group.length} card${group.length!==1?'s':''} ---`]);
    rows.push(['#', 'Card Name', 'Rarity', 'Have (Y/N/W)', 'Grade (PSA/BGS/TAG)', 'Notes']);
    for (const card of group) {
      rows.push([padId(card.localId), card.name, RARITY_ABBREV[card.rarity]||card.rarity, '', '', '']);
    }
    rows.push(['']);
  }

  if (master && rhCards.length > 0) {
    rows.push([`--- REVERSE HOLOS (RH) -- ${rhCards.length} cards ---`]);
    rows.push(['Foil versions of all Common, Uncommon, Rare, and Double Rare cards.']);
    rows.push(['#', 'Card Name', 'Base Rarity', 'Have (Y/N/W)', 'Grade (PSA/BGS/TAG)', 'Notes']);
    for (const card of rhCards.sort((a,b)=>naturalSort(a.localId,b.localId))) {
      rows.push([padId(card.localId)+' RH', card.name, RARITY_ABBREV[card.rarity]||card.rarity, '', '', '']);
    }
    rows.push(['']);
  }

  // Footer
  rows.push(['=== TCG WATCHTOWER ===']);
  rows.push(['Website:', 'https://tcgwatchtower.com']);
  rows.push([`${setName} prices:`, setUrl]);
  rows.push(['Free tools:', 'Checklists, binder placeholders, restock alerts, card price tracking']);
  rows.push(['Share freely:', 'Please credit TCG Watchtower if posting online.']);

  return rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

function xmlEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function normalizeRarity(r){return r.split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');}
function padId(id){const n=parseInt(id,10);return isNaN(n)?id:String(n).padStart(3,'0');}
function naturalSort(a,b){const na=parseInt(a,10),nb=parseInt(b,10);if(!isNaN(na)&&!isNaN(nb))return na-nb;return String(a).localeCompare(String(b));}







