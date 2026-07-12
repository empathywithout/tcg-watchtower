"""
pinterest_queue_build.py

Builds a REVIEWABLE queue of proposed Pinterest pins -- generates images,
uploads them to R2 for a stable preview URL, and writes everything to a
JSON queue file. Posts NOTHING. This is the control point: nothing goes
to Pinterest until you've reviewed queue.json and explicitly approved
entries (or left the default approval setting, if you trust the
automatic selection).

Three styles, selected via --style:
  chase    (default) -- top-N chase cards, each with reveal + price-guide
             variants. This is the original curated-showcase behavior.
  simple   -- individual card pages, one pin per card, just the raw card
             art with title/description matching the simple format seen
             performing well on Pinterest (Card Name - Set Name #Number).
             Scales to ALL cards in a set, not just chase-tier ones.
  roundup  -- one pin covering the top 5 chase cards together (featured
             #1 + 2x2 grid), linking to the full chase-cards list page
             rather than any single card's page.

Usage:
    python3 pinterest_queue_build.py --style chase --set me05 \\
        --set-slug pitch-black --series-slug mega-evolution \\
        --board-id <board_id> --top-n 8

    python3 pinterest_queue_build.py --style simple --set me05 \\
        --set-slug pitch-black --series-slug mega-evolution \\
        --board-id <board_id> --top-n 20   # or omit --top-n for ALL cards

    python3 pinterest_queue_build.py --style roundup --set me05 \\
        --set-slug pitch-black --series-slug mega-evolution \\
        --board-id <board_id> --list-page-url <full chase-cards list URL>

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
from fetch_chase_cards import get_chase_cards, get_all_cards, download_card_image
from generate_pinterest_pins import (
    generate_reveal_pin, generate_price_guide_pin,
    generate_simple_card_pin, generate_roundup_pin,
)
from pinterest_post_pins import upload_to_r2

SITE_BASE = "https://tcgwatchtower.com"
QUEUE_PATH = "pinterest_queue/queue.json"  # committed to the repo, not /tmp --
                                            # needs to persist between the
                                            # build run and a later, separate
                                            # review/post step
DISCLOSURE = "#ad This page contains affiliate links."


def to_slug(name: str) -> str:
    """Mirrors toSlug() in scripts/generate-card-pages.js exactly."""
    s = name.lower().replace("\u2019", "").replace("'", "")
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


def build_chase_queue(set_id: str, set_slug: str, series_slug: str, board_id: str,
                       top_n: int, default_approved: bool):
    print(f"Fetching top {top_n} chase cards for {set_id}...")
    cards = get_chase_cards(set_id, phase="jp", top_n=top_n)
    if not cards:
        print("ERROR: no chase cards returned.")
        sys.exit(1)

    queue = load_queue()
    existing_ids = {entry["card_display_id"] for entry in queue
                     if entry.get("set_id") == set_id and entry.get("type", "chase") == "chase"}

    for i, card in enumerate(cards):
        if card["display_id"] in existing_ids:
            print(f"  Skipping {card['name']} (#{card['display_id']}) -- already in queue")
            continue

        print(f"  Building chase entry: {card['name']} (#{card['display_id']}, ${card['price']})")
        image_path = download_card_image(card, f"/tmp/queue_images/{set_id}_{card['display_id']}.webp")

        # Ratio control: reveal pins read as curation/showcase content and
        # follow the normal default_approved setting. Price-guide pins read
        # more commercially (big dollar figure, buyer-intent framing), so
        # they default to approved on only roughly 1 in 5 cards -- keeps
        # the overall mix closer to 80/20 valuable-vs-promotional rather
        # than posting a price-guide pin for every single card.
        price_guide_default = default_approved and (i % 5 == 0)

        reveal_local = f"/tmp/queue_pins/reveal_{card['display_id']}.png"
        reveal_title = f"{set_slug.replace('-', ' ').title()}'s {card['rarity_label']}: {card['name']}"
        generate_reveal_pin(image_path, reveal_title, reveal_local)
        reveal_url = upload_to_r2(reveal_local, f"pinterest-queue/{set_id}/reveal_{card['display_id']}.png")

        price_local = f"/tmp/queue_pins/price_{card['display_id']}.png"
        price_title = f"{set_slug.replace('-', ' ').title()} Price Guide: {card['name']}"
        generate_price_guide_pin(card, image_path, price_title, price_local)
        price_url = upload_to_r2(price_local, f"pinterest-queue/{set_id}/price_{card['display_id']}.png")

        destination_url = card_destination_url(card, series_slug, set_slug)

        queue.append({
            "type": "chase",
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
                    "description": (
                        f"{card['name']} is one of the top chase cards in the "
                        f"{set_slug.replace('-', ' ').title()} set. See live prices "
                        f"and the full chase-card list. {DISCLOSURE}"
                    ),
                    "alt_text": f"{card['name']}, {card['rarity_label']}",
                    "approved": default_approved,
                    "posted": False,
                },
                "price_guide": {
                    "image_url": price_url,
                    "title": price_title,
                    "description": (
                        f"See current market prices for {card['name']} and other "
                        f"chase cards from {set_slug.replace('-', ' ').title()}. {DISCLOSURE}"
                    ),
                    "alt_text": f"{card['name']} price guide, {card['rarity_label']}",
                    "approved": price_guide_default,
                    "posted": False,
                },
            },
        })

    save_queue(queue)


def build_simple_queue(set_id: str, set_slug: str, series_slug: str, board_id: str,
                        top_n, default_approved: bool):
    scope_label = f"top {top_n}" if top_n else "ALL"
    print(f"Fetching {scope_label} cards for {set_id} (simple style)...")
    cards = get_all_cards(set_id, phase="jp", top_n=top_n)
    if not cards:
        print("ERROR: no cards returned.")
        sys.exit(1)
    print(f"  {len(cards)} cards fetched.")

    queue = load_queue()
    existing_ids = {entry["card_display_id"] for entry in queue
                     if entry.get("set_id") == set_id and entry.get("type") == "simple"}

    set_display_name = set_slug.replace("-", " ").title()

    for card in cards:
        if card["display_id"] in existing_ids:
            continue

        print(f"  Building simple entry: {card['name']} (#{card['display_id']})")
        image_path = download_card_image(card, f"/tmp/queue_images/{set_id}_{card['display_id']}.webp")

        local_path = f"/tmp/queue_pins/simple_{card['display_id']}.png"
        generate_simple_card_pin(image_path, local_path)
        image_url = upload_to_r2(local_path, f"pinterest-queue/{set_id}/simple_{card['display_id']}.png")

        title = f"{card['name']} - {set_display_name} #{card['display_id']}"
        destination_url = card_destination_url(card, series_slug, set_slug)

        queue.append({
            "type": "simple",
            "set_id": set_id,
            "card_display_id": card["display_id"],
            "card_name": card["name"],
            "rarity_label": card["rarity_label"],
            "price": card["price"],
            "board_id": board_id,
            "destination_url": destination_url,
            "variants": {
                "simple_card": {
                    "image_url": image_url,
                    "title": title,
                    "description": f"{title} {DISCLOSURE}",
                    "alt_text": title,
                    "approved": default_approved,
                    "posted": False,
                },
            },
        })

    save_queue(queue)


def build_roundup_queue(set_id: str, set_slug: str, series_slug: str, board_id: str,
                         list_page_url: str, default_approved: bool):
    print(f"Fetching top 5 chase cards for {set_id} (roundup style)...")
    cards = get_chase_cards(set_id, phase="jp", top_n=5)
    if len(cards) < 5:
        print(f"ERROR: only {len(cards)} chase cards available, need 5 for a roundup.")
        sys.exit(1)

    queue = load_queue()
    roundup_id = f"roundup_top5_{set_id}"
    if any(e.get("card_display_id") == roundup_id for e in queue):
        print(f"Roundup for {set_id} already in queue -- skipping (delete the "
              f"existing entry from queue.json first if you want to rebuild it).")
        return

    cards_with_images = []
    for card in cards:
        image_path = download_card_image(card, f"/tmp/queue_images/{set_id}_{card['display_id']}.webp")
        cards_with_images.append((card, image_path))

    set_display_name = set_slug.replace("-", " ").title()
    title = f"{set_display_name}: Top 5 Chase Cards"
    local_path = f"/tmp/queue_pins/roundup_{set_id}.png"
    generate_roundup_pin(cards_with_images, title, local_path)
    image_url = upload_to_r2(local_path, f"pinterest-queue/{set_id}/roundup_top5.png")

    destination_url = list_page_url or f"{SITE_BASE}/pokemon/sets/{series_slug}/{set_slug}/cards"

    queue.append({
        "type": "roundup",
        "set_id": set_id,
        "card_display_id": roundup_id,
        "card_name": ", ".join(c["name"] for c in cards),
        "board_id": board_id,
        "destination_url": destination_url,
        "variants": {
            "roundup": {
                "image_url": image_url,
                "title": title,
                "description": (
                    f"The top 5 chase cards from {set_display_name}, ranked by "
                    f"current market price. {DISCLOSURE}"
                ),
                "alt_text": title,
                "approved": default_approved,
                "posted": False,
            },
        },
    })

    save_queue(queue)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--style", choices=["chase", "simple", "roundup"], default="chase")
    parser.add_argument("--set", required=True, help="Internal set ID, e.g. me05")
    parser.add_argument("--set-slug", required=True, help="URL slug, e.g. pitch-black")
    parser.add_argument("--series-slug", required=True, help="e.g. mega-evolution")
    parser.add_argument("--board-id", required=True, help="Pinterest board ID for these pins")
    parser.add_argument("--top-n", type=int, default=None,
                         help="chase style defaults to 8 if omitted; simple style "
                              "defaults to 12 if omitted (pass a number explicitly "
                              "to override, or a large number for full-set coverage)")
    parser.add_argument("--list-page-url", default=None,
                         help="roundup style only -- full URL to the chase-cards "
                              "list page. Defaults to a guessed URL if omitted.")
    parser.add_argument("--auto-approve", action="store_true",
                         help="Default new entries to approved=true instead of "
                              "false. Off by default -- explicit review is the point.")
    args = parser.parse_args()

    if args.style == "chase":
        build_chase_queue(args.set, args.set_slug, args.series_slug, args.board_id,
                           args.top_n or 8, default_approved=args.auto_approve)
    elif args.style == "simple":
        # Simple style defaults to 12 cards (within the requested 10-15
        # range) rather than every card with a price, if --top-n wasn't
        # explicitly given -- covers the cards anyone would plausibly
        # search for individually, without flooding the queue with
        # dozens of low-value commons that add volume, not value.
        simple_top_n = args.top_n if args.top_n is not None else 12
        build_simple_queue(args.set, args.set_slug, args.series_slug, args.board_id,
                            simple_top_n, default_approved=args.auto_approve)
    elif args.style == "roundup":
        build_roundup_queue(args.set, args.set_slug, args.series_slug, args.board_id,
                             args.list_page_url, default_approved=args.auto_approve)

    print(f"\nQueue saved to {QUEUE_PATH}.")
    print("Review this file, adjust 'approved' flags, titles, or descriptions "
          "as needed, then commit it before running pinterest_queue_post.py.")
