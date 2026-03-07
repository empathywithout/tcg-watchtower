export default async function handler(req, res) {
  const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
  const CHANNEL_ID = "1404576142802944020";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!DISCORD_TOKEN) {
    return res.status(500).json({ error: "Bot token not configured" });
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=8`,
      {
        headers: {
          Authorization: `Bot ${DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Discord API error: ${err}` });
    }

    const messages = await response.json();

    const alerts = messages
      .filter((msg) => {
        return (
          (msg.embeds && msg.embeds.length > 0) ||
          msg.content.toLowerCase().includes("restock") ||
          msg.content.toLowerCase().includes("in stock") ||
          msg.content.toLowerCase().includes("add to cart") ||
          msg.content.toLowerCase().includes("atc") ||
          msg.content.toLowerCase().includes("item restocked")
        );
      })
      .map((msg) => {
        if (msg.embeds && msg.embeds.length > 0) {
          const embed = msg.embeds[0];
          const fields = embed.fields || [];

          const getField = (names) => {
            const field = fields.find((f) =>
              names.some((n) => f.name.toLowerCase().includes(n.toLowerCase()))
            );
            return field ? field.value : null;
          };

          const footer = embed.footer?.text || "";
          const store = extractStore(
            footer + " " + (embed.description || "") + " " + msg.content
          );

          return {
            id: msg.id,
            title: embed.title || embed.description || "Item Restocked",
            sku: getField(["sku", "id", "item id"]),
            price: getField(["price"]),
            store,
            url: embed.url || getField(["link", "url", "atc", "add to cart"]),
            timeAgo: getTimeAgo(new Date(msg.timestamp)),
            emoji: getProductEmoji(embed.title || ""),
            image: embed.thumbnail?.url || embed.image?.url || null,
            _debug: { thumbnail: embed.thumbnail, image: embed.image, fields: embed.fields }
          };
        }
        return parseTextAlert(msg);
      })
      .filter(Boolean)
      .slice(0, 5);

    return res.status(200).json({ alerts });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function parseTextAlert(msg) {
  const text = msg.content;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const titleLine = lines.find(
    (l) =>
      !l.startsWith("SKU") &&
      !l.startsWith("Price") &&
      !l.startsWith("ATC") &&
      !l.match(/^\d+$/) &&
      l.length > 5
  );

  if (!titleLine) return null;

  const skuMatch = text.match(/SKU[:\s]*([A-Za-z0-9\-]+)/i);
  const priceMatch = text.match(/\$[\d,.]+/);
  const urlMatch = text.match(/https?:\/\/[^\s)>]+/);

  return {
    id: msg.id,
    title: titleLine.replace(/^[🎴📦🃏🎁🛒•]+\s*/, "").trim(),
    sku: skuMatch ? skuMatch[1] : null,
    price: priceMatch ? priceMatch[0] : null,
    store: extractStore(text),
    url: urlMatch ? urlMatch[0] : null,
    timeAgo: getTimeAgo(new Date(msg.timestamp)),
    emoji: getProductEmoji(titleLine),
  };
}

function extractStore(text) {
  const stores = [
    "Walmart", "Target", "Amazon", "Best Buy", "GameStop",
    "Pokemon Center", "Pokémon Center", "Hot Topic", "Costco", "Sam's Club",
  ];
  const lower = text.toLowerCase();
  return stores.find((s) => lower.includes(s.toLowerCase())) || "Retailer";
}

function getProductEmoji(title) {
  const t = title.toLowerCase();
  if (t.includes("booster") || t.includes("pack")) return "📦";
  if (t.includes("collection") || t.includes("box")) return "🎁";
  if (t.includes("tin")) return "🗄️";
  if (t.includes("sticker")) return "🎴";
  if (t.includes("etb") || t.includes("elite")) return "⭐";
  return "🎴";
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
