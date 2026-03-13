// api/cards.js — Vercel serverless function
// Serves card data from your Cloudflare R2 JSON file (includes rarity, correct counts)
// Run the GitHub Action sync first to populate R2 before this will work

const R2_PUBLIC_URL = process.env.CF_R2_PUBLIC_URL;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const setId = req.query.set;
  if (!setId || !/^[a-z0-9\-]+$/i.test(setId)) {
    return res.status(400).json({ error: "Missing or invalid ?set= parameter" });
  }

  if (!R2_PUBLIC_URL) {
    return res.status(500).json({ error: "CF_R2_PUBLIC_URL environment variable not set" });
  }

  try {
    // Fetch the pre-built metadata JSON from R2 — includes rarity and correct card counts
    const r2Url = `${R2_PUBLIC_URL}/data/${setId}.json`;
    const response = await fetch(r2Url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({
        error: `Could not load set data for "${setId}" — have you run the sync Action yet?`,
        r2Url,
      });
    }

    const metadata = await response.json();

    // Replace image URLs with your R2 image URLs
    const cards = (metadata.cards || []).map(card => ({
      localId: card.localId,
      name: card.name,
      rarity: card.rarity || null,
      image: `${R2_PUBLIC_URL}/cards/${setId}/${card.localId}.webp`,
    }));

    // Cache aggressively — data never changes once synced
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      set: setId,
      name: metadata.name || setId,
      cardCount: metadata.cardCount || { official: cards.length, total: cards.length },
      cards,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
