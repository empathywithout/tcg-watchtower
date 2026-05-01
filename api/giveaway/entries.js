// api/giveaway/entries.js
// Dual giveaway: regular (weighted: free=1, premium=5) + premium pool (premium only)

import fs from "fs";

const DATA_FILE = "/tmp/giveaway.json";
const PREMIUM_WEIGHT = 5;

const DEFAULT_DATA = {
  active: false,
  prize: "",
  premiumPrize: "",
  entries: [],
  winners: [],
  premiumWinners: [],
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
    }
  } catch {}
  return { ...DEFAULT_DATA };
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("saveData error:", e); }
}

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

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Weighted pick without replacement — premium members get PREMIUM_WEIGHT tickets each
function weightedPick(entries, count) {
  const pool = [];
  for (const entry of entries) {
    const tickets = entry.isPremium ? PREMIUM_WEIGHT : 1;
    for (let i = 0; i < tickets; i++) pool.push(entry);
  }
  const shuffled = shuffle(pool);
  const winners = [];
  const picked = new Set();
  for (const ticket of shuffled) {
    if (!picked.has(ticket.userId)) {
      winners.push(ticket);
      picked.add(ticket.userId);
    }
    if (winners.length >= count) break;
  }
  return winners;
}

function buildCsv(entries, pool = "all") {
  const filtered = pool === "premium" ? entries.filter(e => e.isPremium) : entries;
  const header = "userId,username,displayName,joinedServer,joinedDiscord,isPremium,tickets,enteredAt";
  const rows = filtered.map(e => [
    e.userId,
    `"${(e.username || "").replace(/"/g, '""')}"`,
    `"${(e.displayName || "").replace(/"/g, '""')}"`,
    e.joinedServer || "",
    e.joinedDiscord || "",
    e.isPremium,
    e.isPremium ? PREMIUM_WEIGHT : 1,
    e.enteredAt,
  ].join(","));
  return [header, ...rows].join("\n");
}

export default async function handler(req, res) {
  const action = req.query.action;
  const session = getSession(req);
  const data = loadData();

  // GET: public count
  if (req.method === "GET" && action === "count") {
    const premiumCount = data.entries.filter(e => e.isPremium).length;
    return res.json({
      count: data.entries.length,
      premiumCount,
      active: data.active,
      prize: data.prize || null,
      premiumPrize: data.premiumPrize || null,
    });
  }

  // GET: check if user entered
  if (req.method === "GET" && action === "status") {
    const entered = data.entries.some(e => e.userId === req.query.uid);
    return res.json({ entered });
  }

  // GET: list all entries (admin)
  if (req.method === "GET" && action === "list") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    return res.json({
      entries: data.entries,
      winners: data.winners || [],
      premiumWinners: data.premiumWinners || [],
      prize: data.prize,
      premiumPrize: data.premiumPrize,
      active: data.active,
      premiumWeight: PREMIUM_WEIGHT,
    });
  }

  // POST: enter giveaway
  if (req.method === "POST" && action === "enter") {
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (!data.active) return res.status(400).json({ error: "Giveaway is not active" });
    if (data.entries.some(e => e.userId === session.userId)) {
      return res.status(400).json({ error: "Already entered" });
    }

    const entry = {
      userId: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatar: session.avatar,
      joinedServer: session.joinedServer,
      joinedDiscord: session.joinedDiscord,
      isPremium: session.isPremium,
      roles: session.roles,
      enteredAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    saveData(data);
    return res.json({ success: true, entry, enteredPremium: session.isPremium });
  }

  // POST: configure (admin)
  if (req.method === "POST" && action === "configure") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (body.prize !== undefined) data.prize = body.prize;
    if (body.premiumPrize !== undefined) data.premiumPrize = body.premiumPrize;
    if (body.active !== undefined) data.active = body.active;
    if (body.reset) { data.entries = []; data.winners = []; data.premiumWinners = []; data.active = true; }
    saveData(data);
    return res.json({ success: true });
  }

  // POST: pick winners (admin)
  if (req.method === "POST" && action === "pick") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const count = parseInt(body.count || "1", 10);
    const premiumCount = parseInt(body.premiumCount || "1", 10);

    if (data.entries.length === 0) return res.status(400).json({ error: "No entries" });

    // Regular pool — weighted (free=1 ticket, premium=5 tickets)
    const winners = weightedPick(data.entries, count);

    // Premium pool — unweighted, premium members only
    const premiumEntries = data.entries.filter(e => e.isPremium);
    const premiumWinners = premiumEntries.length > 0
      ? shuffle(premiumEntries).slice(0, Math.min(premiumCount, premiumEntries.length))
      : [];

    data.winners = winners;
    data.premiumWinners = premiumWinners;
    data.active = false;
    saveData(data);

    return res.json({ winners, premiumWinners });
  }

  // GET: export CSV (admin)
  if (req.method === "GET" && action === "export") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const pool = req.query.pool || "all";
    const csv = buildCsv(data.entries, pool);
    const filename = pool === "premium" ? "premium-entries.csv" : "all-entries.csv";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  return res.status(400).json({ error: "Unknown action" });
}
