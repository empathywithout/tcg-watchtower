#!/usr/bin/env node
/**
 * Upload a local logo file directly to R2.
 * Usage: SET_ID=sv05 LOGO_FILE=scripts/sv05-logo.png node scripts/upload-logo.js
 */

const fs = require('fs');
const path = require('path');

const {
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
} = process.env;

const SET_ID    = process.env.SET_ID;
const LOGO_FILE = process.env.LOGO_FILE;

if (!SET_ID || !LOGO_FILE) {
  console.error('Usage: SET_ID=sv05 LOGO_FILE=scripts/sv05-logo.png node scripts/upload-logo.js');
  process.exit(1);
}
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 credentials in environment');
  process.exit(1);
}

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function main() {
  const logoPath = path.resolve(LOGO_FILE);
  if (!fs.existsSync(logoPath)) {
    console.error(`File not found: ${logoPath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(logoPath);
  const ext = path.extname(logoPath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const r2Key = `logos/${SET_ID}.png`;

  console.log(`📤 Uploading ${logoPath} → R2 at ${r2Key} ...`);

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    Body: buffer,
    ContentType: contentType,
  }));

  const publicUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}` : r2Key;
  console.log(`✅ Logo uploaded successfully!`);
  console.log(`🌐 Public URL: ${publicUrl}`);
}

main().catch(err => { console.error('❌ Upload failed:', err.message); process.exit(1); });
