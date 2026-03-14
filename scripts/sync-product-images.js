// scripts/sync-product-images.js
// Fetches product images from eBay and uploads them to R2.
// Run this once per set, or whenever you update PRODUCT_META for a set.
//
// Usage:
//   SET_ID=sv01 node scripts/sync-product-images.js
//
// Reads PRODUCT_META from the generated HTML file for the set, or you can pass
// PRODUCT_META_JSON env var directly.
//
// Required env vars: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, CF_R2_*, CF_R2_PUBLIC_URL

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const SET_ID = process.env.SET_ID;
if (!SET_ID) { console.error('❌  SET_ID env var required'); process.exit(1); }

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});
const BUCKET = process.env.CF_R2_BUCKET;
const R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL;

async function getEbayToken() {
  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) throw new Error(`eBay auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function findBestEbayImage(token, query) {
  // Search with categoryId 183468 = Sealed TCG Products
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=20&filter=categoryIds:183468`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  if (!res.ok) throw new Error(`eBay search failed: ${res.status}`);
  const data = await res.json();
  const items = data.itemSummaries || [];

  // Prefer items whose title contains expected keywords (filter out random junk)
  const keywords = query.toLowerCase().split(' ');
  const scored = items
    .filter(item => item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl)
    .map(item => {
      const title = (item.title || '').toLowerCase();
      const score = keywords.filter(k => title.includes(k)).length;
      return { score, url: item.thumbnailImages?.[0]?.imageUrl || item.image?.imageUrl };
    })
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].url : null;
}

// Read PRODUCT_META from env or from the generated HTML
let productMeta = {};
if (process.env.PRODUCT_META_JSON) {
  productMeta = JSON.parse(process.env.PRODUCT_META_JSON);
} else {
  // Try to extract from the generated HTML file
  const slug = process.env.SET_SLUG || `${SET_ID}-card-list`;
  try {
    const html = readFileSync(`${slug}.html`, 'utf8');
    const m = html.match(/const PRODUCT_META = ({[\s\S]+?^});/m);
    if (m) {
      // Quick parse — extract ASINs and q values
      const asinMatches = [...html.matchAll(/'([A-Z0-9]{10})':\s*{[^}]*q:\s*'([^']+)'/g)];
      for (const [, asin, q] of asinMatches) {
        productMeta[asin] = { q };
      }
      console.log(`Found ${Object.keys(productMeta).length} products in ${slug}.html`);
    }
  } catch(e) {
    console.error(`Could not read ${slug}.html — pass PRODUCT_META_JSON instead`);
    process.exit(1);
  }
}

if (Object.keys(productMeta).length === 0) {
  console.log('No products found, nothing to do.');
  process.exit(0);
}

console.log(`\n🖼️  Syncing ${Object.keys(productMeta).length} product images for ${SET_ID}...\n`);
const token = await getEbayToken();

for (const [asin, p] of Object.entries(productMeta)) {
  const r2Key = `products/${SET_ID}/${asin}.jpg`;
  try {
    // Skip if already uploaded
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }));
    console.log(`  ✅  ${asin} — already in R2`);
    console.log(`     ${R2_PUBLIC_URL}/${r2Key}`);
    continue;
  } catch {}

  try {
    console.log(`  🔍  ${asin} — searching eBay for: "${p.q}"`);
    const imgUrl = await findBestEbayImage(token, p.q);
    if (!imgUrl) { console.warn(`  ⚠️  No image found for ${asin}`); continue; }

    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`download failed: ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: r2Key, Body: buffer,
      ContentType: imgRes.headers.get('content-type') || 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    console.log(`  ✅  ${asin} — uploaded`);
    console.log(`     ${R2_PUBLIC_URL}/${r2Key}`);
  } catch(e) {
    console.error(`  ❌  ${asin} — ${e.message}`);
  }
}

console.log('\n✨  Done. Run the generate-set-page.js to bake the R2 URLs into the HTML.');
