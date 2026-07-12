"""
test_full_pipeline.py

Combined end-to-end test: real Chirp3 HD narration + real R2 card images +
frame generation + ffmpeg assembly, producing one actual sample video.

This exists specifically to judge the COMBINED result (voice + visuals +
pacing together) rather than testing each piece in isolation -- run once
via GitHub Actions before wiring this into full automation.

Requires network access to Google's TTS API and the R2 public bucket --
must run in GitHub Actions (or locally), not in a sandboxed environment
with restricted network access.
"""

import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from generate_narration_audio import synthesize_video_narrations
from generate_video_frames import generate_video_frames, assemble_video

R2_BASE = "https://pub-20ee170c554940ac8bfcce8af2da57a8.r2.dev"

# Real cards, real data -- picked from Pitch Black (your highest-traffic
# set) so this test reflects an actual video you might publish, not
# placeholder content.
TEST_CARDS = [
    {
        "name": "Charizard ex",
        "rarity_label": "Special Illustration Rare",
        "display_id": "199",
        "price": 94.50,
        "price_change_pct": 25,
        "character_name": "Charizard",
        "set_id": "me05",  # Pitch Black
    },
    {
        "name": "Pikachu ex",
        "rarity_label": "Secret Rare",
        "display_id": "205",
        "price": 42.00,
        "rarity_tier_rank": 1,
        "character_name": "Pikachu",
        "set_id": "me05",
    },
]


def fetch_card_image(card: dict) -> str:
    """
    Download a card's real image from R2 to a local temp path.
    Falls back gracefully (returns a path that doesn't exist) if the
    download fails -- generate_card_frame() already handles a missing
    image by rendering a clear placeholder rather than crashing.
    """
    local_path = f"/tmp/card_images/{card['set_id']}_{card['display_id']}.webp"
    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    if os.path.exists(local_path):
        return local_path

    url = f"{R2_BASE}/cards/{card['set_id']}/{card['display_id']}.webp"
    try:
        urllib.request.urlretrieve(url, local_path)
        print(f"  Downloaded: {url}")
        return local_path
    except Exception as e:
        print(f"  WARNING: could not download {url} ({e}) -- will use placeholder")
        return local_path  # doesn't exist, triggers the fallback path


if __name__ == "__main__":
    print("Step 1: Generating narration audio...")
    narration_results = synthesize_video_narrations(
        TEST_CARDS, output_dir="/tmp/pipeline_test/audio"
    )

    print("\nStep 2: Generating video frames...")
    frames = generate_video_frames(
        narration_results,
        image_dir_fn=fetch_card_image,
        output_dir="/tmp/pipeline_test/frames",
        countdown=True,
    )

    print("\nStep 3: Assembling final video...")
    output_path = assemble_video(frames, "/tmp/pipeline_test/sample_video.mp4")

    print(f"\nDone. Sample video: {output_path}")
