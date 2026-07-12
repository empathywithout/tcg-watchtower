"""
generate_video_frames.py

Generates per-card video frames (Pillow) sized and timed for the chase-cards
video format, then assembles them with narration audio (ffmpeg) into a final
video file.

Pipeline: generate_narration_audio.py (audio) -> this file (frames + assembly)

Requires: pip install Pillow
Requires: ffmpeg and ffprobe available on PATH (both present on GitHub
Actions ubuntu-latest runners by default, no install step needed there)
"""

import os
import subprocess
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ─── Video specs ────────────────────────────────────────────────────────────
# Long-form is the "master" recording; Shorts get cropped/extracted from it
# afterward rather than generated separately.
LONGFORM_SIZE = (1920, 1080)   # 16:9
SHORTS_SIZE = (1080, 1920)     # 9:16 -- available if a card ever needs a
                                # standalone Short frame instead of a crop

FONTS_DIR = Path(__file__).parent.parent / "assets" / "video-fonts"
FONT_BOLD = FONTS_DIR / "BigShoulders-Bold.ttf"
FONT_BODY_BOLD = FONTS_DIR / "Outfit-Bold.ttf"
FONT_BODY = FONTS_DIR / "Outfit-Regular.ttf"

# Matches the site's existing dark theme + amber accent branding
COLOR_BG = (15, 15, 20)
COLOR_BG_PANEL = (26, 26, 34)
COLOR_TEXT = (245, 245, 250)
COLOR_TEXT_MUTED = (160, 160, 175)
COLOR_AMBER = (245, 158, 11)  # matches --amber on the site

# Rarity-tier visual treatment -- higher rarities get a more premium look
# (gold border/glow), matching the "genuinely different visual design per
# tier" approach rather than a single template with just text swapped.
RARITY_STYLES = {
    "Secret Rare": {"border": (212, 175, 55), "glow": True},       # gold
    "Special Illustration Rare": {"border": (212, 175, 55), "glow": True},
    "Illustration Rare": {"border": (192, 192, 192), "glow": False},  # silver
    "Ultra Rare": {"border": (192, 192, 192), "glow": False},
    "Treasure Rare": {"border": (212, 175, 55), "glow": True},
    "Rare": {"border": (100, 149, 237), "glow": False},  # blue
}
DEFAULT_RARITY_STYLE = {"border": (100, 100, 110), "glow": False}


def get_rarity_style(rarity_label: str) -> dict:
    return RARITY_STYLES.get(rarity_label, DEFAULT_RARITY_STYLE)


def get_audio_duration(audio_path: str) -> float:
    """
    Get the duration of an audio file in seconds using ffprobe.
    This is what determines how long each card's frame stays on screen --
    synced to its actual narration length rather than a fixed guess.
    """
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            audio_path,
        ],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def _load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def generate_card_frame(
    card: dict,
    card_image_path: str,
    output_path: str,
    rank: int = None,
    size: tuple = LONGFORM_SIZE,
) -> str:
    """
    Generate a single frame: card art + name/rarity/number/price overlay,
    styled according to rarity tier.

    Args:
        card: dict with name, rarity_label (or rarity), display_id, price
        card_image_path: path to the card's art image (from your existing
            R2 image pipeline)
        output_path: where to save the frame (.png)
        rank: optional countdown rank number (e.g. 3 for "#3") to show for
            chase-card countdown style videos
        size: (width, height) -- defaults to long-form 16:9

    Returns:
        output_path
    """
    width, height = size
    rarity = card.get("rarity_label", card.get("rarity", ""))
    style = get_rarity_style(rarity)

    frame = Image.new("RGB", (width, height), COLOR_BG)
    draw = ImageDraw.Draw(frame)

    # ── Card art panel (left half) ──────────────────────────────────────
    art_panel_w = int(width * 0.45)
    art_margin = 60
    try:
        card_img = Image.open(card_image_path).convert("RGB")
    except (FileNotFoundError, OSError):
        # Fallback placeholder so a missing image doesn't crash a whole
        # batch render -- shows clearly it's missing rather than failing silently
        card_img = Image.new("RGB", (600, 837), COLOR_BG_PANEL)
        ph_draw = ImageDraw.Draw(card_img)
        ph_font = _load_font(FONT_BODY, 32)
        ph_draw.text((40, 400), "Image not found", fill=COLOR_TEXT_MUTED, font=ph_font)

    # Scale card art to fit the art panel while preserving aspect ratio
    art_max_h = height - (art_margin * 2)
    art_max_w = art_panel_w - (art_margin * 2)
    card_img.thumbnail((art_max_w, art_max_h), Image.LANCZOS)

    # Rarity-tinted border around the card art
    border_thickness = 8 if style["border"] else 0
    bordered = Image.new(
        "RGB",
        (card_img.width + border_thickness * 2, card_img.height + border_thickness * 2),
        style["border"],
    )
    bordered.paste(card_img, (border_thickness, border_thickness))

    art_x = (art_panel_w - bordered.width) // 2
    art_y = (height - bordered.height) // 2
    frame.paste(bordered, (art_x, art_y))

    # ── Text panel (right half) ─────────────────────────────────────────
    text_x = art_panel_w + 80
    text_y = height // 2 - 220

    if rank is not None:
        rank_font = _load_font(FONT_BOLD, 90)
        draw.text((text_x, text_y), f"#{rank}", fill=COLOR_AMBER, font=rank_font)
        text_y += 120

    name_font = _load_font(FONT_BOLD, 64)
    # Wrap long card names rather than letting them run off-frame
    name = card["name"]
    max_name_width = width - text_x - 80
    if draw.textlength(name, font=name_font) > max_name_width:
        name_font = _load_font(FONT_BOLD, 48)
    draw.text((text_x, text_y), name, fill=COLOR_TEXT, font=name_font)
    text_y += 90

    rarity_font = _load_font(FONT_BODY_BOLD, 36)
    rarity_line = f"{rarity}  •  #{card['display_id']}"
    draw.text((text_x, text_y), rarity_line, fill=style["border"] or COLOR_TEXT_MUTED, font=rarity_font)
    text_y += 70

    price = card.get("price")
    price_str = f"${price:.2f}" if price else "Price unavailable"
    price_font = _load_font(FONT_BOLD, 80)
    draw.text((text_x, text_y), price_str, fill=COLOR_AMBER, font=price_font)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    frame.save(output_path)
    return output_path


def generate_video_frames(narration_results: list, image_dir_fn, output_dir: str, countdown: bool = False) -> list:
    """
    Batch-generate frames for every card in a video, paired with each
    card's actual audio duration.

    Args:
        narration_results: output of synthesize_video_narrations() --
            list of {"card": ..., "text": ..., "audio_path": ...}
        image_dir_fn: function that takes a card dict and returns the local
            path to its card art image (wired to your existing R2 fetch/cache,
            passed in rather than imported so this file has no dependency on
            where that lives)
        output_dir: directory to write frame .png files into
        countdown: if True, ranks cards in reverse order (#N down to #1) --
            typical for "top chase cards" countdown-style videos

    Returns:
        List of dicts: [{"frame_path": ..., "duration": seconds, "audio_path": ...}, ...]
        Ready for assemble_video().
    """
    total = len(narration_results)
    frames = []
    for i, item in enumerate(narration_results):
        card = item["card"]
        rank = (total - i) if countdown else None
        frame_path = os.path.join(output_dir, f"{i:03d}_{card['display_id']}.png")
        image_path = image_dir_fn(card)
        generate_card_frame(card, image_path, frame_path, rank=rank)
        duration = get_audio_duration(item["audio_path"])
        frames.append({
            "frame_path": frame_path,
            "duration": duration,
            "audio_path": item["audio_path"],
        })
        print(f"  [{i+1}/{total}] {card['name']} -> {frame_path} ({duration:.1f}s)")

    return frames


def assemble_video(frames: list, output_path: str, size: tuple = LONGFORM_SIZE) -> str:
    """
    Assemble frames + audio into a final video using ffmpeg. Each frame is
    held on screen for exactly its paired audio duration, and all per-card
    audio clips are concatenated into a single track synced to the frames.

    Args:
        frames: output of generate_video_frames()
        output_path: where to save the final .mp4
        size: must match the frame size used in generate_video_frames()

    Returns:
        output_path
    """
    work_dir = Path(output_path).parent
    work_dir.mkdir(parents=True, exist_ok=True)

    # Build an ffmpeg concat-demuxer list for the image sequence, each
    # entry held for its own duration
    concat_list_path = work_dir / "frames_concat.txt"
    with open(concat_list_path, "w") as f:
        for frame in frames:
            f.write(f"file '{os.path.abspath(frame['frame_path'])}'\n")
            f.write(f"duration {frame['duration']}\n")
        # ffmpeg's concat demuxer requires the last file repeated without
        # a duration line, or the final frame gets cut short
        f.write(f"file '{os.path.abspath(frames[-1]['frame_path'])}'\n")

    # Build an ffmpeg concat-demuxer list for the audio track
    audio_concat_path = work_dir / "audio_concat.txt"
    with open(audio_concat_path, "w") as f:
        for frame in frames:
            f.write(f"file '{os.path.abspath(frame['audio_path'])}'\n")

    silent_video_path = work_dir / "_silent_video.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list_path),
        # Constant frame rate output (not vsync vfr) -- variable frame
        # rate with very long per-frame hold times (each "frame" here is
        # really one image held for several seconds) can make some
        # players/codecs stutter or delay before showing the correct
        # frame, especially the first one, since there are very few
        # actual encoded frames with large gaps between their timestamps.
        # Forcing a standard 30fps constant rate re-encodes each still
        # image as many identical frames instead, which is far more
        # broadly compatible for immediate, correct playback.
        "-r", "30",
        "-pix_fmt", "yuv420p",
        "-s", f"{size[0]}x{size[1]}",
        str(silent_video_path),
    ], check=True, capture_output=True)

    combined_audio_path = work_dir / "_combined_audio.mp3"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(audio_concat_path),
        "-c", "copy",
        str(combined_audio_path),
    ], check=True, capture_output=True)

    subprocess.run([
        "ffmpeg", "-y",
        "-i", str(silent_video_path),
        "-i", str(combined_audio_path),
        "-map", "0:v:0", "-map", "1:a:0",  # explicit mapping -- without
        # this, ffmpeg's automatic stream selection across two separate
        # inputs isn't guaranteed to pick both a video AND an audio
        # stream; this is a common, easy-to-miss cause of a muxed file
        # that plays but has no audio track at all.
        "-c:v", "copy", "-c:a", "aac",
        "-shortest",
        output_path,
    ], check=True, capture_output=True)

    # Verify the output actually has an audio stream before returning --
    # catches this exact failure mode immediately instead of it only
    # surfacing when someone plays the video back.
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", output_path],
        capture_output=True, text=True,
    )
    if not probe.stdout.strip():
        print(f"  WARNING: {output_path} has NO audio stream after assembly -- "
              f"something in the mux step failed silently.")
    else:
        print(f"  Verified: {output_path} has an audio stream present.")

    return output_path


if __name__ == "__main__":
    # Quick manual test with a dummy card and no real image (exercises the
    # placeholder fallback path) -- confirms frame generation and layout
    # without needing real R2 assets or narration audio.
    test_card = {
        "name": "Charizard ex",
        "rarity_label": "Secret Rare",
        "display_id": "199",
        "price": 94.50,
    }
    frame_path = generate_card_frame(
        test_card,
        card_image_path="/tmp/nonexistent.png",  # exercises fallback path
        output_path="/tmp/test_frame.png",
        rank=1,
    )
    print(f"Test frame saved to {frame_path}")
