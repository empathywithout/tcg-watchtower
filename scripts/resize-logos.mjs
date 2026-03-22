#!/usr/bin/env node
/**
 * resize-logos.mjs
 * Downloads all logos from R2, resizes to max 300px wide WebP, re-uploads with cache headers
 */
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});
const BUCKET = process.env.CF_R2_BUCKET;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  console.log('📦 Listing logos in R2...');
  
  // List all logos
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'logos/' }));
  const logos = (listed.Contents || []).filter(obj => obj.Key.endsWith('.png') || obj.Key.endsWith('.webp'));
  console.log(`Found ${logos.length} logo files`);

  let resized = 0, skipped = 0, failed = 0;

  for (const obj of logos) {
    const key = obj.Key;
    try {
      // Download
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const buf = await streamToBuffer(res.Body);
      
      // Check current size
      const meta = await sharp(buf).metadata();
      const currentSize = buf.length;
      
      // Resize to max 300px wide, convert to WebP
      const resized_buf = await sharp(buf)
        .resize(300, null, { fit: 'inside', withoutEnlargement: false })
        .webp({ quality: 85 })
        .toBuffer();
      
      // Upload with WebP key (replace .png with .webp, or keep same key)
      const newKey = key.replace(/\.(png|webp)$/, '.png'); // keep as .png for compatibility
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: newKey,
        Body: resized_buf,
        ContentType: 'image/webp', // serve as webp even with .png extension
        CacheControl: 'public, max-age=2592000, immutable', // 30 days
      }));
      
      const savings = ((currentSize - resized_buf.length) / currentSize * 100).toFixed(0);
      console.log(`✅ ${key}: ${(currentSize/1024).toFixed(0)}KB → ${(resized_buf.length/1024).toFixed(0)}KB (${savings}% smaller)`);
      resized++;
    } catch(e) {
      console.warn(`❌ ${key}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n🎉 Done — ${resized} resized, ${skipped} skipped, ${failed} failed`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
