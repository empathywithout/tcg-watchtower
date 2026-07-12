import re
import os
import sys
import json

OLD_PATTERN = re.compile(
    r'<script async src="https://www\.googletagmanager\.com/gtag/js\?id=G-E0S4363S5Y"></script>\n'
    r"<script>window\.dataLayer=window\.dataLayer\|\|\[\];function gtag\(\)\{dataLayer\.push\(arguments\);\}gtag\('js',new Date\(\)\);gtag\('config','G-E0S4363S5Y'\);</script>\n"
    r"<script>document\.addEventListener\('click',function\(e\)\{var a=e\.target\.closest\('a'\);if\(!a\|\|!a\.href\)return;var h=a\.href;if\(h\.indexOf\('discord\.gg'\)>-1\)\{gtag\('event','discord_join_click',\{page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('tcgplayer\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'tcgplayer',page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('amazon\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'amazon',page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('ebay\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'ebay',page_path:location\.pathname\}\);\}\},true\);</script>"
)

# Second variant: set-template.html's own formatting (multi-line, spaces
# around operators, double-quoted gtag() string args) -- confirmed as a
# genuinely different real pattern used on a subset of set-list pages,
# found by checking WHY some files still had 'googletagmanager' but didn't
# match the first (compact, single-quoted) pattern.
OLD_PATTERN_SPACED = re.compile(
    r'<script async src="https://www\.googletagmanager\.com/gtag/js\?id=G-E0S4363S5Y"></script>\n'
    r'<script>\n'
    r'  window\.dataLayer = window\.dataLayer \|\| \[\];\n'
    r'  function gtag\(\)\{dataLayer\.push\(arguments\);\}\n'
    r'  gtag\("js", new Date\(\)\);\n'
    r'  gtag\("config", "G-E0S4363S5Y"\);\n'
    r"</script>\n"
    r"<script>document\.addEventListener\('click',function\(e\)\{var a=e\.target\.closest\('a'\);if\(!a\|\|!a\.href\)return;var h=a\.href;if\(h\.indexOf\('discord\.gg'\)>-1\)\{gtag\('event','discord_join_click',\{page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('tcgplayer\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'tcgplayer',page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('amazon\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'amazon',page_path:location\.pathname\}\);\}"
    r"else if\(h\.indexOf\('ebay\.com'\)>-1\)\{gtag\('event','affiliate_click',\{retailer:'ebay',page_path:location\.pathname\}\);\}\},true\);</script>"
)

def build_new_block(custom_dims: dict) -> str:
    dims_json = json.dumps(custom_dims, separators=(',', ':'))
    return (
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-E0S4363S5Y"></script>\n'
        f"<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-E0S4363S5Y',{dims_json});</script>\n"
        "<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a||!a.href)return;var h=a.href;"
        "if(h.indexOf('discord.gg')>-1){gtag('event','discord_join_click',{page_path:location.pathname});}"
        "else if(h.indexOf('tcgplayer.com')>-1){gtag('event','tcgplayer_click',{page_path:location.pathname});}"
        "else if(h.indexOf('amazon.com')>-1){gtag('event','amazon_click',{page_path:location.pathname});}"
        "else if(h.indexOf('ebay.com')>-1){gtag('event','ebay_click',{page_path:location.pathname});}},true);</script>\n"
        '<script type="module">import{onCLS,onFCP,onINP,onLCP,onTTFB}from"https://unpkg.com/web-vitals@5?module";'
        'function sendToGA(m){if(typeof gtag==="function"){gtag("event","web_vitals",{metric_name:m.name,metric_value:m.value,metric_rating:m.rating,metric_id:m.id,page_path:location.pathname});}}'
        "onCLS(sendToGA);onFCP(sendToGA);onINP(sendToGA);onLCP(sendToGA);onTTFB(sendToGA);</script>"
    )

def extract_rarity(content: str) -> str:
    m = re.search(r'rarity-badge[^"]*">([^<]*)<', content)
    return m.group(1) if m else None

SETS = json.load(open('sets.json'))
SERIES_SLUG_MAP = {'Scarlet & Violet': 'scarlet-violet', 'Mega Evolution': 'mega-evolution', 'One Piece TCG': 'one-piece'}
SET_URL_SLUG_MAP = {'sv01': 'base-set', 'me01': 'base-set', 'sv3pt5': '151'}

def derive_url_slug(s):
    if s['setId'] in SET_URL_SLUG_MAP: return SET_URL_SLUG_MAP[s['setId']]
    slug = s.get('slug', '')
    if '/cards' in slug:
        parts = [p for p in slug.split('/') if p]
        if 'cards' in parts:
            idx = parts.index('cards')
            if idx > 0: return parts[idx-1]
    if slug.endswith('-card-list'): return slug[:-len('-card-list')]
    return None

# Two lookups: by (series_slug, url_slug) for nested paths, and by bare
# url_slug alone for flat "{url_slug}-card-list.html" files (confirmed real,
# not stale -- these ARE the live source for the nested URL via Vercel
# routing, same convention as pitch-black-card-list.html).
REVERSE_LOOKUP = {}
FLAT_LOOKUP = {}
for s in SETS:
    series_slug = SERIES_SLUG_MAP.get(s['series'], s['series'].lower().replace(' ', '-'))
    url_slug = derive_url_slug(s)
    if url_slug:
        REVERSE_LOOKUP[(series_slug, url_slug)] = (s['setId'], s['series'])
        FLAT_LOOKUP[url_slug] = (s['setId'], s['series'])

# These 3 sets' real flat filenames include a series-name prefix (verified
# directly against vercel.json's routing rules), so the plain url_slug key
# above doesn't match the actual filename -- add the real filenames as
# additional lookup keys.
FLAT_LOOKUP['scarlet-violet-base-set'] = ('sv01', 'Scarlet & Violet')
FLAT_LOOKUP['scarlet-violet-151'] = ('sv3pt5', 'Scarlet & Violet')
FLAT_LOOKUP['mega-evolution-base-set'] = ('me01', 'Mega Evolution')

def classify_and_get_dims(path: str, content: str):
    parts = path.split('/')
    fname = parts[-1]
    is_op = len(parts) >= 1 and parts[0] == 'one-piece'

    if fname == 'portfolio.html':
        return {"page_type": "portfolio"}, "special_page"

    # Known stale duplicate artifact (also explicitly skipped by the site's
    # own generators via their SKIP_FILES lists) -- not a real, live page.
    if fname == 'fates-card-listtemporal-forces-card-list.html':
        return None, "SKIP: known stale duplicate artifact (already excluded by site's own generators)"

    # Generic, non-set-specific site pages -- simple page_type dimension,
    # not treated as an error.
    GENERIC_PAGES = {
        'index.html': 'home', 'contact.html': 'contact', 'disclaimer.html': 'disclaimer',
        'terms-of-service.html': 'terms', 'privacy-policy.html': 'privacy',
        'sets.html': 'sets_index', 'sets-one-piece.html': 'sets_index_op',
        'sets-pokemon.html': 'sets_index_pokemon', 'discord.html': 'discord_redirect',
    }
    if fname in GENERIC_PAGES and len(parts) == 1:
        return {"page_type": GENERIC_PAGES[fname]}, "generic_site_page"

    # Individual card page. Pokemon: pokemon/sets/{series}/{setslug}/cards/{card}.html (6 parts)
    # One Piece: one-piece/sets/{setslug}/cards/{card}.html (5 parts -- no series segment)
    if is_op and len(parts) >= 4 and parts[1] == 'sets' and parts[3] == 'cards':
        url_slug = parts[2]
        lookup = FLAT_LOOKUP.get(url_slug)
        if not lookup: return None, f"no sets.json match for one-piece set {url_slug}"
        set_id, series = lookup
        rarity = extract_rarity(content)
        if not rarity: return None, "could not extract rarity from this card page"
        return {"set_id": set_id, "series": series, "rarity": rarity}, "individual_card_op"

    if not is_op and len(parts) >= 5 and parts[1] == 'sets' and parts[4] == 'cards':
        series_slug, url_slug = parts[2], parts[3]
        lookup = REVERSE_LOOKUP.get((series_slug, url_slug))
        if not lookup: return None, f"no sets.json match for {series_slug}/{url_slug}"
        set_id, series = lookup
        rarity = extract_rarity(content)
        if not rarity: return None, "could not extract rarity from this card page"
        return {"set_id": set_id, "series": series, "rarity": rarity}, "individual_card"

    if fname in ('top-chase-cards.html', 'most-valuable.html'):
        if is_op and len(parts) >= 3 and parts[1] == 'sets':
            lookup = FLAT_LOOKUP.get(parts[2])
            if not lookup: return None, f"no sets.json match for one-piece set {parts[2]}"
            set_id, series = lookup
            return {"set_id": set_id, "series": series, "page_type": "chase_cards"}, "chase_cards_op"
        if not is_op and len(parts) >= 4 and parts[1] == 'sets':
            lookup = REVERSE_LOOKUP.get((parts[2], parts[3]))
            if not lookup: return None, f"no sets.json match for {parts[2]}/{parts[3]}"
            set_id, series = lookup
            return {"set_id": set_id, "series": series, "page_type": "chase_cards"}, "chase_cards"
        return None, "chase-cards page but path structure not recognized"

    if fname == 'sealed-product.html':
        if is_op and len(parts) >= 3 and parts[1] == 'sets':
            lookup = FLAT_LOOKUP.get(parts[2])
            if not lookup: return None, f"no sets.json match for one-piece set {parts[2]}"
            set_id, series = lookup
            return {"set_id": set_id, "series": series, "page_type": "sealed_product"}, "sealed_product_op"
        if not is_op and len(parts) >= 4 and parts[1] == 'sets':
            lookup = REVERSE_LOOKUP.get((parts[2], parts[3]))
            if not lookup: return None, f"no sets.json match for {parts[2]}/{parts[3]}"
            set_id, series = lookup
            return {"set_id": set_id, "series": series, "page_type": "sealed_product"}, "sealed_product"
        return None, "sealed-product page but path structure not recognized"

    # Flat set-list file at repo root, e.g. "heroines-edition-card-list.html"
    if fname.endswith('-card-list.html') and len(parts) == 1:
        url_slug = fname[:-len('-card-list.html')]
        lookup = FLAT_LOOKUP.get(url_slug)
        if lookup:
            set_id, series = lookup
            return {"set_id": set_id, "series": series, "page_type": "set_list"}, "set_list_flat"
        return None, f"flat set-list file but no sets.json match for url_slug={url_slug}"

    return None, "unrecognized file path pattern"


def find_all_html():
    candidates = []
    for root, dirs, files in os.walk('.'):
        if '.git' in root or 'node_modules' in root: continue
        for f in files:
            if f.endswith('.html'):
                candidates.append(os.path.relpath(os.path.join(root, f), '.'))
    return candidates


def main():
    dry_run = '--dry-run' in sys.argv
    all_html = find_all_html()
    print(f"Scanning {len(all_html)} HTML files site-wide...\n")

    matched, patched_count, skip_no_match, skip_unclassified = 0, 0, 0, 0
    unclassified_examples = []

    for rel_path in all_html:
        try:
            with open(rel_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            continue

        match = OLD_PATTERN.search(content)
        pattern_used = OLD_PATTERN
        if not match:
            match = OLD_PATTERN_SPACED.search(content)
            pattern_used = OLD_PATTERN_SPACED

        if not match:
            skip_no_match += 1
            continue

        matched += 1
        dims, label = classify_and_get_dims(rel_path, content)
        if dims is None:
            skip_unclassified += 1
            if len(unclassified_examples) < 25:
                unclassified_examples.append((rel_path, label))
            continue

        new_block = build_new_block(dims)
        new_content = pattern_used.sub(new_block, content, count=1)

        if not dry_run:
            with open(rel_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
        patched_count += 1

    print(f"Files with OLD tracking pattern found: {matched}")
    print(f"  Successfully {'would patch' if dry_run else 'patched'}: {patched_count}")
    print(f"  Could not classify: {skip_unclassified}")
    print(f"Files WITHOUT old pattern (already updated or unrelated): {skip_no_match}")

    if unclassified_examples:
        print(f"\nUnclassified examples (first {len(unclassified_examples)}):")
        for path, reason in unclassified_examples:
            print(f"  {path}: {reason}")

if __name__ == "__main__":
    main()
