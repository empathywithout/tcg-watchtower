"""
pinterest_queue_build.py

Builds a REVIEWABLE queue of proposed Pinterest pins -- generates images,
uploads them to R2 for a stable preview URL, and writes everything to a
JSON queue file. Posts NOTHING. This is the control point: nothing goes
to Pinterest until you've reviewed queue.json and explicitly approved
entries (or left the default approval setting, if you trust the
automatic selection).

Usage:
    python3 pinterest_queue_build.py --set me05 --set-slug pitch-black \\
        --series-slug mega-evolution --board-id <chase_cards_board_id> \\
        --top-n 8

This replaces the old all-in-one pinterest_campaign.py for any future
set -- no code edits needed, just different CLI args.
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from fetch_chase_cards import get_chase_cards, download_card_image
from generate_pinterest_pins import generate_reveal_pin, generate_price_guide_pin
from pinterest_post_pins import upload_to_r2

SITE_BASE = "https://tcgwatchtower.com"
QUEUE_PATH = "pinterest_queue/queue.json"  # committed to the repo, not /tmp --
                                            # needs to persist between the
                                            # build run and a later, separate
                                            # review/post step


def to_slug(name: str) -> str:
    """Mirrors toSlug() in scripts/generate-card-pages.js exactly."""
    s = name.lower().replace("'", "").replace("'", "")
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def card_destination_url(card: dict, series_slug: str, set_slug: str) -> str:
    slug = f"{to_slug(card['name'])}-{card['display_id']}"
    return f"{SITE_BASE}/pokemon/sets/{series_slug}/{set_slug}/cards/{slug}"


def load_queue() -> list:
    if os.path.exists(QUEUE_PATH):
        with open(QUEUE_PATH) as f:
            return json.load(f)
    return []


def save_queue(queue: list):
    Path(QUEUE_PATH).parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_PATH, "w") as f:
        json.dump(queue, f, indent=2)


def build_queue(set_id: str, set_slug: str, series_slug: str, board_id: str,
                 top_n: int, default_approved: bool):
    print(f"Fetching top {top_n} chase cards for {set_id}...")
    cards = get_chase_cards(set_id, phase="jp", top_n=top_n)
    if not cards:
        print("ERROR: no chase cards returned.")
        sys.exit(1)

    queue = load_queue()
    existing_ids = {entry["card_display_id"] for entry in queue if entry["set_id"] == set_id}

    for card in cards:
        if card["display_id"] in existing_ids:
            print(f"  Skipping {card['name']} (#{card['display_id']}) -- already in queue")
            continue

        print(f"  Building queue entry: {card['name']} (#{card['display_id']}, ${card['price']})")
        image_path = download_card_image(card, f"/tmp/queue_images/{set_id}_{card['display_id']}.webp")

        reveal_local = f"/tmp/queue_pins/reveal_{card['display_id']}.png"
        reveal_title = f"{set_slug.replace('-', ' ').title()}'s {card['rarity_label']}: {card['name']}"
        generate_reveal_pin(image_path, reveal_title, reveal_local)
        reveal_r2_key = f"pinterest-queue/{set_id}/reveal_{card['display_id']}.png"
        reveal_url = upload_to_r2(reveal_local, reveal_r2_key)

        price_local = f"/tmp/queue_pins/price_{card['display_id']}.png"
        price_title = f"{set_slug.replace('-', ' ').title()} Price Guide: {card['name']}"
        generate_price_guide_pin(card, image_path, price_title, price_local)
        price_r2_key = f"pinterest-queue/{set_id}/price_{card['display_id']}.png"
        price_url = upload_to_r2(price_local, price_r2_key)

        destination_url = card_destination_url(card, series_slug, set_slug)

        queue.append({
            "set_id": set_id,
            "card_display_id": card["display_id"],
            "card_name": card["name"],
            "rarity_label": card["rarity_label"],
            "price": card["price"],
            "board_id": board_id,
            "destination_url": destination_url,
            "variants": {
                "reveal": {
                    "image_url": reveal_url,
                    "title": reveal_title,
                    # Disclosure included even though the pin links to our OWN
                    # domain, not a raw affiliate URL -- Pinterest's Commercial
                    # Content Guidelines and FTC rules require disclosure based
                    # on whether the content chain is commercially monetized,
                    # not just whether the pin's own link target is an
                    # affiliate link. Since destination pages contain
                    # TCGplayer/Amazon/eBay affiliate links, this applies.
                    "description": (
                        f"{card['name']} is one of the top chase cards in the "
                        f"{set_slug.replace('-', ' ').title()} set. See live prices "
                        f"and the full chase-card list. #ad This page contains "
                        f"affiliate links."
                    ),
                    "alt_text": f"{card['name']}, {card['rarity_label']}",
                    # "approved" is the actual control point -- review this
                    # queue file and flip to true/false per entry (or per
                    # variant) before running pinterest_queue_post.py.
                    "approved": default_approved,
                    "posted": False,
                },
                "price_guide": {
                    "image_url": price_url,
                    "title": price_title,
                    "description": (
                        f"See current market prices for {card['name']} and other "
                        f"chase cards from {set_slug.replace('-', ' ').title()}. "
                        f"#ad This page contains affiliate links."
                    ),
                    "alt_text": f"{card['name']} price guide, {card['rarity_label']}",
                    "approved": default_approved,
                    "posted": False,
                },
            },
        })

    save_queue(queue)
    print(f"\nQueue saved to {QUEUE_PATH} ({len(queue)} total entries).")
    print("Review this file, adjust 'approved' flags, titles, or descriptions "
          "as needed, then commit it before running pinterest_queue_post.py.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", required=True, help="Internal set ID, e.g. me05")
    parser.add_argument("--set-slug", required=True, help="URL slug, e.g. pitch-black")
    parser.add_argument("--series-slug", required=True, help="e.g. mega-evolution")
    parser.add_argument("--board-id", required=True, help="Pinterest board ID for these pins")
    parser.add_argument("--top-n", type=int, default=8)
    parser.add_argument("--auto-approve", action="store_true",
                         help="Default new entries to approved=true instead of "
                              "false. Off by default -- explicit review is the point.")
    args = parser.parse_args()

    build_queue(args.set, args.set_slug, args.series_slug, args.board_id,
                args.top_n, default_approved=args.auto_approve)
