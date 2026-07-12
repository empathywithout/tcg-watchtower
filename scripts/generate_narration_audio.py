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

# Chirp3 HD voices offer noticeably more natural intonation than Neural2,
# but are NOT free tier -- $30/1M characters. en-US-Chirp3-HD-Charon was
# chosen after A/B testing against the best Neural2 candidates directly.
VOICE_NAME = "en-US-Chirp3-HD-Charon"
LANGUAGE_CODE = "en-US"

_client = None


def get_client():
    """Lazily instantiate the client so import doesn't fail without credentials set."""
    global _client
    if _client is None:
        _client = texttospeech.TextToSpeechClient()
    return _client


def synthesize_narration(text: str, output_path: str, speaking_rate: float = 1.0, pitch: float = 0.0, use_ssml: bool = False, voice_name: str = None) -> str:
    """
    Synthesize a single narration string to an MP3 file.

    Args:
        text: the narration text, OR a full SSML string if use_ssml=True
        output_path: where to save the .mp3 file
        speaking_rate: 1.0 = normal. For narration (not punchy Shorts), 0.95-1.0
            tends to sound more natural than speeding up.
        pitch: semitone shift, 0.0 = default. Small variance (-1.0 to 1.0)
            per card adds to the same anti-monotony effect as rate variance.
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

    # Chirp3 HD voices don't support speaking_rate/pitch as AudioConfig
    # params (per Google's docs) -- only include them for non-Chirp voices
    # to avoid a request that either errors or silently does nothing.
    is_chirp = "Chirp" in (voice_name or VOICE_NAME)
    if is_chirp:
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
        )
    else:
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=speaking_rate,
            pitch=pitch,
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
# Codes that should be SPELLED OUT letter by letter (E-X, not a blended
# "ex" sound). Handled via SSML <say-as interpret-as="characters">, which
# forces true distinct letter-by-letter pronunciation -- confirmed working
# for both Neural2 and Chirp3 HD.
SPELL_OUT_CODES = ["SE", "SP", "BP", "PU", "PTR", "XR", "QR", "GX"]

# "EX" gets a dedicated IPA phoneme override rather than the generic
# say-as characters treatment above. say-as spells the letters correctly
# but doesn't give any control over how long each one is held -- the "E"
# was coming out too short/clipped. <phoneme> lets us specify the exact
# sound directly: /iː/ is the standard IPA long-E sound (the letter name
# "E"), and the extra length mark draws it out further specifically
# because the default read wasn't holding it long enough. This is one
# specific, deliberately tuned case, not a general pattern -- extend this
# dict directly if other codes need similar hand-tuning after listening.
PHONEME_OVERRIDES = {
    "EX": "iːː ɛks",
}

# Pokemon character names the TTS engine mispronounces. Unlike the rarity
# codes above, I can't verify these by ear myself -- no audio access from
# my sandbox. Each entry below needs to be confirmed by actually listening
# to the generated audio and adjusting if it's still off.
#
# Source for accurate respellings/IPA: Bulbapedia's pronunciation guide --
# https://bulbapedia.bulbagarden.net/wiki/User:SnorlaxMonster/Pronunciation
# (sourced from official Pokemon Company materials, not fan guesswork)
#
# "Darkrai" below is the one entry with real confirmation: official movie
# dub audio ("The Rise of Darkrai") uses "Dark-rye" (rhyming with "eye"),
# not "Dark-ray" -- confirmed via a Bulbapedia talk-page discussion, not
# just assumed from spelling.
#
# The other Pitch Black names (Zeraora, Chandelure, Excadrill) are left as
# clearly-marked placeholders using my best phonetic guess from their word
# construction, NOT verified pronunciations -- listen to real output and
# replace these with the actual correct IPA/respelling once you hear what's
# actually wrong.
POKEMON_NAME_PHONEMES = {
    "Darkrai": "dˈɑːɹkɹˈaɪ",  # confirmed: official dub uses "Dark-rye"
    # TODO -- verify by ear, these are unconfirmed best guesses:
    "Zeraora": "zɛɹˈaʊɹə",       # guessed from Japanese ゼラオラ romanization
    "Chandelure": "ʃˈændəlʊɹ",   # guessed from "chandelier" + "-lure"
    "Excadrill": "ˈɛkskədɹɪl",   # guessed from "excavate" + "drill"
}


def apply_name_pronunciation_fixes(name: str) -> str:
    """
    Wrap a known-tricky Pokemon character name in an SSML <phoneme> tag.
    Only exact matches from POKEMON_NAME_PHONEMES get touched -- anything
    not in the dict passes through untouched, so this only ever helps,
    never risks breaking a name that already sounds fine.

    Add new entries here as you identify specific mispronunciations by
    listening to real generated audio -- this dict is meant to grow
    incrementally, not be solved all at once.
    """
    for name_part, ipa in POKEMON_NAME_PHONEMES.items():
        pattern = r'\b' + re.escape(name_part) + r'\b'
        name = re.sub(
            pattern,
            lambda m: f'<phoneme alphabet="ipa" ph="{ipa}">{m.group(0)}</phoneme>',
            name,
            flags=re.IGNORECASE,
        )
    return name

# Codes that should be read as their full expanded word instead of
# spelled out (e.g. "TR" -> "Treasure Rare", not "T-R").
WORD_SUBSTITUTIONS = {
    "MR": "Miracle Rare",
    "UR": "Ultra Rare",
    "SSR": "Super Secret Rare",
    "SR": "Super Rare",
    "TR": "Treasure Rare",
    "VMAX": "V Max",
    "VSTAR": "V Star",
}


def apply_pronunciation_fixes(text: str) -> str:
    """
    Wrap any known raw code/abbreviation in the text with the correct SSML
    tag so it's pronounced correctly, without altering the visible text
    elsewhere. Only matches whole words (word boundaries) so this doesn't
    accidentally rewrite letters inside a normal word.

    Three categories, handled differently:
    - PHONEME_OVERRIDES (currently just EX) use <phoneme alphabet="ipa">
      for direct control over the exact sound and duration, since the
      generic character-spelling approach wasn't holding the "E" long
      enough and there's no <prosody> tag available on Chirp3 HD to fix
      that a different way.
    - SPELL_OUT_CODES (GX, XR, etc.) use <say-as interpret-as=
      "characters">, which forces genuinely distinct letter-by-letter
      pronunciation ("E... X...").
    - WORD_SUBSTITUTIONS (TR -> Treasure Rare, etc.) use <sub alias="...">,
      since these should be read as their expanded word, not spelled out.

    Matching is case-insensitive: Pokemon's modern "ex" cards are styled
    lowercase (e.g. "Charizard ex"), while older-era "EX" cards are
    uppercase -- both need the same treatment. The originally-matched
    text's actual casing is preserved as the visible tag content either way.
    """
    for code, ipa in PHONEME_OVERRIDES.items():
        pattern = r'\b' + re.escape(code) + r'\b'
        text = re.sub(
            pattern,
            lambda m: f'<phoneme alphabet="ipa" ph="{ipa}">{m.group(0)}</phoneme>',
            text,
            flags=re.IGNORECASE,
        )

    for code in SPELL_OUT_CODES:
        pattern = r'\b' + re.escape(code) + r'\b'
        text = re.sub(
            pattern,
            lambda m: f'<say-as interpret-as="characters">{m.group(0)}</say-as>',
            text,
            flags=re.IGNORECASE,
        )

    for code, spoken in WORD_SUBSTITUTIONS.items():
        pattern = r'\b' + re.escape(code) + r'\b'
        text = re.sub(
            pattern,
            lambda m: f'<sub alias="{spoken}">{m.group(0)}</sub>',
            text,
            flags=re.IGNORECASE,
        )
    return text


def build_card_ssml(name: str, rarity: str, number: str, price: str, reason: str) -> str:
    """
    Build SSML for a card narration line, for Neural2 voices.

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
    name_fixed = apply_name_pronunciation_fixes(name)
    rarity_fixed = apply_pronunciation_fixes(rarity)
    reason_fixed = apply_pronunciation_fixes(reason)
    # Strip the $ since say-as currency handles the symbol itself
    price_value = price.replace("$", "").strip()

    return f"""<speak>
    {name_fixed}<break time="200ms"/>, the {rarity_fixed} at number {number},
    is currently valued at
    <prosody rate="90%"><say-as interpret-as="currency" language="en-US">USD{price_value}</say-as></prosody>.
    <break time="300ms"/>
    {reason_fixed}
    </speak>"""


def build_card_ssml_chirp(name: str, rarity: str, number: str, price: str, reason: str) -> str:
    """
    Build SSML for a card narration line, for Chirp3 HD voices specifically.

    Chirp3 HD's SSML support is a DIFFERENT, more limited subset than
    Neural2's -- confirmed via Google's official release notes: only
    <phoneme>, <p>, <s>, <sub>, and <say-as> are supported. Notably NOT
    supported: <break>, <emphasis>, <prosody>. Rate/pitch as separate
    AudioConfig parameters also aren't supported for Chirp voices.

    This version drops the unsupported tags entirely rather than including
    them and hoping they're silently ignored -- <s> (sentence) boundaries
    provide some natural pacing on their own even without explicit <break>.
    """
    name_fixed = apply_name_pronunciation_fixes(name)
    rarity_fixed = apply_pronunciation_fixes(rarity)
    reason_fixed = apply_pronunciation_fixes(reason)
    price_value = price.replace("$", "").strip()

    return f"""<speak>
    <s>{name_fixed}, the {rarity_fixed} at number {number}, is currently valued at <say-as interpret-as="currency" language="en-US">USD{price_value}</say-as>.</s>
    <s>{reason_fixed}</s>
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
            is_chirp = "Chirp" in VOICE_NAME
            builder = build_card_ssml_chirp if is_chirp else build_card_ssml
            ssml = builder(
                name=card["name"],
                rarity=card.get("rarity_label", card.get("rarity", "")),
                number=card["display_id"],
                price=price_str,
                reason=reason,
            )
            audio_path = os.path.join(output_dir, f"{i:03d}_{card['display_id']}.mp3")
            if is_chirp:
                # Chirp3 HD doesn't support rate/pitch AudioConfig params,
                # so there's no variance to add here -- synthesize_narration
                # already skips them automatically for Chirp voice names.
                synthesize_narration(ssml, audio_path, use_ssml=True)
            else:
                # Small random variance per card (rate 0.97-1.03, pitch +/-1
                # semitone) -- a real narrator never speaks at the exact same
                # rate and pitch on every sentence.
                rate = random.uniform(0.97, 1.03)
                pitch_shift = random.uniform(-1.0, 1.0)
                synthesize_narration(ssml, audio_path, speaking_rate=rate, pitch=pitch_shift, use_ssml=True)
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
        "en-US-Neural2-F",  # current default -- winner of the first round
        "en-US-Neural2-J",  # runner-up from the first round
        "en-US-Chirp3-HD-Aoede",   # Chirp3 HD, female
        "en-US-Chirp3-HD-Charon",  # Chirp3 HD, male
        "en-US-Chirp3-HD-Leda",    # Chirp3 HD, female
        "en-US-Chirp3-HD-Kore",    # Chirp3 HD, female
    ]

    for voice_name in VOICES_TO_COMPARE:
        output_path = f"/tmp/voice_test_{voice_name}.mp3"
        if "Chirp" in voice_name:
            # Chirp3 HD only supports a limited SSML tag subset --
            # use the dedicated builder rather than the Neural2 one.
            chirp_ssml = build_card_ssml_chirp(
                name=test_card["name"],
                rarity=test_card["rarity_label"],
                number=test_card["display_id"],
                price=f"${test_card['price']:.2f}",
                reason=reason,
            )
            synthesize_narration(chirp_ssml, output_path, use_ssml=True, voice_name=voice_name)
        else:
            synthesize_narration(ssml, output_path, use_ssml=True, voice_name=voice_name)
        print(f"Generated: {output_path}")
