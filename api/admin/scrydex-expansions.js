// api/admin/scrydex-expansions.js
// Lists all Scrydex expansion IDs — owner only, for debugging

import { verifySession } from '../auth/_verify.js';

const OWNER_ID = '397593147397636099';
const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

export default async function handler(req, res) {
  const user = await verifySession(req);
  if (!user || user.id !== OWNER_ID) return res.status(401).json({ error: 'Unauthorized' });

  const r = await fetch(`${SCRYDEX_BASE}/expansions?page_size=100&select=id,name,series,language_code`, {
    headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
  });
  const data = await r.json();
  // Filter to EN Pokémon sets
  const sets = (data.data || [])
    .filter(e => e.language_code === 'EN')
    .map(e => ({ id: e.id, name: e.name, series: e.series }));
  return res.status(200).json({ sets, total: sets.length });
}
