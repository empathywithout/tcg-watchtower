import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = process.env;
const SET_ID    = process.env.SET_ID;
const LOGO_FILE = process.env.LOGO_FILE;

if (!SET_ID || !LOGO_FILE) { console.error('Missing SET_ID or LOGO_FILE'); process.exit(1); }
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) { console.error('Missing R2 credentials'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const logoPath = path.resolve(__dirname, '..', LOGO_FILE);
if (!fs.existsSync(logoPath)) { console.error(`File not found: ${logoPath}`); process.exit(1); }

const buffer = fs.readFileSync(logoPath);
const contentType = path.extname(logoPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const r2Key = `logos/${SET_ID}.png`;

console.log(`📤 Uploading → R2 at ${r2Key} ...`);
await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, Body: buffer, ContentType: contentType }));
const publicUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}` : r2Key;
console.log(`✅ Done! ${publicUrl}`);
