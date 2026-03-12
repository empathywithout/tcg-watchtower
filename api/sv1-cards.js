export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const response = await fetch("https://api.tcgdex.net/v2/en/sets/sv1", {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      return res.status(502).json({ error: `TCGDex returned ${response.status}` });
    }

    const data = await response.json();

    // Normalize cards — attach full image URL to each card
    const cards = (data.cards || []).map(card => ({
      localId: card.localId,
      name: card.name,
      rarity: card.rarity || null,
      image: `https://assets.tcgdex.net/en/sv/sv1/${card.localId}/high.webp`
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ cards });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
