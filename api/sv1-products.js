import crypto from "crypto";

const ACCESS_KEY = process.env.AMAZON_ACCESS_KEY || "AKPAJ5PCA61773328287";
const SECRET_KEY = process.env.AMAZON_SECRET_KEY || "R79F3Tadbj3K4vkOkUZZEqBrmkOJYKnAHFegz38W";
const ASSOCIATE_TAG = process.env.AMAZON_ASSOCIATE_TAG || "cehutto01-20";
const REGION = "us-east-1";
const SERVICE = "ProductAdvertisingAPI";
const HOST = "webservices.amazon.com";
const PATH = "/paapi5/getitems";

// Known SV1 ASINs
const SV1_PRODUCTS = [
  { asin: "B0BVK3Y82T", type: "Booster Box",       filterKey: "box",        name: "Scarlet & Violet Booster Box (36 Packs)" },
  { asin: "B0BVHHTK8Z", type: "Elite Trainer Box",  filterKey: "etb",        name: "Scarlet & Violet Elite Trainer Box" },
  { asin: "B0BVK3TNJQ", type: "Booster Bundle",     filterKey: "bundle",     name: "Scarlet & Violet 6-Pack Booster Bundle" },
  { asin: "B0BVK3VNJB", type: "Booster Box Case",   filterKey: "case",       name: "Scarlet & Violet Booster Box Case (6 Boxes)" },
  { asin: "B0BVHHTSWB", type: "Special Collection",  filterKey: "collection", name: "Koraidon ex & Miraidon ex Special Collection" },
  { asin: "B0BVHHTVNF", type: "Build & Battle Box",  filterKey: "battle",    name: "Scarlet & Violet Build & Battle Box" },
];

function sign(key, msg) {
  return crypto.createHmac("sha256", key).update(msg).digest();
}

function getSignatureKey(key, dateStamp, region, service) {
  const kDate    = sign(Buffer.from("AWS4" + key, "utf8"), dateStamp);
  const kRegion  = sign(kDate, region);
  const kService = sign(kRegion, service);
  const kSigning = sign(kService, "aws4_request");
  return kSigning;
}

function pad(n) { return n < 10 ? "0" + n : n; }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z";
    const dateStamp = amzDate.slice(0, 8);

    const payload = JSON.stringify({
      ItemIds: SV1_PRODUCTS.map(p => p.asin),
      Resources: [
        "Images.Primary.Large",
        "Images.Primary.Medium",
        "ItemInfo.Title"
      ],
      PartnerTag: ASSOCIATE_TAG,
      PartnerType: "Associates",
      Marketplace: "www.amazon.com"
    });

    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

    const headers = {
      "content-encoding": "amz-1.0",
      "content-type": "application/json; charset=utf-8",
      "host": HOST,
      "x-amz-date": amzDate,
      "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems"
    };

    const sortedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaders.map(k => `${k}:${headers[k]}\n`).join("");
    const signedHeaders = sortedHeaders.join(";");

    const canonicalRequest = [
      "POST",
      PATH,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");

    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex")
    ].join("\n");

    const signingKey = getSignatureKey(SECRET_KEY, dateStamp, REGION, SERVICE);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authHeader = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(`https://${HOST}${PATH}`, {
      method: "POST",
      headers: { ...headers, "Authorization": authHeader },
      body: payload
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Amazon PA-API ${response.status}`, detail: errText });
    }

    const data = await response.json();
    const itemMap = {};
    for (const item of (data.ItemsResult?.Items || [])) {
      itemMap[item.ASIN] = {
        image: item.Images?.Primary?.Large?.URL || item.Images?.Primary?.Medium?.URL || null,
        title: item.ItemInfo?.Title?.DisplayValue || null,
        url: `https://www.amazon.com/dp/${item.ASIN}?tag=${ASSOCIATE_TAG}`
      };
    }

    const products = SV1_PRODUCTS.map(p => ({
      ...p,
      image: itemMap[p.asin]?.image || null,
      amazonUrl: itemMap[p.asin]?.url || `https://www.amazon.com/dp/${p.asin}?tag=${ASSOCIATE_TAG}`
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({ products });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
