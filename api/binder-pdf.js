// api/binder-pdf.js
// Generates a printable binder placeholder PDF for a set
// GET /api/binder-pdf?set=me05&size=9   (9-pocket, 3x3)
// GET /api/binder-pdf?set=me05&size=12  (12-pocket, 4x3)
// GET /api/binder-pdf?set=me05&size=16  (16-pocket, 4x4)
//
// Uses pdf-lib (pure JS, no binary dependencies, works on Vercel)

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

// Grid configs: { cols, rows, label }
const GRID_CONFIGS = {
  9:  { cols: 3, rows: 3 },
  12: { cols: 4, rows: 3 },
  16: { cols: 4, rows: 4 },
};

// Standard Pokémon card ratio: 63mm × 88mm → ~2.5 × 3.5 inches
const CARD_RATIO = 88 / 63; // height/width

export default async function handler(req, res) {
  const { set, size = '9' } = req.query;

  if (!set) return res.status(400).json({ error: 'set parameter required' });

  const gridSize = parseInt(size, 10);
  const grid = GRID_CONFIGS[gridSize];
  if (!grid) return res.status(400).json({ error: 'size must be 9, 12, or 16' });

  const setName = SET_NAMES[set] || set;

  try {
    // Fetch card data
    const r2Res = await fetch(`${R2_BASE}/data/${set}.json`);
    if (!r2Res.ok) throw new Error(`R2 ${r2Res.status}`);
    const data = await r2Res.json();
    const cards = data.cards || [];
    if (cards.length === 0) throw new Error('No cards found');

    // Create PDF (A4: 595 × 842 pt | Letter: 612 × 792 pt)
    const pdfDoc = await PDFDocument.create();
    const font      = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontLight = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Page dimensions — A4
    const PAGE_W = 595;
    const PAGE_H = 842;
    const MARGIN  = 28; // ~10mm
    const HEADER_H = 36;
    const FOOTER_H = 20;

    const usableW = PAGE_W - MARGIN * 2;
    const usableH = PAGE_H - MARGIN * 2 - HEADER_H - FOOTER_H;

    const GAP = 6; // gap between cards
    const cellW = (usableW - GAP * (grid.cols - 1)) / grid.cols;
    const cellH = (usableH - GAP * (grid.rows - 1)) / grid.rows;

    // Actual card slot dimensions (respect ratio, fit within cell)
    const slotW = Math.min(cellW, cellH / CARD_RATIO);
    const slotH = slotW * CARD_RATIO;

    const cardsPerPage = grid.cols * grid.rows;
    const totalPages   = Math.ceil(cards.length / cardsPerPage);

    // Brand colors (dark blue + purple gradient approximated as flat)
    const colorDark   = rgb(0.06, 0.09, 0.16);  // #0f172a
    const colorCard   = rgb(0.12, 0.16, 0.23);  // #1e293b
    const colorBorder = rgb(0.23, 0.51, 0.96);  // #3b82f6 blue
    const colorText   = rgb(0.88, 0.91, 0.94);  // #e2e8f0
    const colorMuted  = rgb(0.58, 0.64, 0.72);  // #94a3b8
    const colorAccent = rgb(0.37, 0.85, 0.50);  // #4ade80 green

    for (let p = 0; p < totalPages; p++) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      const pageCards = cards.slice(p * cardsPerPage, (p + 1) * cardsPerPage);

      // Background
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: colorDark });

      // Header bar
      page.drawRectangle({
        x: 0, y: PAGE_H - MARGIN - HEADER_H,
        width: PAGE_W, height: HEADER_H + MARGIN,
        color: rgb(0.08, 0.11, 0.20),
      });

      // Header text
      page.drawText(`${setName} — Binder Placeholder (${gridSize}-pocket)`, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER_H + 12,
        size: 11, font, color: colorText,
      });
      page.drawText(`TCG Watchtower  •  tcgwatchtower.com  •  Page ${p + 1} of ${totalPages}`, {
        x: MARGIN, y: PAGE_H - MARGIN - HEADER_H + 0,
        size: 7, font: fontLight, color: colorMuted,
      });

      // Card slots
      pageCards.forEach((card, i) => {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);

        // Top-left of this slot (pdf-lib y=0 is bottom)
        const x = MARGIN + col * (slotW + GAP) + (cellW - slotW) / 2;
        const y = PAGE_H - MARGIN - HEADER_H - GAP
                  - (row + 1) * slotH - row * GAP
                  - (cellH - slotH) / 2 * 0; // top-align within cell

        // Card background
        page.drawRectangle({
          x, y, width: slotW, height: slotH,
          color: colorCard,
          borderColor: colorBorder,
          borderWidth: 0.8,
          borderOpacity: 0.5,
        });

        // Pokéball watermark circle (decorative)
        page.drawEllipse({
          x: x + slotW / 2, y: y + slotH / 2,
          xScale: slotW * 0.28, yScale: slotW * 0.28,
          color: rgb(0.08, 0.11, 0.20),
          borderColor: rgb(0.23, 0.51, 0.96),
          borderWidth: 0.5,
          opacity: 0.3,
          borderOpacity: 0.3,
        });

        // Card number top-left
        page.drawText(`#${String(card.localId).padStart(3, '0')}`, {
          x: x + 4, y: y + slotH - 10,
          size: 6, font: fontLight, color: colorAccent,
        });

        // Card name — centered, middle of card
        const cardName = card.name || '';
        const nameFontSize = cardName.length > 16 ? 6.5 : cardName.length > 12 ? 7.5 : 8.5;
        const nameWidth = font.widthOfTextAtSize(cardName, nameFontSize);
        page.drawText(cardName, {
          x: x + (slotW - nameWidth) / 2,
          y: y + slotH / 2 - nameFontSize / 2,
          size: nameFontSize, font, color: colorText,
        });

        // Rarity bottom-center
        const rarity = shortenRarity(card.rarity || '');
        const raritySize = 5.5;
        const rarityWidth = fontLight.widthOfTextAtSize(rarity, raritySize);
        page.drawText(rarity, {
          x: x + (slotW - rarityWidth) / 2,
          y: y + 5,
          size: raritySize, font: fontLight, color: colorMuted,
        });

        // Checkbox top-right
        page.drawRectangle({
          x: x + slotW - 10, y: y + slotH - 10,
          width: 7, height: 7,
          color: rgb(0.08, 0.11, 0.20),
          borderColor: colorBorder,
          borderWidth: 0.6,
          borderOpacity: 0.6,
        });
      });

      // Fill remaining slots on last page with empty placeholders
      for (let i = pageCards.length; i < cardsPerPage; i++) {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        const x = MARGIN + col * (slotW + GAP) + (cellW - slotW) / 2;
        const y = PAGE_H - MARGIN - HEADER_H - GAP
                  - (row + 1) * slotH - row * GAP;
        page.drawRectangle({
          x, y, width: slotW, height: slotH,
          color: rgb(0.09, 0.12, 0.19),
          borderColor: rgb(0.15, 0.20, 0.30),
          borderWidth: 0.5,
          borderOpacity: 0.3,
        });
      }

      // Footer
      page.drawText('Generated by TCG Watchtower — tcgwatchtower.com — Free to print and use', {
        x: MARGIN, y: MARGIN / 2,
        size: 6, font: fontLight, color: colorMuted,
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${set}-binder-placeholder-${gridSize}pocket.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (e) {
    console.error('[binder-pdf]', e.message);
    res.status(500).json({ error: e.message });
  }
}

function shortenRarity(r) {
  const map = {
    'Common': 'C', 'Uncommon': 'U', 'Rare': 'R', 'Double Rare': 'DR',
    'Illustration Rare': 'IR', 'Ultra Rare': 'UR',
    'Special Illustration Rare': 'SIR', 'Hyper Rare': 'HR',
    'Mega Hyper Rare': 'MHR', 'Mega Ultra Rare': 'MUR',
    'Black White Rare': 'BWR', 'Art Rare': 'AR', 'Treasure Rare': 'TR',
  };
  const normalized = r.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
  return map[normalized] || normalized;
}
