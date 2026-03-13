// api/cards.js — Vercel serverless function
// Generic for any set — call as /api/cards?set=sv1 or /api/cards?set=sv2 etc.
// Images are served from your Cloudflare R2 bucket — no external API dependency

const R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL; // e.g. https://pub-xxxx.r2.dev

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const setId = req.query.set;
  if (!setId) {
    return res.status(400).json({ error: "Missing ?set= parameter. Example: /api/cards?set=sv1" });
  }

  // Sanitize set ID — only allow alphanumeric and hyphens
  if (!/^[a-z0-9\-]+$/i.test(setId)) {
    return res.status(400).json({ error: "Invalid set ID" });
  }

  try {
    // Fetch card list from TCGdex (just metadata — no images from them)
    const response = await fetch(`https://api.tcgdex.net/v2/en/sets/${setId}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `TCGdex returned ${response.status} for set ${setId}` });
    }

    const data = await response.json();

    const cards = (data.cards || []).map(card => ({
      localId: card.localId,
      name: card.name,
      rarity: card.rarity || null,
      // Image served from YOUR Cloudflare R2 — fast, free, always works
      image: R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL}/cards/${setId}/${card.localId}.webp`
        : null,
    }));

    // Cache for 24 hours — card lists don't change
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      set: setId,
      count: cards.length,
      cards,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
