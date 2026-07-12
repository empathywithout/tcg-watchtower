"""
fetch_chase_cards.py

Fetches real card data from tcgwatchtower.com's live API and adapts it
into the shape the video pipeline (generate_narration_audio.py,
generate_video_frames.py) expects, replacing the hardcoded test cards.

Uses the exact same CHASE_RARITIES/RARITY_TIER ranking already live on
the site (static/set-page.js) so the video's chase-card selection matches
what visitors see on the actual set page -- not a separately invented
ranking.

Requires real internet access to tcgwatchtower.com -- run via GitHub
Actions or locally, not from a network-restricted sandbox.
"""

import urllib.request
import json

SITE_BASE = "https://tcgwatchtower.com"

# Mirrors static/set-page.js exactly -- keep these two files in sync if
# the site's own rarity tiering ever changes.
CHASE_RARITIES = [
    "Special Illustration Rare", "Hyper Rare", "Mega Hyper Rare",
    "Mega Ultra Rare", "Ultra Rare", "Illustration Rare",
]
RARITY_TIER = {
    "Mega Ultra Rare": 0, "Mega Hyper Rare": 0, "Hyper Rare": 1,
    "Special Illustration Rare": 2, "Ultra Rare": 3, "Illustration Rare": 4,
}


def fetch_set_cards(set_id: str, phase: str = "jp") -> list:
    """
    Fetch all cards for a set from the live API. For a JP-phase set
    (like Pitch Black before its English release), this returns
    JPY-converted USD estimates -- already handled server-side by
    api/scrydex-cards.js, not something this function needs to redo.
    """
    url = f"{SITE_BASE}/api/scrydex-cards?set={set_id}&phase={phase}"
    with urllib.request.urlopen(url, timeout=15) as response:
        data = json.loads(response.read())

    if "error" in data:
        # The endpoint returns {"error": "..."} on failure (e.g. unknown
        # set/phase mapping, upstream Scrydex issue) rather than raising
        # an HTTP error -- surface this explicitly instead of letting it
        # look like a silently-empty result.
        print(f"  [diagnostic] API returned an error field: {data['error']}")
        return []

    return data.get("cards", [])


def adapt_card(raw_card: dict) -> dict:
    """
    Map the real API response shape to what the video pipeline expects.
    See api/scrydex-cards.js's normaliseCard() for the source shape.
    """
    return {
        "name": raw_card.get("name", ""),
        "rarity_label": raw_card.get("rarity", ""),
        "display_id": raw_card.get("localId", ""),
        "price": raw_card.get("market"),
        "rarity_tier_rank": RARITY_TIER.get(raw_card.get("rarity", ""), 99),
        # NOTE: price_change_pct is NOT available from this endpoint --
        # it has no historical price tracking, just current market value.
        # The "sleeper picks" chapter's trend_up detection needs either a
        # separate historical snapshot data source, or this field left
        # unset (infer_reason_key() already falls back gracefully to no
        # forced reason when it's missing, rather than guessing).
        "character_name": raw_card.get("name", "").replace(" ex", "").strip(),
        "_image_url": raw_card.get("image"),  # already a full URL from the API
        "_raw": raw_card,  # keep original around in case anything downstream needs it
    }


def get_chase_cards(set_id: str, phase: str = "jp", top_n: int = 8) -> list:
    """
    Fetch and return the top N chase cards for a set, ranked the same
    way the live site ranks them: chase rarity first (by tier), then by
    price within each tier -- not just a flat price sort, since a lower
    tier card temporarily priced high shouldn't outrank a true top-tier
    pull just because of a momentary price spike.
    """
    raw_cards = fetch_set_cards(set_id, phase)

    # Diagnostic output -- if the chase-card filter below returns nothing,
    # this tells us WHY (empty API response entirely? cards present but no
    # rarity matches? cards present but no prices?) instead of failing silently.
    print(f"  [diagnostic] Raw cards fetched from API: {len(raw_cards)}")
    if raw_cards:
        # Full distinct rarity set (not just a sample) with one example
        # card per rarity, so an accurate JP->EN mapping can be built
        # instead of guessed from a partial sample.
        rarity_examples = {}
        for c in raw_cards:
            r = c.get("rarity")
            if r not in rarity_examples:
                rarity_examples[r] = c.get("name", "?")
        print(f"  [diagnostic] Complete distinct rarity set ({len(rarity_examples)} values):")
        for rarity, example_name in rarity_examples.items():
            print(f"    {rarity!r} -- e.g. {example_name}")
        with_price = sum(1 for c in raw_cards if c.get("market"))
        print(f"  [diagnostic] Cards with a non-null market price: {with_price}/{len(raw_cards)}")

    chase_only = [c for c in raw_cards if c.get("rarity") in CHASE_RARITIES and c.get("market")]
    print(f"  [diagnostic] Cards matching CHASE_RARITIES with a price: {len(chase_only)}")

    if not chase_only:
        # Known issue: JP-phase cards return rarity as raw Japanese text
        # (see api/scrydex-cards.js's normaliseCard(), which translates
        # `name` for JP phase but never translates `rarity`) -- so
        # CHASE_RARITIES (English strings) can't match anything yet.
        # This needs a proper fix at the source (translating rarity the
        # same way name already is), tracked separately. In the meantime,
        # fall back to ranking purely by price so this still produces a
        # real video rather than blocking entirely.
        print("  [diagnostic] WARNING: rarity filter matched 0 cards (likely JP rarity "
              "strings not yet translated -- see normaliseCard() in api/scrydex-cards.js). "
              "Falling back to price-only ranking for this run.")
        chase_only = [c for c in raw_cards if c.get("market")]
        chase_only.sort(key=lambda c: -c.get("market", 0))
        return [adapt_card(c) for c in chase_only[:top_n]]

    chase_only.sort(
        key=lambda c: (RARITY_TIER.get(c.get("rarity", ""), 99), -c.get("market", 0))
    )

    return [adapt_card(c) for c in chase_only[:top_n]]


def download_card_image(card: dict, local_path: str) -> str:
    """
    Download a card's real image using the URL already provided by the
    API response (card['_image_url']) -- no need to reconstruct the R2
    path manually, the API already resolved it correctly (Scrydex image
    if available, R2 fallback otherwise, per normaliseCard()).
    """
    import os
    from pathlib import Path
    Path(local_path).parent.mkdir(parents=True, exist_ok=True)
    image_url = card.get("_image_url")
    print(f"  [diagnostic] Image URL for {card.get('name', '?')}: {image_url}")

    if not image_url:
        print(f"  [diagnostic] No _image_url present at all for this card -- API response had no image field")
        return local_path  # no URL at all -> triggers generate_card_frame()'s fallback

    try:
        req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            data = response.read()

        if "image" not in content_type.lower():
            # The request "succeeded" (no HTTP error) but didn't actually
            # return image data -- likely an HTML error page, auth wall,
            # or redirect to a login screen. This is exactly the case
            # that a bare try/except around urlretrieve() would silently
            # miss, since no exception gets raised for this.
            print(f"  [diagnostic] WARNING: response Content-Type was '{content_type}', not an image "
                  f"-- got {len(data)} bytes, first 200: {data[:200]!r}")
            return local_path  # don't write bad data to disk; triggers fallback

        with open(local_path, "wb") as f:
            f.write(data)
        print(f"  [diagnostic] Downloaded successfully: {len(data)} bytes, Content-Type: {content_type}")
        return local_path

    except Exception as e:
        print(f"  [diagnostic] WARNING: could not download {image_url} ({type(e).__name__}: {e}) -- will use placeholder")
        return local_path


if __name__ == "__main__":
    # Quick manual check -- requires real internet access to tcgwatchtower.com
    cards = get_chase_cards("me05", phase="jp", top_n=8)
    print(f"Fetched {len(cards)} chase cards for Pitch Black (me05, JP phase):\n")
    for c in cards:
        print(f"  {c['name']} — {c['rarity_label']} — #{c['display_id']} — ${c['price']}")
