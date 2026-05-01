// api/giveaway/entries.js
// GET  ?action=list              → list all entries (admin only)
// GET  ?action=status&uid=XXX   → check if a user has entered
// GET  ?action=count             → public entry count
// POST ?action=enter             → submit an entry (requires session)
// POST ?action=pick              → pick winner(s) (admin only)
// POST ?action=export            → export CSV (admin only)

import fs from "fs";
import path from "path";

const DATA_FILE = "/tmp/giveaway.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ active: true, entries: [], winners: [] }));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/gw_session=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isAdmin(session) {
  if (!session) return false;
  const adminIds = (process.env.ADMIN_DISCORD_IDS || "").split(",").map((s) => s.trim());
  return adminIds.includes(session.userId);
}

function buildCsv(entries) {
  const header = "userId,username,displayName,joinedServer,joinedDiscord,isPremium,enteredAt";
  const rows = entries.map((e) =>
    [
      e.userId,
      `"${e.username}"`,
      `"${e.displayName}"`,
      e.joinedServer || "",
      e.joinedDiscord || "",
      e.isPremium,
      e.enteredAt,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

export default async function handler(req, res) {
  const action = req.query.action;
  const session = getSession(req);
  const data = loadData();

  // ── GET: public count ──────────────────────────────────────────────────────
  if (req.method === "GET" && action === "count") {
    return res.json({
      count: data.entries.length,
      active: data.active,
      prize: data.prize || null,
    });
  }

  // ── GET: check if user entered ─────────────────────────────────────────────
  if (req.method === "GET" && action === "status") {
    const uid = req.query.uid;
    const entered = data.entries.some((e) => e.userId === uid);
    return res.json({ entered });
  }

  // ── GET: list all entries (admin) ──────────────────────────────────────────
  if (req.method === "GET" && action === "list") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    return res.json({ entries: data.entries, winners: data.winners, prize: data.prize, active: data.active });
  }

  // ── POST: enter giveaway ───────────────────────────────────────────────────
  if (req.method === "POST" && action === "enter") {
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (!data.active) return res.status(400).json({ error: "Giveaway is not active" });

    if (data.entries.some((e) => e.userId === session.userId)) {
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

    return res.json({ success: true, entry });
  }

  // ── POST: set prize / toggle active (admin) ────────────────────────────────
  if (req.method === "POST" && action === "configure") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (body.prize !== undefined) data.prize = body.prize;
    if (body.active !== undefined) data.active = body.active;
    if (body.reset) { data.entries = []; data.winners = []; }
    saveData(data);
    return res.json({ success: true });
  }

  // ── POST: pick winner(s) (admin) ───────────────────────────────────────────
  if (req.method === "POST" && action === "pick") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const count = parseInt(body.count || "1", 10);

    if (data.entries.length === 0) return res.status(400).json({ error: "No entries" });

    const shuffled = [...data.entries].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(count, shuffled.length));
    data.winners = winners;
    data.active = false;
    saveData(data);

    return res.json({ winners });
  }

  // ── POST: export CSV (admin) ───────────────────────────────────────────────
  if (req.method === "GET" && action === "export") {
    if (!isAdmin(session)) return res.status(403).json({ error: "Forbidden" });
    const csv = buildCsv(data.entries);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="giveaway-entries.csv"`);
    return res.send(csv);
  }

  return res.status(400).json({ error: "Unknown action" });
}
