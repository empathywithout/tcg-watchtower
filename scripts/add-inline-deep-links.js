// scripts/add-inline-deep-links.js
//
// Corrects the previous nav-button fix and adds real inline links:
//
// 1. Reverts the 'Chase Cards' / 'Sealed Products' section-nav-btn elements
//    back to <button> + scroll-to-section (their original behavior), and
//    strips the `history.pushState(...)` line from the shared click handler.
//    The nav bar should only ever scroll within the current page — it
//    should never fake the URL bar to a page it hasn't actually loaded.
//
// 2. Adds a real, crawlable <a href> link inside the in-page Sealed
//    Products section (top of section-products, under the subtitle)
//    pointing to the full /sealed-product page — for all 26 sets.
//
// 3. Adds the same style of link inside the in-page Chase Cards section
//    (top of section-chase) pointing to /top-chase-cards — for the 22
//    sets that actually have that page.
//
// 4. Fills any remaining gaps in the FAQ 'See all X chase cards ranked by
//    price' link (the pattern Chaos Rising already had) for sets that have
//    top-chase-cards.html but never got that FAQ link added.
//
// Usage: node scripts/add-inline-deep-links.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://tcgwatchtower.com';
const SKIP_FILES = new Set(['fates-card-listtemporal-forces-card-list.html']);

function extractSection(src, sectionId) {
  const startMarker = `<section class="section" id="${sectionId}">`;
  const start = src.indexOf(startMarker);
  if (start === -1) return null;
  const closeIdx = src.indexOf('</section>', start);
  if (closeIdx === -1) return null;
  const end = closeIdx + '</section>'.length;
  return { start, end, text: src.slice(start, end) };
}

function extractFaqBlock(src) {
  // Match the 'What is the most expensive X card?' FAQ item generically —
  // the title-derived setFullName sometimes includes a "(SV10)"-style
  // suffix that doesn't appear in the FAQ question text itself, so an
  // exact-name match is too brittle. From its <h3> through the next </div>
  // that closes that FAQ item.
  const h3Re = /<h3[^>]*>What is the most expensive [^<]*\?<\/h3>/;
  const h3Match = src.match(h3Re);
  if (!h3Match) return null;
  const start = h3Match.index;
  const closeDiv = src.indexOf('</div>', start);
  if (closeDiv === -1) return null;
  return { start, end: closeDiv, text: src.slice(start, closeDiv) };
}

function processFile(file) {
  const filePath = path.join(ROOT, file);
  let src = fs.readFileSync(filePath, 'utf8');
  const log = [];

  const canonicalMatch = src.match(/rel="canonical" href="https:\/\/tcgwatchtower\.com\/([^"]+)"/);
  if (!canonicalMatch) return { file, log: ['no canonical — skipped entirely'] };
  const basePath = canonicalMatch[1].replace(/\/(cards|card-list)$/, '');
  const tcExists = fs.existsSync(path.join(ROOT, basePath, 'top-chase-cards.html'));
  const spExists = fs.existsSync(path.join(ROOT, basePath, 'sealed-product.html'));

  const titleMatch = src.match(/<title>([^<]+)/);
  const setFullName = titleMatch
    ? titleMatch[1].split(' Card List')[0].replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';

  // ── 1. Revert nav buttons back to <button> + scroll, strip pushState ──
  const chaseAnchorRe = /<a class="section-nav-btn" href="([^"]+)">(<span class="nav-full">Chase Cards<\/span><span class="nav-short">Chase<\/span>)<\/a>/;
  const chaseA = src.match(chaseAnchorRe);
  if (chaseA) {
    src = src.replace(chaseAnchorRe, `<button class="section-nav-btn" data-target="section-chase" data-url="${chaseA[1]}">${chaseA[2]}</button>`);
    log.push('reverted Chase Cards nav button to scroll-only');
  }
  const sealedAnchorRe = /<a class="section-nav-btn" href="([^"]+)">(<span class="nav-full">Sealed Products<\/span><span class="nav-short">Sealed<\/span>)<\/a>/;
  const sealedA = src.match(sealedAnchorRe);
  if (sealedA) {
    src = src.replace(sealedAnchorRe, `<button class="section-nav-btn" data-target="section-products" data-url="${sealedA[1]}">${sealedA[2]}</button>`);
    log.push('reverted Sealed Products nav button to scroll-only');
  }
  const pushStateRe = /[ \t]*if\s*\(\s*btn\.dataset\.url\s*\)\s*history\.pushState\(\s*null\s*,\s*''\s*,\s*btn\.dataset\.url\s*\)\s*;\s*\n?/;
  if (pushStateRe.test(src)) {
    src = src.replace(pushStateRe, '');
    log.push('removed history.pushState() URL-faking line');
  }

  // ── 2. Inline link in the Sealed Products in-page section ──────────────
  if (spExists) {
    const spUrl = `${SITE_URL}/${basePath}/sealed-product`;
    const spHeaderRe = /(<section class="section" id="section-products">\s*<div class="container">\s*<div class="section-header">\s*<h2 class="section-title">[^<]*<span class="gradient-text">[^<]*<\/span><\/h2>\s*<p class="section-sub">[^<]*<\/p>)/;
    if (spHeaderRe.test(src) && !src.includes(`href="${spUrl}"`)) {
      src = src.replace(spHeaderRe, `$1\n      <a href="${spUrl}" style="display:inline-block;margin-top:6px;font-size:0.82rem;font-weight:700;color:#4ade80;text-decoration:none;">See the full ${setFullName} Sealed Product Buying Guide →</a>`);
      log.push('added inline Sealed Product Buying Guide link');
    } else if (src.includes(`href="${spUrl}"`)) {
      log.push('inline sealed-product link already present — skipped');
    } else {
      log.push('⚠️  section-products header pattern not matched — inline link NOT added');
    }
  }

  // ── 3. Inline link in the Chase Cards in-page section ───────────────────
  if (tcExists) {
    const tcUrl = `${SITE_URL}/${basePath}/top-chase-cards`;
    const chaseSection = extractSection(src, 'section-chase');
    if (!chaseSection) {
      log.push('⚠️  section-chase block not found — inline link NOT added');
    } else if (chaseSection.text.includes(`href="${tcUrl}"`)) {
      log.push('inline chase-cards link already present in section — skipped');
    } else {
      const headerRe = /(<div class="section-header">\s*<h2 class="section-title">[^<]*<span class="gradient-text">[^<]*<\/span><\/h2>\s*<p class="section-sub">[^<]*<\/p>)/;
      const headerMatch = chaseSection.text.match(headerRe);
      if (headerMatch) {
        const newSectionText = chaseSection.text.replace(headerRe, `$1\n      <a href="${tcUrl}" style="display:inline-block;margin-top:6px;font-size:0.82rem;font-weight:700;color:#4ade80;text-decoration:none;">See the full ${setFullName} Top Chase Cards list →</a>`);
        src = src.slice(0, chaseSection.start) + newSectionText + src.slice(chaseSection.end);
        log.push('added inline Top Chase Cards link');
      } else {
        log.push('⚠️  section-chase header pattern not matched — inline link NOT added');
      }
    }
  }

  // ── 4. Fill FAQ 'See all X chase cards' gap if missing ─────────────────
  if (tcExists) {
    const tcUrl = `${SITE_URL}/${basePath}/top-chase-cards`;
    const faqBlock = extractFaqBlock(src);
    if (!faqBlock) {
      log.push('⚠️  no matching FAQ question found — FAQ link NOT added');
    } else if (faqBlock.text.includes(`href="${tcUrl}"`)) {
      log.push('FAQ chase-cards link already present — skipped');
    } else {
      const newFaqText = faqBlock.text + `\n        <a href="${tcUrl}" style="display:inline-block;margin-top:10px;font-size:0.82rem;font-weight:700;color:#4ade80;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">See all ${setFullName} chase cards ranked by price →</a>\n      `;
      src = src.slice(0, faqBlock.start) + newFaqText + src.slice(faqBlock.end);
      log.push('added missing FAQ "See all chase cards" link');
    }
  }

  fs.writeFileSync(filePath, src);
  return { file, log };
}

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('-card-list.html') && !SKIP_FILES.has(f));
for (const file of files) {
  const result = processFile(file);
  console.log(`\n${file}:`);
  result.log.forEach(l => console.log(`  - ${l}`));
}
