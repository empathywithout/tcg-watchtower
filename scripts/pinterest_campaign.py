"""
pinterest_campaign.py

Drives a full Pinterest posting run for a given set: fetches real chase
cards, generates both pin styles (reveal + price-guide) for each, and
posts them with pacing enforcement already built into post_one_pin().

Usage: set BOARD_ID_CHASE_CARDS / BOARD_ID_SET_SPECIFIC below to real
board IDs from pinterest_list_boards.py output, then run this on a
schedule (see the accompanying workflow).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fetch_chase_cards import get_chase_cards, download_card_image
from generate_pinterest_pins import generate_reveal_pin, generate_price_guide_pin
from pinterest_post_pins import post_one_pin

# ─── Fill these in from pinterest_list_boards.py's output ──────────────────
BOARD_ID_CHASE_CARDS = os.environ.get("PINTEREST_BOARD_CHASE_CARDS", "")
BOARD_ID_SET_SPECIFIC = os.environ.get("PINTEREST_BOARD_PITCH_BLACK", "")

SET_ID = "me05"
SET_URL_SLUG = "pitch-black"
DESTINATION_BASE = f"https://tcgwatchtower.com/pokemon/sets/mega-evolution/{SET_URL_SLUG}/cards"


def fetch_card_image(card: dict) -> str:
    local_path = f"/tmp/pinterest_card_images/{SET_ID}_{card['display_id']}.webp"
    from fetch_chase_cards import download_card_image as dl
    return dl(card, local_path)


def run_campaign(top_n: int = 8, dry_run: bool = True):
    if not BOARD_ID_CHASE_CARDS and not dry_run:
        print("ERROR: PINTEREST_BOARD_CHASE_CARDS env var not set. Run "
              "pinterest_list_boards.py first to get real board IDs.")
        sys.exit(1)

    print(f"Fetching top {top_n} chase cards for {SET_ID}...")
    cards = get_chase_cards(SET_ID, phase="jp", top_n=top_n)
    if not cards:
        print("ERROR: no chase cards returned -- check API connectivity.")
        sys.exit(1)

    posted_count = 0
    for i, card in enumerate(cards):
        print(f"\n[{i+1}/{len(cards)}] {card['name']} ({card['rarity_label']}, ${card['price']})")

        image_path = fetch_card_image(card)

        # Reveal-style pin -- reach/engagement, one per card in the set
        reveal_path = f"/tmp/pinterest_pins/reveal_{card['display_id']}.png"
        reveal_title = f"Pitch Black's {card['rarity_label']}: {card['name']}"
        generate_reveal_pin(image_path, reveal_title, reveal_path)

        # Price-guide pin -- buyer-intent, same card different angle
        price_path = f"/tmp/pinterest_pins/price_{card['display_id']}.png"
        price_title = f"Pitch Black Price Guide: {card['name']}"
        generate_price_guide_pin(card, image_path, price_title, price_path)

        if dry_run:
            print(f"  [DRY RUN] Would post: {reveal_path}, {price_path}")
            continue

        posted = post_one_pin(
            local_image_path=reveal_path,
            board_id=BOARD_ID_CHASE_CARDS,
            title=reveal_title,
            description=(
                f"{card['name']} is one of the top chase cards in Pokemon TCG's "
                f"Pitch Black set. See live prices and the full chase-card list."
            ),
            destination_url=DESTINATION_BASE,
            alt_text=f"{card['name']}, {card['rarity_label']} from Pitch Black",
        )
        if posted:
            posted_count += 1

    print(f"\nDone. {'(dry run, nothing actually posted)' if dry_run else f'{posted_count} pins posted.'}")


if __name__ == "__main__":
    # Defaults to dry_run=True -- deliberately safe by default. Pass
    # --live explicitly to actually post to Pinterest.
    live = "--live" in sys.argv
    run_campaign(dry_run=not live)
