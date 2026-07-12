"""
generate_test_video.py

Full end-to-end test: fetches REAL card data + real prices from the live
site, generates real narration audio, real frames, and assembles a real
video -- using the top N chase cards from a given set.

This is meant to be run once as a genuine validation step before wiring
the pipeline into recurring automation. Run via GitHub Actions (needs
network access to tcgwatchtower.com, R2, and Google Cloud TTS -- none of
which are reachable from a locked-down sandbox).

Usage:
    python3 generate_test_video.py --set me05 --game pokemon --group-id 24537 --count 3

Requires: requests, google-cloud-texttospeech, Pillow
Requires: GOOGLE_APPLICATION_CREDENTIALS env var set
"""

import argparse
import os
import sys
import tempfile
import urllib.request

import requests

sys.path.insert(0, os.path.dirname(__file__))
from generate_narration_audio import synthesize_video_narrations
from generate_video_frames import generate_video_frames, assemble_video

SITE_BASE = "https://tcgwatchtower.com"


def fetch_cards(set_id: str, game: str) -> list:
    """Fetch real card data from the live /api/cards endpoint."""
    url = f"{SITE_BASE}/api/cards?set={set_id}&game={game}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    cards = data.get("cards", [])
    if not cards:
        raise RuntimeError(f"No cards returned for set={set_id} game={game} -- check the set_id is correct")
    return cards


def fetch_prices(group_id: str, game: str) -> dict:
    """Fetch real live prices from the price API."""
    url = f"{SITE_BASE}/api/tcgplayer-prices?groupId={group_id}&game={game}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("prices", {})


def pick_top_chase_cards(cards: list, prices: dict, count: int) -> list:
    """
    Pick the top N highest-priced cards as a simple chase-card proxy for
    this test. (Your real production pipeline should reuse the actual
    CHASE_RARITIES + RARITY_TIER ranking logic already in
    generate-op-page.js / static/set-page.js rather than this simplified
    price-only sort -- this is just enough to validate the video pipeline
    itself, not the chase-card selection logic.)
    """
    enriched = []
    for card in cards:
        local_id = card.get("localId", "")
        price = prices.get(local_id) or prices.get(local_id.split("_")[0] if "_" in local_id else local_id)
        if isinstance(price, dict):
            price = price.get("price")
        if price:
            enriched.append({
                "name": card.get("name", "Unknown"),
                "rarity_label": card.get("rarity", ""),
                "display_id": card.get("localId", ""),
                "price": float(price),
                "image_url": card.get("image", ""),
            })

    enriched.sort(key=lambda c: c["price"], reverse=True)
    return enriched[:count]


def download_card_image(card: dict, cache_dir: str) -> str:
    """Download a card's real image from R2, cached locally for this run."""
    local_path = os.path.join(cache_dir, f"{card['display_id']}.png")
    if card.get("image_url"):
        try:
            urllib.request.urlretrieve(card["image_url"], local_path)
        except Exception as e:
            print(f"  Warning: couldn't download image for {card['name']}: {e}")
    return local_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", required=True, help="Set ID, e.g. me05")
    parser.add_argument("--game", default="pokemon", choices=["pokemon", "onepiece"])
    parser.add_argument("--group-id", required=True, help="TCGplayer group ID for pricing")
    parser.add_argument("--count", type=int, default=3, help="Number of top cards to include")
    parser.add_argument("--output", default="/tmp/test_video_output.mp4")
    args = parser.parse_args()

    print(f"Fetching real card data for set={args.set} game={args.game}...")
    cards = fetch_cards(args.set, args.game)
    print(f"  Got {len(cards)} cards")

    print(f"Fetching real prices for groupId={args.group_id}...")
    prices = fetch_prices(args.group_id, args.game)
    print(f"  Got {len(prices)} price entries")

    top_cards = pick_top_chase_cards(cards, prices, args.count)
    if not top_cards:
        raise RuntimeError("No cards had matching price data -- check group_id is correct for this set")
    print(f"Selected top {len(top_cards)} cards:")
    for c in top_cards:
        print(f"  {c['name']} ({c['display_id']}) - ${c['price']:.2f}")

    with tempfile.TemporaryDirectory() as work_dir:
        image_cache_dir = os.path.join(work_dir, "images")
        os.makedirs(image_cache_dir, exist_ok=True)

        print("\nDownloading real card images...")
        image_paths = {}
        for card in top_cards:
            path = download_card_image(card, image_cache_dir)
            image_paths[card["display_id"]] = path
            print(f"  {card['name']} -> {path}")

        print("\nGenerating real narration audio (Chirp3 HD)...")
        audio_dir = os.path.join(work_dir, "audio")
        narration_results = synthesize_video_narrations(top_cards, audio_dir)

        print("\nGenerating real video frames...")
        frames_dir = os.path.join(work_dir, "frames")
        frames = generate_video_frames(
            narration_results,
            image_dir_fn=lambda card: image_paths[card["display_id"]],
            output_dir=frames_dir,
            countdown=True,
        )

        print(f"\nAssembling final video -> {args.output}")
        assemble_video(frames, args.output)

    print(f"\nDone. Test video saved to {args.output}")


if __name__ == "__main__":
    main()
