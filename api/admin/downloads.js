// api/admin/downloads.js
// Owner-only endpoint — returns download stats from Redis/KV
import { verifySession } from '../auth/_verify.js';

const OWNER_ID = '397593147397636099';
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const SET_NAMES = {
  'sv01':'Scarlet & Violet Base Set','sv02':'Paldea Evolved','sv03':'Obsidian Flames',
  'sv3pt5':'Pokemon 151','sv04':'Paradox Rift','sv4pt5':'Paldean Fates',
  'sv05':'Temporal Forces','sv06':'Twilight Masquerade','sv6pt5':'Shrouded Fable',
  'sv07':'Stellar Crown','sv08':'Surging Sparks','sv8pt5':'Prismatic Evolutions',
  'sv09':'Journey Together','sv10':'Destined Rivals',
  'zsv10pt5':'Black Bolt','rsv10pt5':'White Flare',
  'me01':'Mega Evolution','me02':'Phantasmal Flames','me02pt5':'Ascended Heroes',
  'me03':'Perfect Order','me04':'Chaos Rising','me05':'Pitch Black',
};

async function kv(path) {
  const res = await fetch(`${KV_URL}${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) return null;
  const { result } = await res.json();
  return result;
}

async function kvScan(match) {
  let cursor = 0;
  const keys = [];
  do {
    const res = await fetch(`${KV_URL}/scan/${cursor}?match=${encodeURIComponent(match)}&count=200`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const { result } = await res.json();
    cursor = parseInt(result[0]);
    keys.push(...(result[1] || []));
  } while (cursor !== 0);
  return keys;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const user = await verifySession(req);
  if (!user || user.id !== OWNER_ID) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Scan all download keys: downloads:checklist:{set}:{format} and daily keys
    const [allKeys, dailyKeys] = await Promise.all([
      kvScan('downloads:checklist:*'),
      kvScan('downloads:daily:*'),
    ]);

    // Fetch all counts in parallel
    const allValues = await Promise.all(
      [...allKeys, ...dailyKeys].map(async key => ({
        key,
        count: parseInt(await kv(`/get/${encodeURIComponent(key)}`)) || 0,
      }))
    );

    // Aggregate
    let totalXlsx = 0, totalCsv = 0;
    const bySet = {};
    const byDay = {};

    for (const { key, count } of allValues) {
      if (key.startsWith('downloads:checklist:')) {
        // downloads:checklist:{set}:{format}
        const parts = key.split(':');
        const setId = parts[2];
        const format = parts[3]; // xlsx or csv
        if (!bySet[setId]) bySet[setId] = { xlsx: 0, csv: 0, total: 0 };
        bySet[setId][format] = (bySet[setId][format] || 0) + count;
        bySet[setId].total += count;
        if (format === 'xlsx') totalXlsx += count;
        if (format === 'csv')  totalCsv  += count;
      } else if (key.startsWith('downloads:daily:')) {
        // downloads:daily:{YYYY-MM-DD}
        const date = key.split(':')[2];
        byDay[date] = (byDay[date] || 0) + count;
      }
    }

    // Sort sets by total desc
    const sets = Object.entries(bySet)
      .map(([setId, counts]) => ({
        setId,
        name: SET_NAMES[setId] || setId,
        ...counts,
      }))
      .sort((a, b) => b.total - a.total);

    // Sort daily by date
    const daily = Object.entries(byDay)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 30)
      .map(([date, count]) => ({ date, count }));

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      totals: {
        all:  totalXlsx + totalCsv,
        xlsx: totalXlsx,
        csv:  totalCsv,
      },
      sets,
      daily,
    });

  } catch (e) {
    console.error('[admin/downloads]', e);
    return res.status(500).json({ error: e.message });
  }
}
