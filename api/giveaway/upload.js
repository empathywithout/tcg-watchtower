// api/giveaway/upload.js
// Accepts a multipart image upload, stores it in R2, returns the public URL

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const config = { api: { bodyParser: false } };

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.CF_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CF_R2_ACCESS_KEY,
    secretAccessKey: process.env.CF_R2_SECRET_KEY,
  },
});

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/gw_session=([^;]+)/);
  if (!match) return null;
  try { return JSON.parse(Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf8")); }
  catch { return null; }
}

function isAdmin(session) {
  if (!session) return false;
  const adminIds = (process.env.ADMIN_DISCORD_IDS || "").split(",").map(s => s.trim());
  return adminIds.includes(session.userId);
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return reject(new Error("No boundary"));

      const boundaryBuf = Buffer.from("--" + boundary);
      const parts = [];
      let start = body.indexOf(boundaryBuf) + boundaryBuf.length + 2;

      while (start < body.length) {
        const end = body.indexOf(boundaryBuf, start);
        if (end === -1) break;
        const part = body.slice(start, end - 2);
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) { start = end + boundaryBuf.length + 2; continue; }

        const headerStr = part.slice(0, headerEnd).toString();
        const data = part.slice(headerEnd + 4);

        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        const ctMatch = headerStr.match(/Content-Type: ([^\r\n]+)/);

        parts.push({
          name: nameMatch?.[1],
          filename: filenameMatch?.[1],
          contentType: ctMatch?.[1],
          data,
        });
        start = end + boundaryBuf.length + 2;
      }
      resolve(parts);
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = getSession(req);
  if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });

  try {
    const parts = await parseMultipart(req);
    const filePart = parts.find(p => p.filename);
    if (!filePart) return res.status(400).json({ error: "No file found" });

    // Validate image type
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(filePart.contentType)) {
      return res.status(400).json({ error: "Invalid file type. Use JPG, PNG, GIF, or WebP." });
    }

    // Build R2 key
    const ext = filePart.filename.split(".").pop().toLowerCase();
    const pool = parts.find(p => p.name === "pool")?.data.toString().trim() || "regular";
    const key = `giveaway/${pool}-prize-${Date.now()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.CF_R2_BUCKET,
      Key: key,
      Body: filePart.data,
      ContentType: filePart.contentType,
    }));

    const publicUrl = `${process.env.CF_R2_PUBLIC_URL}/${key}`;
    return res.json({ success: true, url: publicUrl });

  } catch (e) {
    console.error("Upload error:", e);
    return res.status(500).json({ error: "Upload failed", detail: e.message });
  }
}
