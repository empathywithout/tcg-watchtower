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
    const [checklistKeys, binderKeys, dailyKeys] = await Promise.all([
      kvScan('downloads:checklist:*'),
      kvScan('downloads:binder:*'),
      kvScan('downloads:daily:*'),
    ]);

    const allValues = await Promise.all(
      [...checklistKeys, ...binderKeys, ...dailyKeys].map(async key => ({
        key,
        count: parseInt(await kv(`/get/${encodeURIComponent(key)}`)) || 0,
      }))
    );

    let totalXlsx = 0, totalCsv = 0;
    let totalBinder9 = 0, totalBinder12 = 0, totalBinder16 = 0;
    const bySet = {};
    const byBinderSet = {};
    const byDay = {};

    for (const { key, count } of allValues) {
      if (key.startsWith('downloads:checklist:')) {
        // downloads:checklist:{set}:{format}
        const parts = key.split(':');
        const setId  = parts[2];
        const format = parts[3];
        if (!bySet[setId]) bySet[setId] = { xlsx: 0, csv: 0, total: 0 };
        bySet[setId][format] = (bySet[setId][format] || 0) + count;
        bySet[setId].total += count;
        if (format === 'xlsx') totalXlsx += count;
        if (format === 'csv')  totalCsv  += count;

      } else if (key.startsWith('downloads:binder:')) {
        // downloads:binder:{set}:{size}
        const parts = key.split(':');
        const setId = parts[2];
        const size  = parseInt(parts[3], 10);
        if (!byBinderSet[setId]) byBinderSet[setId] = { s9: 0, s12: 0, s16: 0, total: 0 };
        const sizeKey = `s${size}`;
        byBinderSet[setId][sizeKey] = (byBinderSet[setId][sizeKey] || 0) + count;
        byBinderSet[setId].total += count;
        if (size === 9)  totalBinder9  += count;
        if (size === 12) totalBinder12 += count;
        if (size === 16) totalBinder16 += count;

      } else if (key.startsWith('downloads:daily:')) {
        const date = key.split(':')[2];
        byDay[date] = (byDay[date] || 0) + count;
      }
    }

    const sets = Object.entries(bySet)
      .map(([setId, counts]) => ({
        setId,
        name: SET_NAMES[setId] || setId,
        ...counts,
      }))
      .sort((a, b) => b.total - a.total);

    const binderSets = Object.entries(byBinderSet)
      .map(([setId, counts]) => ({
        setId,
        name: SET_NAMES[setId] || setId,
        ...counts,
      }))
      .sort((a, b) => b.total - a.total);

    const daily = Object.entries(byDay)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 30)
      .map(([date, count]) => ({ date, count }));

    const totalBinder = totalBinder9 + totalBinder12 + totalBinder16;
    const totalChecklist = totalXlsx + totalCsv;

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      totals: {
        all:       totalChecklist + totalBinder,
        checklist: totalChecklist,
        xlsx:      totalXlsx,
        csv:       totalCsv,
        binder:    totalBinder,
        binder9:   totalBinder9,
        binder12:  totalBinder12,
        binder16:  totalBinder16,
      },
      sets,
      binderSets,
      daily,
    });

  } catch (e) {
    console.error('[admin/downloads]', e);
    return res.status(500).json({ error: e.message });
  }
}
