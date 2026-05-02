// api/giveaway/upload.js
// Uploads images to Cloudflare R2 using fetch (no SDK — avoids ESM conflicts)

export const config = { api: { bodyParser: false } };

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
        parts.push({ name: nameMatch?.[1], filename: filenameMatch?.[1], contentType: ctMatch?.[1], data });
        start = end + boundaryBuf.length + 2;
      }
      resolve(parts);
    });
    req.on("error", reject);
  });
}

// AWS Signature V4 for R2 using only built-in crypto
import { createHmac, createHash } from "crypto";

function sign(key, msg) {
  return createHmac("sha256", key).update(msg).digest();
}
function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function getSignedHeaders(method, bucket, key, body, contentType, accessKey, secretKey, endpoint) {
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const region = "auto";
  const service = "s3";

  const payloadHash = sha256hex(body);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, `/${bucket}/${key}`, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");

  const signingKey = sign(sign(sign(sign(Buffer.from("AWS4" + secretKey), dateStamp), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, amzDate, payloadHash };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = getSession(req);
  if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });

  const endpoint = process.env.CF_R2_ENDPOINT;
  const accessKey = process.env.CF_R2_ACCESS_KEY;
  const secretKey = process.env.CF_R2_SECRET_KEY;
  const bucket = process.env.CF_R2_BUCKET;
  const publicUrl = process.env.CF_R2_PUBLIC_URL;

  if (!endpoint || !accessKey || !secretKey || !bucket) {
    return res.status(500).json({ error: "R2 credentials not configured", missing: { endpoint: !endpoint, accessKey: !accessKey, secretKey: !secretKey, bucket: !bucket } });
  }

  try {
    const parts = await parseMultipart(req);
    const filePart = parts.find(p => p.filename);
    if (!filePart) return res.status(400).json({ error: "No file found" });

    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(filePart.contentType)) {
      return res.status(400).json({ error: "Invalid file type. Use JPG, PNG, GIF, or WebP." });
    }

    const ext = filePart.filename.split(".").pop().toLowerCase();
    const pool = parts.find(p => p.name === "pool")?.data.toString().trim() || "regular";
    const r2Key = `giveaway/${pool}-prize-${Date.now()}.${ext}`;

    const { authorization, amzDate, payloadHash } = getSignedHeaders(
      "PUT", bucket, r2Key, filePart.data, filePart.contentType, accessKey, secretKey, endpoint
    );

    const uploadRes = await fetch(`${endpoint}/${bucket}/${r2Key}`, {
      method: "PUT",
      headers: {
        "Content-Type": filePart.contentType,
        "Authorization": authorization,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
      },
      body: filePart.data,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return res.status(500).json({ error: "R2 upload failed", detail: errText });
    }

    const fileUrl = `${publicUrl?.replace(/\/$/, "")}/${r2Key}`;
    return res.json({ success: true, url: fileUrl });

  } catch (e) {
    console.error("Upload error:", e);
    return res.status(500).json({ error: "Upload failed", detail: e.message });
  }
}
