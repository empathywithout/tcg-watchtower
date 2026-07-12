"""
generate_narration_audio.py

Converts per-card narration text (from the narration template) into audio files
using Google Cloud Text-to-Speech, ready to be synced with Pillow-generated
frames in the ffmpeg assembly step.

Auth: expects GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service
account JSON key file. In GitHub Actions, store the JSON as a repo secret
(e.g. GCP_TTS_KEY) and write it to a temp file at the start of the workflow:

    - name: Write GCP credentials
      run: echo '${{ secrets.GCP_TTS_KEY }}' > /tmp/gcp-key.json
      env:
        GOOGLE_APPLICATION_CREDENTIALS: /tmp/gcp-key.json

Requires: pip install google-cloud-texttospeech
"""

import os
from pathlib import Path
from google.cloud import texttospeech

# Neural2 voices are included in the free tier (same tier as WaveNet) and
# sound noticeably more natural than Standard voices. en-US-Neural2-D is a
# clear, neutral male voice; swap for -F/-C etc. for other tones.
VOICE_NAME = "en-US-Neural2-D"
LANGUAGE_CODE = "en-US"

_client = None


def get_client():
    """Lazily instantiate the client so import doesn't fail without credentials set."""
    global _client
    if _client is None:
        _client = texttospeech.TextToSpeechClient()
    return _client


def synthesize_narration(text: str, output_path: str, speaking_rate: float = 1.0, use_ssml: bool = False, voice_name: str = None) -> str:
    """
    Synthesize a single narration string to an MP3 file.

    Args:
        text: the narration text, OR a full SSML string if use_ssml=True
        output_path: where to save the .mp3 file
        speaking_rate: 1.0 = normal. For narration (not punchy Shorts), 0.95-1.0
            tends to sound more natural than speeding up.
        use_ssml: if True, `text` is treated as SSML markup (must be wrapped
            in <speak>...</speak>) rather than plain text.
        voice_name: override the module-level VOICE_NAME for this call only
            (used for A/B testing different voices without changing the default).

    Returns:
        The output_path, for chaining into the ffmpeg step.
    """
    client = get_client()

    if use_ssml:
        synthesis_input = texttospeech.SynthesisInput(ssml=text)
    else:
        synthesis_input = texttospeech.SynthesisInput(text=text)

    voice = texttospeech.VoiceSelectionParams(
        language_code=LANGUAGE_CODE,
        name=voice_name or VOICE_NAME,
    )
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=speaking_rate,
    )

    response = client.synthesize_speech(
        input=synthesis_input, voice=voice, audio_config=audio_config
    )

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as out:
        out.write(response.audio_content)

    return output_path


import re
import random

# Raw rarity codes (especially Kayou's -- SE, TR, XR, SSR, etc.) and other
# common TCG abbreviations don't read naturally as letters. This maps them
# to how they should actually be SPOKEN, without changing what's shown on
# screen (that stays as-is in your video's visual overlay).
PRONUNCIATION_SUBSTITUTIONS = {
    # Kayou-style single/double letter codes
    "SE": "S E",
    "SP": "S P",
    "BP": "B P",
    "MR": "Miracle Rare",
    "PU": "P U",
    "PTR": "P T R",
    "UR": "Ultra Rare",
    "SSR": "Super Secret Rare",
    "SR": "Super Rare",
    "TR": "Treasure Rare",
    "XR": "X R",
    "QR": "Q R",
    # Common Pokemon/One Piece abbreviations that read oddly literally
    "GX": "G X",
    "EX": "E X",
    "VMAX": "V Max",
    "VSTAR": "V Star",
}


def apply_pronunciation_fixes(text: str) -> str:
    """
    Wrap any known raw code/abbreviation in the text with an SSML <sub>
    tag so it's pronounced correctly, without altering the visible text
    elsewhere. Only matches whole words (word boundaries) so this doesn't
    accidentally rewrite letters inside a normal word.
    """
    for code, spoken in PRONUNCIATION_SUBSTITUTIONS.items():
        pattern = r'\b' + re.escape(code) + r'\b'
        replacement = f'<sub alias="{spoken}">{code}</sub>'
        text = re.sub(pattern, replacement, text)
    return text


def build_card_ssml(name: str, rarity: str, number: str, price: str, reason: str) -> str:
    """
    Build SSML for a card narration line with natural pauses, emphasis,
    and pronunciation fixes.

    - <break> after the card name gives the listener a beat to register
      what's being shown.
    - <say-as interpret-as="currency"> ensures the price reads naturally
      ("ninety four dollars and fifty cents") instead of risking odd
      digit-by-digit reading.
    - <prosody rate="90%"> slows down specifically on the price -- real
      narrators often pace DOWN on the number that matters, not just
      stress it.
    - Rarity and reason both get pronunciation fixes applied, since raw
      codes (Kayou's SE/TR/XR etc.) can appear directly in either.
    """
    rarity_fixed = apply_pronunciation_fixes(rarity)
    reason_fixed = apply_pronunciation_fixes(reason)
    # Strip the $ since say-as currency handles the symbol itself
    price_value = price.replace("$", "").strip()

    return f"""<speak>
    {name}<break time="200ms"/>, the {rarity_fixed} at number {number},
    is currently valued at
    <prosody rate="90%"><say-as interpret-as="currency" language="en-US">USD{price_value}</say-as></prosody>.
    <break time="300ms"/>
    {reason_fixed}
    </speak>"""


REASON_TEMPLATES = {
    "high_rarity": "With only {print_context} in circulation, that scarcity is driving real demand.",
    "character_popularity": "{character} being a fan favorite is a big part of what's pushing this price.",
    "trend_up": "Prices have moved up since release, which is worth watching if you're holding one.",
    "art_focus": "The alternate art on this one is a big part of the appeal for collectors.",
    "": "",  # fallback: no reason line rather than a forced generic one
}


def infer_reason_key(card: dict) -> str:
    """
    Simple rule-based inference for which reason template fits a card,
    based on data you already have. Human review (per your existing
    workflow) should catch anything that reads oddly before publishing --
    this just picks a reasonable starting point automatically rather than
    requiring a manual choice for every single card.
    """
    if card.get("price_change_pct", 0) > 20:
        return "trend_up"
    if card.get("rarity_tier_rank", 99) <= 2:  # top 2 rarity tiers in the set
        return "high_rarity"
    if card.get("variant_type") in ("altArt", "specialAltArt", "mangaAltArt"):
        return "art_focus"
    return ""  # no forced reason if nothing clearly applies


def build_reason(card: dict) -> str:
    key = infer_reason_key(card)
    template = REASON_TEMPLATES.get(key, "")
    return template.format(
        character=card.get("character_name", card.get("name", "")),
        print_context=card.get("print_context", "a limited print run"),
    )


def synthesize_video_narrations(cards: list, output_dir: str, narration_fn=None) -> list:
    """
    Batch-synthesize narration audio for every card in a video, in order.

    Args:
        cards: list of card dicts (same shape as your existing card data).
            Expected keys used here: name, rarity_label, display_id, price
            (and optionally: price_change_pct, rarity_tier_rank, variant_type,
            character_name, print_context -- for reason inference)
        output_dir: directory to write per-card mp3 files into
        narration_fn: OPTIONAL override. If provided, its plain-text output
            is used instead of the automatic SSML path (useful if you want
            full manual control over a specific card's script). If omitted
            (the default), every card automatically gets SSML with natural
            pauses and price emphasis via build_card_ssml().

    Returns:
        List of dicts: [{"card": card, "text": narration_text, "audio_path": path}, ...]
        Ready to hand to the ffmpeg assembly step, which needs both the text
        (for on-screen captions, optional) and the audio file (for timing).
    """
    results = []
    for i, card in enumerate(cards):
        if narration_fn is not None:
            text = narration_fn(card)
            audio_path = os.path.join(output_dir, f"{i:03d}_{card['display_id']}.mp3")
            synthesize_narration(text, audio_path)
        else:
            price_str = f"${card['price']:.2f}" if card.get("price") else "an unconfirmed price"
            reason = build_reason(card)
            ssml = build_card_ssml(
                name=card["name"],
                rarity=card.get("rarity_label", card.get("rarity", "")),
                number=card["display_id"],
                price=price_str,
                reason=reason,
            )
            audio_path = os.path.join(output_dir, f"{i:03d}_{card['display_id']}.mp3")
            # Small random variance per card (0.97-1.03) -- a real narrator
            # never speaks at the exact same rate on every sentence, and
            # that metronomic consistency across 20+ cards is one of the
            # more subtle "this is synthetic" tells in a full video.
            rate = random.uniform(0.97, 1.03)
            synthesize_narration(ssml, audio_path, speaking_rate=rate, use_ssml=True)
            text = ssml  # stored for reference/on-screen captions

        results.append({"card": card, "text": text, "audio_path": audio_path})
        print(f"  [{i+1}/{len(cards)}] {card['name']} -> {audio_path}")

    return results


if __name__ == "__main__":
    # Quick manual test -- requires GOOGLE_APPLICATION_CREDENTIALS to be set
    test_card = {
        "name": "Charizard ex",
        "rarity_label": "Special Illustration Rare",
        "display_id": "199",
        "price": 94.50,
        "price_change_pct": 25,
        "character_name": "Charizard",
    }
    reason = build_reason(test_card)
    ssml = build_card_ssml(
        name=test_card["name"],
        rarity=test_card["rarity_label"],
        number=test_card["display_id"],
        price=f"${test_card['price']:.2f}",
        reason=reason,
    )

    # Compare a handful of free Neural2 voices on the exact same sentence.
    # Listen to all of these side by side to pick the best fit before
    # committing to one for the full pipeline -- swap VOICE_NAME above
    # once you've decided.
    VOICES_TO_COMPARE = [
        "en-US-Neural2-D",  # current default -- male
        "en-US-Neural2-J",  # male, different tone
        "en-US-Neural2-F",  # female
        "en-US-Neural2-A",  # male
        "en-US-Neural2-C",  # female
    ]

    for voice_name in VOICES_TO_COMPARE:
        output_path = f"/tmp/voice_test_{voice_name}.mp3"
        synthesize_narration(ssml, output_path, use_ssml=True, voice_name=voice_name)
        print(f"Generated: {output_path}")
