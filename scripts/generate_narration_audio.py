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


def synthesize_narration(text: str, output_path: str, speaking_rate: float = 1.0) -> str:
    """
    Synthesize a single narration string to an MP3 file.

    Args:
        text: the narration text (output of build_narration() from the script template)
        output_path: where to save the .mp3 file
        speaking_rate: 1.0 = normal. Slightly above 1.0 (e.g. 1.05-1.1) can help
            pacing feel snappier for short-form content without sounding rushed.

    Returns:
        The output_path, for chaining into the ffmpeg step.
    """
    client = get_client()

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


def synthesize_video_narrations(cards: list, output_dir: str, narration_fn) -> list:
    """
    Batch-synthesize narration audio for every card in a video, in order.

    Args:
        cards: list of card dicts (same shape as your existing card data)
        output_dir: directory to write per-card mp3 files into
        narration_fn: the build_narration() function from the script template
            (passed in rather than imported, so this file has no dependency
            on where that template lives)

    Returns:
        List of dicts: [{"card": card, "text": narration_text, "audio_path": path}, ...]
        Ready to hand to the ffmpeg assembly step, which needs both the text
        (for on-screen captions, optional) and the audio file (for timing).
    """
    results = []
    for i, card in enumerate(cards):
        text = narration_fn(card)
        audio_path = os.path.join(output_dir, f"{i:03d}_{card['display_id']}.mp3")
        synthesize_narration(text, audio_path)
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
