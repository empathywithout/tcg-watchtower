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


def synthesize_narration(text: str, output_path: str, speaking_rate: float = 1.0, use_ssml: bool = False) -> str:
    """
    Synthesize a single narration string to an MP3 file.

    Args:
        text: the narration text, OR a full SSML string if use_ssml=True
        output_path: where to save the .mp3 file
        speaking_rate: 1.0 = normal. For narration (not punchy Shorts), 0.95-1.0
            tends to sound more natural than speeding up.
        use_ssml: if True, `text` is treated as SSML markup (must be wrapped
            in <speak>...</speak>) rather than plain text.

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
        name=VOICE_NAME,
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


def build_card_ssml(name: str, rarity: str, number: str, price: str, reason: str) -> str:
    """
    Build SSML for a card narration line with natural pauses and emphasis
    on the price (the actual point of the sentence). A short <break> after
    the card name gives the listener a beat to register what's being shown,
    and emphasis on the price stops it from being read in the same flat
    tone as everything else.
    """
    return f"""<speak>
    {name}<break time="200ms"/>, the {rarity} at number {number},
    is currently valued at <emphasis level="moderate">{price}</emphasis>.
    <break time="300ms"/>
    {reason}
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
            synthesize_narration(ssml, audio_path, use_ssml=True)
            text = ssml  # stored for reference/on-screen captions

        results.append({"card": card, "text": text, "audio_path": audio_path})
        print(f"  [{i+1}/{len(cards)}] {card['name']} -> {audio_path}")

    return results


if __name__ == "__main__":
    # Quick manual test -- requires GOOGLE_APPLICATION_CREDENTIALS to be set
    test_text = (
        "Number one on our chase card list is the Secret Rare Charizard, "
        "currently valued at ninety four dollars. With its striking illustration "
        "and the character's enduring popularity, this one continues to hold "
        "strong demand months after release."
    )
    path = synthesize_narration(test_text, "/tmp/test_narration.mp3")
    print(f"Test audio saved to {path}")
