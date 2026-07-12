"""
test_full_pipeline.py

Combined end-to-end test: real Chirp3 HD narration + real card data (live
API) + real card images + frame generation + ffmpeg assembly, producing
one actual sample video using Pitch Black's real current chase cards.

This exists specifically to judge the COMBINED result (voice + visuals +
pacing together) rather than testing each piece in isolation -- run once
via GitHub Actions before wiring this into full automation.

Requires network access to Google's TTS API and tcgwatchtower.com's live
API -- must run in GitHub Actions (or locally), not in a sandboxed
environment with restricted network access.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from generate_narration_audio import synthesize_video_narrations
from generate_video_frames import generate_video_frames, assemble_video
from fetch_chase_cards import get_chase_cards, download_card_image

SET_ID = "me05"  # Pitch Black
PHASE = "jp"      # still JP-only pricing until English release (July 17)
TOP_N = 8         # how many chase cards to include in this video


def fetch_card_image(card: dict) -> str:
    """
    Download this card's real image (URL already resolved by the API
    response). Falls back gracefully if the download fails --
    generate_card_frame() already handles a missing image by rendering a
    clear placeholder rather than crashing.
    """
    local_path = f"/tmp/card_images/{SET_ID}_{card['display_id']}.webp"
    return download_card_image(card, local_path)


if __name__ == "__main__":
    print(f"Step 1: Fetching real chase cards for {SET_ID} ({PHASE} phase)...")
    TEST_CARDS = get_chase_cards(SET_ID, phase=PHASE, top_n=TOP_N)
    if not TEST_CARDS:
        print("ERROR: No chase cards returned -- check API connectivity and set/phase params.")
        sys.exit(1)
    for c in TEST_CARDS:
        print(f"  {c['name']} — {c['rarity_label']} — #{c['display_id']} — ${c['price']}")

    print("\nStep 2: Generating narration audio...")
    narration_results = synthesize_video_narrations(
        TEST_CARDS, output_dir="/tmp/pipeline_test/audio"
    )

    print("\nStep 3: Generating video frames...")
    frames = generate_video_frames(
        narration_results,
        image_dir_fn=fetch_card_image,
        output_dir="/tmp/pipeline_test/frames",
        countdown=True,
    )

    print("\nStep 4: Assembling final video...")
    output_path = assemble_video(frames, "/tmp/pipeline_test/sample_video.mp4")

    print(f"\nDone. Sample video: {output_path}")
