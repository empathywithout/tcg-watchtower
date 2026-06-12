// TEMPORARY DEBUG VERSION - api/portfolio/card-price.js
// Add &debug=1 to see the raw Scrydex response structure

const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';
const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';

const SCRYDEX_EN_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10',
  'me01':'me1','me02':'me2','me02pt5':'me2.5','me03':'me3',
  'me04':'me4','me05':'me5',
  'zsv10pt5':'zsv10pt5','rsv10pt5':'rsv10pt5',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const setId   = (req.query.set     || '').trim();
  const localId = (req.query.localId || '').trim();
  const debug   = req.query.debug === '1';

  const scrydexExpansion = SCRYDEX_EN_ID_MAP[setId];
  if (!scrydexExpansion) return res.status(404).json({ error: `No mapping for ${setId}` });

  const scrydexCardId = `${scrydexExpansion}-${localId}`;

  try {
    const url = `${SCRYDEX_BASE}/cards/${scrydexCardId}?include=prices`;
    const scrydexRes = await fetch(url, {
      headers: { 'X-Api-Key': SCRYDEX_API_KEY, 'X-Team-ID': SCRYDEX_TEAM_ID },
      signal: AbortSignal.timeout(10000),
    });

    if (!scrydexRes.ok) {
      const text = await scrydexRes.text();
      return res.status(scrydexRes.status).json({ error: `Scrydex ${scrydexRes.status}`, body: text.slice(0, 1000) });
    }

    const json = await scrydexRes.json();

    if (debug) {
      // Return the FULL raw structure for inspection
      return res.status(200).json({
        cardId: scrydexCardId,
        topLevelKeys: Object.keys(json),
        dataKeys: json.data ? Object.keys(json.data) : Object.keys(json),
        raw: json,
      });
    }

    return res.status(200).json(json);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
