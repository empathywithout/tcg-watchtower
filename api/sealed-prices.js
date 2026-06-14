// api/sealed-prices.js
// Proxies Scrydex sealed product endpoint with server-side credentials

const SCRYDEX_BASE    = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

// Our internal setId → Scrydex expansion ID (short format)
const SCRYDEX_ID_MAP = {
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10',
  'me01':'me1','me02':'me2','me02pt5':'me2.5','me03':'me3','me04':'me4','me05':'me5',
  // Pass-through short IDs from Scrydex expansion.id
  'me1':'me1','me2':'me2','me3':'me3','me4':'me4','me5':'me5',
  'sv1':'sv01','sv2':'sv02','sv3':'sv03','sv4':'sv04','sv5':'sv05',
  'sv6':'sv06','sv7':'sv07','sv8':'sv08','sv9':'sv09',
};

// Set name keywords for search — used to fetch products when expansion.id filter isn't supported
const SET_NAME_MAP = {
  // Mega Evolution
  'me1':'Mega Evolution','me2':'Phantasmal Flames','me3':'Perfect Order',
  'me4':'Chaos Rising','me5':'Pitch Black',
  'me01':'Mega Evolution','me02':'Phantasmal Flames','me03':'Perfect Order',
  'me04':'Chaos Rising','me05':'Pitch Black',
  // Scarlet & Violet
  'sv01':'Scarlet Violet','sv1':'Scarlet Violet',
  'sv02':'Paldea Evolved','sv2':'Paldea Evolved',
  'sv03':'Obsidian Flames','sv3':'Obsidian Flames',
  'sv3pt5':'151','sv03.5':'151',
  'sv04':'Paradox Rift','sv4':'Paradox Rift',
  'sv4pt5':'Paldean Fates','sv04.5':'Paldean Fates',
  'sv05':'Temporal Forces','sv5':'Temporal Forces',
  'sv06':'Twilight Masquerade','sv6':'Twilight Masquerade',
  'sv6pt5':'Shrouded Fable','sv06.5':'Shrouded Fable',
  'sv07':'Stellar Crown','sv7':'Stellar Crown',
  'sv08':'Surging Sparks','sv8':'Surging Sparks',
  'sv8pt5':'Prismatic Evolutions','sv08.5':'Prismatic Evolutions',
  'sv09':'Journey Together','sv9':'Journey Together',
  'sv10':'Destined Rivals',
  'zsv10pt5':'Black Bolt','rsv10pt5':'White Flare',
  // One Piece
  'op14':'Azure','op15':'Kami','eb03':'Heroines',
};

async function scrydexFetch(url, apiKey, teamId) {
  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey, 'X-Team-ID': teamId },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Scrydex ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { setId, q } = req.query;

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  try {
    let raw = [];

    if (setId) {
      const scrydexId  = SCRYDEX_ID_MAP[setId] || setId;
      const setName    = SET_NAME_MAP[setId] || SET_NAME_MAP[scrydexId];

      if (setName) {
        // Search by set name, then filter by expansion.id client-side
        const data = await scrydexFetch(
          `${SCRYDEX_BASE}/sealed?q=name:${encodeURIComponent(setName)}*&include=prices&page_size=100`,
          SCRYDEX_API_KEY, SCRYDEX_TEAM_ID
        );
        // Filter to only products from this expansion
        raw = (data.data || []).filter(p => p.expansion?.id === scrydexId);
      } else {
        return res.status(400).json({ error: `Unknown setId: ${setId}` });
      }
    } else if (q) {
      const data = await scrydexFetch(
        `${SCRYDEX_BASE}/sealed?q=name:${encodeURIComponent(q)}*&include=prices&page_size=20`,
        SCRYDEX_API_KEY, SCRYDEX_TEAM_ID
      );
      raw = data.data || [];
    } else {
      return res.status(400).json({ error: 'Provide setId or q param' });
    }

    const products = raw.map(p => {
      const variant    = (p.variants || [])[0] || {};
      const prices     = variant.prices || [];
      const priceEntry = prices.find(e => e.type === 'raw') || prices[0] || null;
      const market     = priceEntry?.market ?? null;
      return {
        id:    p.id,
        name:  p.name,
        type:  p.type || '',
        image: p.images?.[0]?.medium || p.images?.[0]?.small || null,
        expansion: {
          id:          p.expansion?.id,
          name:        p.expansion?.name,
          releaseDate: p.expansion?.release_date,
        },
        market,
        trends: null,
      };
    });

    return res.status(200).json({ products, total: products.length });
  } catch (e) {
    console.error('[sealed-prices]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
