const R2 = 'https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev';

function getOgImage(pathname) {
  const opMatch = pathname.match(/\/one-piece\/sets\/([^/]+)/);
  if (opMatch) {
    const OP_SLUG_MAP = {
      'romance-dawn': 'op01', 'paramount-war': 'op02', 'pillars-of-strength': 'op03',
      'kingdoms-of-intrigue': 'op04', 'awakening-of-the-new-era': 'op05',
      'wings-of-the-captain': 'op06', '500-years-in-the-future': 'op07',
      'two-legends': 'op08', 'emperors-in-the-new-world': 'op09',
      'royal-blood': 'op10', 'a-fist-of-divine-speed': 'op11',
      'legacy-of-the-master': 'op12', 'carrying-on-his-will': 'op13',
      'the-azure-seas-seven': 'op14', 'memorial-collection': 'eb01',
      'anime-25th-collection': 'eb02', 'heroines-edition': 'eb03', 'egghead-crisis': 'eb04',
    };
    const setId = OP_SLUG_MAP[opMatch[1]];
    if (setId) return `${R2}/logos/op/${setId}.png`;
  }

  const pkMatch = pathname.match(/\/pokemon\/sets\/[^/]+\/([^/]+)/);
  if (pkMatch) {
    const PK_SLUG_MAP = {
      'base-set': 'sv01', 'paldea-evolved': 'sv02', 'obsidian-flames': 'sv03',
      'paradox-rift': 'sv04', 'scarlet-violet-151': 'sv3pt5', 'paldean-fates': 'sv4pt5',
      'temporal-forces': 'sv05', 'twilight-masquerade': 'sv06', 'shrouded-fable': 'sv6pt5',
      'stellar-crown': 'sv07', 'surging-sparks': 'sv08', 'prismatic-evolutions': 'sv8pt5',
      'journey-together': 'sv09', 'destined-rivals': 'sv10',
      'mega-evolution': 'me01', 'phantasmal-flames': 'me02', 'ascended-heroes': 'me02pt5',
      'perfect-order': 'me03', 'chaos-rising': 'me04',
    };
    const setId = PK_SLUG_MAP[pkMatch[1]];
    if (setId) return `${R2}/logos/${setId}.png`;
  }

  return null;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const ogImage = getOgImage(url.pathname);
  if (!ogImage) return fetch(request);

  const response = await fetch(request);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  html = html
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ogImage}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${ogImage}">`);

  return new Response(html, {
    status: response.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': response.headers.get('cache-control') || 'public, max-age=3600',
    },
  });
}

export const config = {
  matcher: ['/one-piece/sets/:path*', '/pokemon/sets/:path*'],
};
