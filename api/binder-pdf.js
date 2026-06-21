// api/binder-pdf.js — v3
// Clean minimalist binder placeholders — number top-center, name large center, rarity bottom
// GET /api/binder-pdf?set=me04&size=9   (9-pocket)
// GET /api/binder-pdf?set=me04&size=12  (12-pocket)
// GET /api/binder-pdf?set=me04&size=16  (16-pocket)

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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

// Rarity accent colors — used for number and rarity label text
const RARITY_ACCENT = {
  'MHR': rgb(0.85, 0.60, 0.00), // vivid gold
  'MUR': rgb(0.85, 0.60, 0.00),
  'MAR': rgb(0.85, 0.60, 0.00),
  'SIR': rgb(0.55, 0.10, 0.90), // vivid purple
  'HR':  rgb(0.85, 0.60, 0.00),
  'IR':  rgb(0.85, 0.42, 0.00), // vivid orange-amber
  'AR':  rgb(0.85, 0.42, 0.00),
  'UR':  rgb(0.85, 0.10, 0.10), // vivid red
  'BWR': rgb(0.08, 0.08, 0.08), // near black
  'DR':  rgb(0.00, 0.55, 0.30), // vivid green
  'R':   rgb(0.08, 0.38, 0.80), // vivid blue
  'U':   rgb(0.25, 0.40, 0.60), // slate blue
  'C':   rgb(0.38, 0.42, 0.48), // medium gray
};

const CARD_RATIO = 88 / 63;

const GRID_CONFIGS = {
  9:  { cols: 3, rows: 3 },
  12: { cols: 4, rows: 3 },
  16: { cols: 4, rows: 4 },
};

// Rarity full labels for bottom text (small caps style via uppercase)
const RARITY_LABELS = {
  'C':'STANDARD','U':'STANDARD','R':'HOLO','DR':'DOUBLE RARE',
  'IR':'ILLUSTRATION RARE','AR':'ART RARE','UR':'ULTRA RARE',
  'SIR':'SPECIAL ILLUSTRATION RARE','HR':'HYPER RARE',
  'MHR':'MEGA HYPER RARE','MAR':'MEGA ATTACK RARE','MUR':'MEGA ULTRA RARE',
  'BWR':'BLACK WHITE RARE','TR':'TREASURE RARE',
};

export default async function handler(req, res) {
  const { set, size = '9' } = req.query;
  if (!set) return res.status(400).json({ error: 'set parameter required' });

  const gridSize = parseInt(size, 10);
  const grid = GRID_CONFIGS[gridSize];
  if (!grid) return res.status(400).json({ error: 'size must be 9, 12, or 16' });

  const setName = SET_NAMES[set] || set;

  try {
    const r2Res = await fetch(`${R2_BASE}/data/${set}.json`);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const { cards = [] } = await r2Res.json();
    if (!cards.length) throw new Error('No cards found');

    const pdfDoc    = await PDFDocument.create();
    const fontBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontLight = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Letter page — best for US printing
    const PAGE_W = 612, PAGE_H = 792;
    const MARGIN = 28;
    const HEADER = 28;
    const FOOTER = 16;
    const GAP    = 6;

    const usableW = PAGE_W - MARGIN * 2;
    const usableH = PAGE_H - MARGIN * 2 - HEADER - FOOTER;

    const cellW = (usableW - GAP * (grid.cols - 1)) / grid.cols;
    const cellH = (usableH - GAP * (grid.rows - 1)) / grid.rows;

    const slotW   = Math.min(cellW, cellH / CARD_RATIO);
    const slotH   = slotW * CARD_RATIO;
    const offsetX = (cellW - slotW) / 2;

    // Official set card count — max numeric localId
    const maxId = Math.max(...cards.map(c => parseInt(c.localId, 10)).filter(n => !isNaN(n)));
    const totalStr = String(maxId).padStart(3, '0');
    const cardNum  = id => `${String(id).padStart(3, '0')}/${totalStr}`;

    const cardsPerPage = grid.cols * grid.rows;
    const totalPages   = Math.ceil(cards.length / cardsPerPage);

    // Colors
    const PAGE_BG    = rgb(0.88, 0.88, 0.88); // light gray page — cards pop
    const CARD_BG    = rgb(1.00, 1.00, 1.00); // pure white card face
    const CARD_EDGE  = rgb(0.60, 0.60, 0.60); // visible border
    const HEADER_BG  = rgb(0.10, 0.14, 0.26); // dark navy
    const HDR_TEXT   = rgb(1, 1, 1);
    const HDR_SUB    = rgb(0.60, 0.68, 0.82);
    const NAME_COLOR = rgb(0.05, 0.10, 0.18); // very dark navy for card name

    for (let p = 0; p < totalPages; p++) {
      const page      = pdfDoc.addPage([PAGE_W, PAGE_H]);
      const pageCards = cards.slice(p * cardsPerPage, (p + 1) * cardsPerPage);

      // Page background
      page.drawRectangle({ x:0, y:0, width:PAGE_W, height:PAGE_H, color:PAGE_BG });

      // Header
      page.drawRectangle({
        x:0, y: PAGE_H - MARGIN - HEADER,
        width: PAGE_W, height: HEADER + MARGIN,
        color: HEADER_BG,
      });
      page.drawText(`${setName}  —  ${gridSize}-Pocket Binder Placeholders`, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER + 14,
        size: 9.5, font: fontBold, color: HDR_TEXT,
      });
      page.drawText(`Page ${p+1} of ${totalPages}  •  tcgwatchtower.com  •  Free card lists, live prices & restock alerts`, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER + 3,
        size: 6, font: fontLight, color: HDR_SUB,
      });

      // Draw each card slot
      for (let i = 0; i < pageCards.length; i++) {
        const card = pageCards[i];
        const col  = i % grid.cols;
        const row  = Math.floor(i / grid.cols);

        const sx = MARGIN + col * (cellW + GAP) + offsetX;
        const sy = PAGE_H - MARGIN - HEADER - GAP
                   - (row + 1) * (cellH + GAP) + GAP
                   + (cellH - slotH);

        const rShort  = shortenRarity(card.rarity || '');
        const accent  = RARITY_ACCENT[rShort] || RARITY_ACCENT['C'];
        const numText = cardNum(card.localId);
        const label   = RARITY_LABELS[rShort] || rShort;

        // Card face — rounded rect approximated with rectangle + corner clips
        // Subtle shadow
        page.drawRectangle({
          x: sx + 2, y: sy - 2,
          width: slotW, height: slotH,
          color: rgb(0.40, 0.40, 0.40), opacity: 0.35,
        });

        // Card background
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: slotH,
          color: CARD_BG,
          borderColor: CARD_EDGE,
          borderWidth: 0.6,
        });

        // ── Number — top center, accent color ──
        const numSz  = 7.5;
        const numW   = fontBold.widthOfTextAtSize(numText, numSz);
        page.drawText(numText, {
          x: sx + (slotW - numW) / 2,
          y: sy + slotH - 18,
          size: numSz, font: fontBold, color: accent,
        });

        // ── Card name — large, centered vertically ──
        const nm     = card.name || '';
        // Scale font size to fit within slot width
        let nmSz = 13;
        while (nmSz > 6 && fontBold.widthOfTextAtSize(nm, nmSz) > slotW - 10) {
          nmSz -= 0.5;
        }
        const nmW = fontBold.widthOfTextAtSize(nm, nmSz);
        page.drawText(nm, {
          x: sx + (slotW - nmW) / 2,
          y: sy + slotH * 0.44,
          size: nmSz, font: fontBold, color: NAME_COLOR,
        });

        // ── Rarity label — bottom center, small, spaced caps ──
        const labSz = 5.5;
        const labW  = fontLight.widthOfTextAtSize(label, labSz);
        page.drawText(label, {
          x: sx + (slotW - labW) / 2,
          y: sy + 9,
          size: labSz, font: fontBold, color: accent,
        });

        // ── Thin accent line above rarity label ──
        page.drawLine({
          start: { x: sx + 8, y: sy + 20 },
          end:   { x: sx + slotW - 8, y: sy + 20 },
          thickness: 0.6,
          color: accent,
          opacity: 0.25,
        });

        // ── Thin accent line below number ──
        page.drawLine({
          start: { x: sx + 8, y: sy + slotH - 22 },
          end:   { x: sx + slotW - 8, y: sy + slotH - 22 },
          thickness: 0.6,
          color: accent,
          opacity: 0.25,
        });

        // ── Small TCGWatchtower logo mark — bottom right ──
        // no per-card watermark — cleaner
      }

      // Empty slots — last page
      for (let i = pageCards.length; i < cardsPerPage; i++) {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        const sx  = MARGIN + col * (cellW + GAP) + offsetX;
        const sy  = PAGE_H - MARGIN - HEADER - GAP
                    - (row + 1) * (cellH + GAP) + GAP
                    + (cellH - slotH);
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: slotH,
          color: rgb(0.91, 0.91, 0.89),
          borderColor: rgb(0.80, 0.80, 0.78), borderWidth: 0.4,
          opacity: 0.5,
        });
      }

      // Footer
      page.drawText(
        'TCG Watchtower — tcgwatchtower.com   •   Free card lists, live prices & restock alerts for every Pokémon TCG set   •   Print on Letter or A4, cut to fit binder sleeves',
        { x: MARGIN, y: 10, size: 5, font: fontLight, color: rgb(0.60, 0.60, 0.58) }
      );
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${set}-binder-${gridSize}pocket.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (e) {
    console.error('[binder-pdf]', e.message);
    res.status(500).json({ error: e.message });
  }
}

function shortenRarity(r) {
  const map = {
    'Common':'C','Uncommon':'U','Rare':'R','Double Rare':'DR',
    'Illustration Rare':'IR','Art Rare':'AR','Ultra Rare':'UR',
    'Special Illustration Rare':'SIR','Hyper Rare':'HR',
    'Mega Hyper Rare':'MHR','Mega Attack Rare':'MAR','Mega Ultra Rare':'MUR',
    'Black White Rare':'BWR','Treasure Rare':'TR',
  };
  const norm = r.split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');
  return map[norm] || norm;
}

