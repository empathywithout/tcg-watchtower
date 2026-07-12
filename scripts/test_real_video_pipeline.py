"""
test_real_video_pipeline.py

End-to-end test using REAL card data and REAL card images (not synthetic
test data) -- fetches a small number of real cards from the live
/api/cards endpoint, downloads their actual images, generates real
narration audio, and assembles a real short test video.

This is meant to be run via GitHub Actions (or any environment with
internet access) -- tcgwatchtower.com and the R2 image CDN aren't
reachable from a sandboxed environment without general internet access.

Requires: GOOGLE_APPLICATION_CREDENTIALS set (for narration), ffmpeg
available, and generate_narration_audio.py / generate_video_frames.py
in the same scripts/ directory.
"""

import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from generate_narration_audio import synthesize_video_narrations
from generate_video_frames import generate_video_frames, assemble_video

# Small, real test case -- adjust set/game/count as needed. Using only
# 3 cards keeps this fast to run and cheap to synthesize while still
# exercising the FULL real pipeline end to end.
TEST_SET = "me05"       # Pitch Black
TEST_GAME = "pokemon"
TEST_CARD_COUNT = 3
API_BASE = "https://tcgwatchtower.com"

WORK_DIR = "/tmp/real_pipeline_test"


def fetch_real_cards(set_id: str, game: str, count: int) -> list:
    """Fetch real card data from the live /api/cards endpoint."""
    url = f"{API_BASE}/api/cards?set={set_id}&game={game}"
    print(f"Fetching: {url}")
    with urllib.request.urlopen(url, timeout=30) as resp:
        import json
        data = json.loads(resp.read())

    cards = data.get("cards", [])
    if not cards:
        raise RuntimeError(f"No cards returned for set={set_id} game={game}. "
                            f"Response keys: {list(data.keys())}")

    # Prefer cards with a real price if available, for a more realistic test
    priced = [c for c in cards if c.get("price")]
    pool = priced if len(priced) >= count else cards
    selected = pool[:count]
    print(f"Selected {len(selected)} of {len(cards)} total cards for the test")
    return selected


def download_card_image(card: dict, dest_dir: str) -> str:
    """Download a card's real image from R2 to a local path."""
    image_url = card.get("image")
    if not image_url:
        raise RuntimeError(f"Card {card.get('name')} has no image URL in API response")

    dest_path = os.path.join(dest_dir, f"{card['display_id']}.webp")
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    print(f"Downloading image: {image_url}")
    urllib.request.urlretrieve(image_url, dest_path)
    return dest_path


def run_real_pipeline_test():
    images_dir = os.path.join(WORK_DIR, "images")
    audio_dir = os.path.join(WORK_DIR, "audio")
    frames_dir = os.path.join(WORK_DIR, "frames")
    output_video = os.path.join(WORK_DIR, "real_test_video.mp4")

    print("=== Step 1: Fetch real card data ===")
    cards = fetch_real_cards(TEST_SET, TEST_GAME, TEST_CARD_COUNT)
    for c in cards:
        # Normalize field names the pipeline expects, since raw API
        # responses vary in exactly which keys are present per game
        c.setdefault("rarity_label", c.get("rarity", ""))
        print(f"  - {c.get('name')} | {c.get('rarity_label')} | "
              f"#{c.get('display_id', c.get('localId'))} | ${c.get('price')}")

    print("\n=== Step 2: Download real card images ===")
    image_paths = {}
    for c in cards:
        try:
            image_paths[c["display_id"]] = download_card_image(c, images_dir)
        except Exception as e:
            print(f"  WARNING: failed to download image for {c.get('name')}: {e}")
            image_paths[c["display_id"]] = "/tmp/nonexistent.png"  # triggers fallback

    print("\n=== Step 3: Generate real narration audio (Chirp3 HD) ===")
    narration_results = synthesize_video_narrations(cards, audio_dir)

    print("\n=== Step 4: Generate real video frames ===")
    def image_dir_fn(card):
        return image_paths.get(card["display_id"], "/tmp/nonexistent.png")

    frames = generate_video_frames(narration_results, image_dir_fn, frames_dir, countdown=True)

    print("\n=== Step 5: Assemble final test video ===")
    result_path = assemble_video(frames, output_video)
    print(f"\nDone. Real test video: {result_path}")
    return result_path


if __name__ == "__main__":
    run_real_pipeline_test()
