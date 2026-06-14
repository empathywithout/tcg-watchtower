// api/sealed-prices.js
// Proxies Scrydex sealed product endpoint with server-side credentials
// Returns products with market price for a given expansion

const SCRYDEX_BASE   = 'https://api.scrydex.com/pokemon/v1';
const SCRYDEX_API_KEY = process.env.SCRYDEX_API_KEY || '';
const SCRYDEX_TEAM_ID = process.env.SCRYDEX_TEAM_ID || '';

// Our internal setId → Scrydex expansion ID
const SCRYDEX_ID_MAP = {
  // Full IDs (our internal format)
  'sv01':'sv01','sv02':'sv02','sv03':'sv03','sv3pt5':'sv03.5',
  'sv04':'sv04','sv4pt5':'sv04.5','sv05':'sv05','sv06':'sv06',
  'sv6pt5':'sv06.5','sv07':'sv07','sv08':'sv08','sv8pt5':'sv08.5',
  'sv09':'sv09','sv10':'sv10','zsv10pt5':'sv10.5-black','rsv10pt5':'sv10.5-white',
  'me01':'me01','me02':'me02','me02pt5':'me02.5','me03':'me03','me04':'me04','me05':'me05',
  // Short IDs (as returned by Scrydex expansion.id — no leading zeros)
  'me1':'me01','me2':'me02','me3':'me03','me4':'me04','me5':'me05',
  'sv1':'sv01','sv2':'sv02','sv3':'sv03','sv4':'sv04','sv5':'sv05',
  'sv6':'sv06','sv7':'sv07','sv8':'sv08','sv9':'sv09',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { setId, q } = req.query;

  if (!SCRYDEX_API_KEY || !SCRYDEX_TEAM_ID) {
    return res.status(500).json({ error: 'Scrydex credentials not configured' });
  }

  try {
    let url;

    if (setId) {
      // Fetch sealed products for a specific set
      const scrydexId = SCRYDEX_ID_MAP[setId];
      if (!scrydexId) return res.status(400).json({ error: `Unknown setId: ${setId}` });
      url = `${SCRYDEX_BASE}/expansions/${scrydexId}/sealed?include=prices&page_size=100`;
    } else if (q) {
      // Global search by name query
      url = `${SCRYDEX_BASE}/sealed?q=name:${encodeURIComponent(q)}*&include=prices&page_size=20`;
    } else {
      return res.status(400).json({ error: 'Provide setId or q param' });
    }

    const scrydexRes = await fetch(url, {
      headers: {
        'X-Api-Key':  SCRYDEX_API_KEY,
        'X-Team-ID':  SCRYDEX_TEAM_ID,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!scrydexRes.ok) {
      return res.status(scrydexRes.status).json({ error: `Scrydex error: ${scrydexRes.status}` });
    }

    const data = await scrydexRes.json();
    const raw  = data.data || [];

    // Normalise to a clean shape — strip everything we don't need
    const products = raw.map(p => {
      // Market price: first variant, first price entry, condition U (ungraded)
      const variant = (p.variants || [])[0] || {};
      const prices  = variant.prices || [];
      const priceEntry = prices.find(e => e.type === 'raw') || prices[0] || null;
      const market  = priceEntry?.market ?? null;

      return {
        id:          p.id,
        name:        p.name,
        type:        p.type || '',
        description: p.description || '',
        image:       p.images?.[0]?.medium || p.images?.[0]?.small || null,
        expansion: {
          id:           p.expansion?.id,
          name:         p.expansion?.name,
          releaseDate:  p.expansion?.release_date,
        },
        market,
        // Hook for future trend data when API tier is upgraded
        trends: null,
      };
    });

    return res.status(200).json({ products, total: products.length });
  } catch (e) {
    console.error('[sealed-prices]', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
