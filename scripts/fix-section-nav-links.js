// scripts/fix-section-nav-links.js
//
// Bug: the 'Chase Cards' and 'Sealed Products' buttons in the section nav
// bar on every *-card-list.html page use history.pushState() to fake-change
// the URL to /top-chase-cards or /sealed-product while just scrolling to an
// in-page section — the real page never loads until the user manually
// refreshes. Converts those <button data-url="..."> elements into real
// <a href="..."> elements so clicking them actually navigates there.
//
// Only converts a button if the destination page actually exists on disk
// (checked per file, not assumed) — sets missing top-chase-cards.html (the
// 4 One Piece sets, as of this run) keep the old pushState/scroll behavior
// for that button rather than linking to a 404.
//
// Usage: node scripts/fix-section-nav-links.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_FILES = new Set(['fates-card-listtemporal-forces-card-list.html']);

function fixFile(file) {
  const filePath = path.join(ROOT, file);
  let src = fs.readFileSync(filePath, 'utf8');

  const canonicalMatch = src.match(/rel="canonical" href="https:\/\/tcgwatchtower\.com\/([^"]+)"/);
  if (!canonicalMatch) return { file, changed: 0, reason: 'no canonical' };
  const canonPath = canonicalMatch[1];
  const basePath = canonPath.replace(/\/(cards|card-list)$/, '');

  let changed = 0;

  // Chase Cards button — only convert if top-chase-cards.html actually exists
  const tcExists = fs.existsSync(path.join(ROOT, basePath, 'top-chase-cards.html'));
  const chaseBtnRe = /<button class="section-nav-btn" data-target="section-chase" data-url="([^"]+)">(<span class="nav-full">Chase Cards<\/span><span class="nav-short">Chase<\/span>)<\/button>/;
  const chaseMatch = src.match(chaseBtnRe);
  if (chaseMatch && tcExists) {
    src = src.replace(chaseBtnRe, `<a class="section-nav-btn" href="${chaseMatch[1]}">${chaseMatch[2]}</a>`);
    changed++;
  }

  // Sealed Products button — sealed-product.html exists for all 26 as of this run
  const spExists = fs.existsSync(path.join(ROOT, basePath, 'sealed-product.html'));
  const sealedBtnRe = /<button class="section-nav-btn" data-target="section-products" data-url="([^"]+)">(<span class="nav-full">Sealed Products<\/span><span class="nav-short">Sealed<\/span>)<\/button>/;
  const sealedMatch = src.match(sealedBtnRe);
  if (sealedMatch && spExists) {
    src = src.replace(sealedBtnRe, `<a class="section-nav-btn" href="${sealedMatch[1]}">${sealedMatch[2]}</a>`);
    changed++;
  }

  if (changed > 0) fs.writeFileSync(filePath, src);
  return { file, changed, tcExists, spExists };
}

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('-card-list.html') && !SKIP_FILES.has(f));
let totalChanged = 0;
for (const file of files) {
  const result = fixFile(file);
  console.log(`${result.changed > 0 ? '✅' : '⚠️ '} ${file}: ${result.changed} link(s) fixed${result.reason ? ` (${result.reason})` : ''}${result.tcExists === false ? ' [no top-chase-cards.html — left as-is]' : ''}`);
  totalChanged += result.changed;
}
console.log(`\n${totalChanged} nav links converted across ${files.length} files.`);
