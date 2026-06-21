// api/binder-pdf.js — v2
// Generates print-ready binder placeholder PDFs with card artwork embedded
// GET /api/binder-pdf?set=me04&size=9   (9-pocket, 3x3)
// GET /api/binder-pdf?set=me04&size=12  (12-pocket, 4x3)
// GET /api/binder-pdf?set=me04&size=16  (16-pocket, 4x4)

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

const GRID_CONFIGS = {
  9:  { cols: 3, rows: 3 },
  12: { cols: 4, rows: 3 },
  16: { cols: 4, rows: 4 },
};

// Rarity colors for the badge strip at bottom of each card
const RARITY_COLORS = {
  'MHR': rgb(1.0, 0.75, 0.0),   // gold
  'MUR': rgb(1.0, 0.75, 0.0),
  'SIR': rgb(0.76, 0.33, 0.97), // purple
  'HR':  rgb(1.0, 0.75, 0.0),
  'IR':  rgb(1.0, 0.75, 0.25),  // amber
  'AR':  rgb(1.0, 0.75, 0.25),
  'UR':  rgb(0.94, 0.27, 0.27), // red
  'BWR': rgb(0.94, 0.27, 0.27),
  'DR':  rgb(0.24, 0.71, 0.49), // green
  'R':   rgb(0.36, 0.53, 0.85), // blue
  'U':   rgb(0.36, 0.53, 0.85),
  'C':   rgb(0.55, 0.60, 0.67), // gray
};

const CARD_RATIO = 88 / 63; // Pokémon card h/w

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
    const data = await r2Res.json();
    const cards = data.cards || [];
    if (!cards.length) throw new Error('No cards found');

    const pdfDoc = await PDFDocument.create();
    const font      = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontLight = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Letter page (better for US printing) — 612 × 792 pt
    const PAGE_W  = 612;
    const PAGE_H  = 792;
    const MARGIN  = 24;
    const HEADER  = 32;
    const FOOTER  = 18;
    const GAP     = 5;

    const usableW = PAGE_W - MARGIN * 2;
    const usableH = PAGE_H - MARGIN * 2 - HEADER - FOOTER;

    const cellW = (usableW - GAP * (grid.cols - 1)) / grid.cols;
    const cellH = (usableH - GAP * (grid.rows - 1)) / grid.rows;

    // Card slot — preserve aspect ratio
    const slotW = Math.min(cellW, cellH / CARD_RATIO);
    const slotH = slotW * CARD_RATIO;
    const offsetX = (cellW - slotW) / 2;

    const cardsPerPage = grid.cols * grid.rows;
    const totalPages   = Math.ceil(cards.length / cardsPerPage);

    // Prefetch card images (up to cardsPerPage at a time, embedded per page)
    const imgCache = new Map();
    async function getCardImg(localId) {
      if (imgCache.has(localId)) return imgCache.get(localId);
      try {
        const url = `${R2_BASE}/cards/${set}/${localId}.webp`;
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        // pdf-lib expects PNG or JPEG; webp needs conversion or we skip
        // Try as JPEG fallback if webp fails
        try {
          const img = await pdfDoc.embedPng(buf);
          imgCache.set(localId, img);
          return img;
        } catch {
          try {
            const img = await pdfDoc.embedJpg(buf);
            imgCache.set(localId, img);
            return img;
          } catch {
            return null;
          }
        }
      } catch { return null; }
    }

    // Colors
    const BG       = rgb(0.97, 0.97, 0.98); // near-white — prints clean
    const CARD_BG  = rgb(1.0, 1.0, 1.0);
    const BORDER   = rgb(0.80, 0.82, 0.86);
    const TEXT_DK  = rgb(0.10, 0.12, 0.18);
    const TEXT_MD  = rgb(0.35, 0.38, 0.45);
    const TEXT_LT  = rgb(0.60, 0.63, 0.70);
    const ACCENT   = rgb(0.23, 0.51, 0.96); // TCGWatchtower blue
    const STRIP_H  = 14; // rarity strip height at bottom of card

    for (let p = 0; p < totalPages; p++) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      const pageCards = cards.slice(p * cardsPerPage, (p + 1) * cardsPerPage);

      // Page background
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BG });

      // Header bar
      page.drawRectangle({
        x: 0, y: PAGE_H - HEADER - MARGIN,
        width: PAGE_W, height: HEADER + MARGIN,
        color: rgb(0.13, 0.18, 0.32),
      });

      // Set name in header
      const headerText = `${setName} — ${gridSize}-Pocket Binder Placeholders`;
      page.drawText(headerText, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER + 12,
        size: 10, font, color: rgb(1,1,1),
      });
      page.drawText(`Page ${p + 1} of ${totalPages}  •  TCG Watchtower  •  tcgwatchtower.com`, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER + 2,
        size: 6.5, font: fontLight, color: rgb(0.6, 0.68, 0.82),
      });

      // Card slots
      for (let i = 0; i < pageCards.length; i++) {
        const card = pageCards[i];
        const col  = i % grid.cols;
        const row  = Math.floor(i / grid.cols);

        const cellX = MARGIN + col * (cellW + GAP);
        const cellY = PAGE_H - MARGIN - HEADER - GAP - (row + 1) * (cellH + GAP) + GAP;

        const sx = cellX + offsetX;
        const sy = cellY + (cellH - slotH);

        // Card shadow (subtle)
        page.drawRectangle({
          x: sx + 1.5, y: sy - 1.5,
          width: slotW, height: slotH,
          color: rgb(0.78, 0.80, 0.84),
          opacity: 0.4,
        });

        // Card background
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: slotH,
          color: CARD_BG,
        });

        // Try embed card image
        const img = await getCardImg(card.localId);
        if (img) {
          // Image fills top portion, leaving space for name strip at bottom
          const imgH = slotH - STRIP_H - 2;
          page.drawImage(img, {
            x: sx, y: sy + STRIP_H + 2,
            width: slotW, height: imgH,
          });
        } else {
          // No image — draw styled placeholder interior
          const rShort = shortenRarity(card.rarity || '');
          const rarCol  = RARITY_COLORS[rShort] || TEXT_LT;

          // Light gradient-like fill (two rectangles)
          page.drawRectangle({
            x: sx, y: sy + STRIP_H, width: slotW, height: slotH - STRIP_H,
            color: rgb(0.93, 0.94, 0.97),
          });
          // Card number large watermark
          const numStr = `#${String(card.localId).padStart(3, '0')}`;
          const numSz  = Math.min(slotW * 0.35, 22);
          const numW   = font.widthOfTextAtSize(numStr, numSz);
          page.drawText(numStr, {
            x: sx + (slotW - numW) / 2,
            y: sy + slotH * 0.55,
            size: numSz, font, color: rgb(0.82, 0.84, 0.88), opacity: 0.8,
          });
          // Card name centered
          const nm   = card.name || '';
          const nmSz = nm.length > 18 ? 6 : nm.length > 12 ? 7 : 8;
          const nmW  = font.widthOfTextAtSize(nm, nmSz);
          page.drawText(nm, {
            x: sx + (slotW - nmW) / 2,
            y: sy + slotH * 0.38,
            size: nmSz, font, color: TEXT_DK,
          });
        }

        // Bottom rarity strip
        const rShort  = shortenRarity(card.rarity || '');
        const stripColor = RARITY_COLORS[rShort] || TEXT_LT;
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: STRIP_H,
          color: stripColor, opacity: 0.92,
        });

        // Card number in strip (left)
        page.drawText(`#${String(card.localId).padStart(3, '0')}`, {
          x: sx + 3, y: sy + 4,
          size: 5.5, font, color: rgb(1,1,1),
        });

        // Rarity label in strip (right)
        const rarW = font.widthOfTextAtSize(rShort, 5.5);
        page.drawText(rShort, {
          x: sx + slotW - rarW - 3, y: sy + 4,
          size: 5.5, font, color: rgb(1,1,1),
        });

        // Card name below image (if image loaded)
        if (img) {
          const nm   = card.name || '';
          const nmSz = nm.length > 18 ? 5 : nm.length > 12 ? 5.5 : 6;
          const nmW  = fontLight.widthOfTextAtSize(nm, nmSz);
          // name goes in strip centered
          page.drawText(nm, {
            x: sx + (slotW - nmW) / 2, y: sy + 4.5,
            size: nmSz, font: fontLight, color: rgb(1,1,1),
          });
          // override number to left only
          page.drawText(`#${String(card.localId).padStart(3, '0')}`, {
            x: sx + 3, y: sy + 4,
            size: 5, font, color: rgb(1,1,1),
          });
        }

        // Card border
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: slotH,
          borderColor: BORDER, borderWidth: 0.5,
          color: rgb(0,0,0), opacity: 0,
        });

        // Checkbox — top right corner
        const cbSize = 8;
        const cbX = sx + slotW - cbSize - 3;
        const cbY = sy + slotH - cbSize - 3;
        page.drawRectangle({
          x: cbX, y: cbY, width: cbSize, height: cbSize,
          color: rgb(1,1,1),
          borderColor: BORDER, borderWidth: 0.8,
        });
      }

      // Empty slots on last page
      for (let i = pageCards.length; i < cardsPerPage; i++) {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        const sx  = MARGIN + col * (cellW + GAP) + offsetX;
        const sy  = PAGE_H - MARGIN - HEADER - GAP - (row + 1) * (cellH + GAP) + GAP + (cellH - slotH);
        page.drawRectangle({
          x: sx, y: sy, width: slotW, height: slotH,
          color: rgb(0.91, 0.92, 0.94), opacity: 0.5,
          borderColor: rgb(0.82, 0.84, 0.87), borderWidth: 0.5,
        });
      }

      // Footer
      page.drawText(
        `Generated free by TCG Watchtower — tcgwatchtower.com  |  Print at home on Letter or A4 paper  |  Cut along edges to fit standard binder sleeves`,
        { x: MARGIN, y: MARGIN - 8, size: 5.5, font: fontLight, color: TEXT_LT }
      );
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${setName.replace(/[^a-z0-9]/gi,'-')}-binder-${gridSize}pocket.pdf"`);
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
