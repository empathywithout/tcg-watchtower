// api/admin/scrydex-expansions-jp.js
// Lists Scrydex JA (Japanese) expansion IDs — owner only, for debugging.
// Companion to scrydex-expansions.js (which only shows EN sets).
//
// Usage: log in to tcgwatchtower.com as owner, then visit in your browser:
//   /api/admin/scrydex-expansions-jp?q=Abyss
// Omit ?q= to see all JA expansions (raw JP name + English translation).

import { verifySession } from '../auth/_verify.js';

const OWNER_ID = '397593147397636099';
const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

export default async function handler(req, res) {
  const user = await verifySession(req);
  if (!user || user.id !== OWNER_ID) return res.status(401).json({ error: 'Unauthorized' });

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  const { q } = req.query;

  try {
    // Raw JP expansion names are in Japanese script under the plain /expansions
    // endpoint, so an English search term never matches there. The /ja/ prefix
    // (same one used for JP card pricing elsewhere) exposes an English
    // translation field alongside the raw name — pull both.
    let allExpansions = [];
    let page = 1;
    while (true) {
      const r = await fetch(
        `${SCRYDEX_BASE}/ja/expansions?page_size=100&page=${page}&select=id,name,translation,series,release_date`,
        { headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID }, signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) break;
      const data = await r.json();
      const rows = data.data || [];
      allExpansions = allExpansions.concat(rows);
      if (rows.length === 0 || rows.length < 100) break;
      page++;
      if (page > 20) break; // safety cap
    }

    const term = (q || '').toLowerCase().trim();
    const sets = allExpansions
      .map(e => ({
        id: e.id,
        name: e.name,
        nameEn: e.translation?.en?.name || null,
        series: e.series,
        release_date: e.release_date,
      }))
      .filter(e => !term || (e.nameEn || '').toLowerCase().includes(term) || (e.name || '').toLowerCase().includes(term));

    return res.status(200).json({ sets, total: sets.length, totalExpansionsScanned: allExpansions.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
