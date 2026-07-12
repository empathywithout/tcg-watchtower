"""
generate_pinterest_pins.py

Generates Pinterest pin images in the two styles established earlier:
- "Reveal" pins: clean card art + curation-style title, for reach/engagement
- "Price-guide" pins: data overlay with price info, for buyer-intent search

Pinterest's recommended spec: 2:3 aspect ratio, 1000x1500px.
Reuses the same font assets and dark/amber branding as the video frames
(assets/video-fonts/) for visual consistency across the site's content.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PIN_SIZE = (1000, 1500)  # 2:3, Pinterest's recommended spec

FONTS_DIR = Path(__file__).parent.parent / "assets" / "video-fonts"
FONT_BOLD = FONTS_DIR / "BigShoulders-Bold.ttf"
FONT_BODY_BOLD = FONTS_DIR / "Outfit-Bold.ttf"
FONT_BODY = FONTS_DIR / "Outfit-Regular.ttf"

COLOR_BG = (15, 15, 20)
COLOR_BG_PANEL = (26, 26, 34)
COLOR_TEXT = (245, 245, 250)
COLOR_TEXT_MUTED = (160, 160, 175)
COLOR_AMBER = (245, 158, 11)

RARITY_STYLES = {
    "Secret Rare": {"border": (212, 175, 55)},
    "Special Illustration Rare": {"border": (212, 175, 55)},
    "Mega Hyper Rare": {"border": (212, 175, 55)},
    "Illustration Rare": {"border": (192, 192, 192)},
    "Ultra Rare": {"border": (192, 192, 192)},
    "Treasure Rare": {"border": (212, 175, 55)},
    "Rare": {"border": (100, 149, 237)},
}
DEFAULT_RARITY_STYLE = {"border": (100, 100, 110)}


def _load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def _wrap_text(draw, text, font, max_width):
    """Simple word-wrap for the title text areas."""
    words = text.split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _truncate_to_width(draw, text, font, max_width):
    """Truncates text with an ellipsis if it exceeds max_width, keeping
    label height predictable (single line) rather than wrapping."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "...", font=font) > max_width:
        text = text[:-1]
    return text + "..."


def generate_reveal_pin(card_image_path: str, title: str, output_path: str) -> str:
    """
    "Reveal" style: clean card art dominates, minimal text overlay --
    for reach/emotional engagement, matching the format competitors
    already use successfully (e.g. "All Secret Rares Revealed").
    """
    width, height = PIN_SIZE
    pin = Image.new("RGB", (width, height), COLOR_BG)
    draw = ImageDraw.Draw(pin)

    try:
        card_img = Image.open(card_image_path).convert("RGB")
    except (FileNotFoundError, OSError):
        card_img = Image.new("RGB", (600, 837), COLOR_BG_PANEL)

    art_max_w = width - 80
    art_max_h = int(height * 0.72)
    card_img.thumbnail((art_max_w, art_max_h), Image.LANCZOS)

    title_font = _load_font(FONT_BOLD, 56)
    lines = _wrap_text(draw, title, title_font, width - 100)
    line_height = 68
    title_block_height = len(lines) * line_height

    # Compute total content height (art + gap + title block) and center
    # the whole composition vertically, rather than anchoring to the top
    # and leaving unused space below -- real dead space in the first draft.
    gap = 40
    total_height = card_img.height + gap + title_block_height
    start_y = (height - total_height) // 2

    art_x = (width - card_img.width) // 2
    art_y = start_y
    pin.paste(card_img, (art_x, art_y))

    text_y = art_y + card_img.height + gap
    for line in lines:
        line_width = draw.textlength(line, font=title_font)
        draw.text(((width - line_width) // 2, text_y), line, fill=COLOR_TEXT, font=title_font)
        text_y += line_height

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    pin.save(output_path)
    return output_path


def generate_price_guide_pin(card: dict, card_image_path: str, title: str, output_path: str) -> str:
    """
    "Price-guide" style: data overlay with price info -- for buyer-intent
    search traffic, not just reach. Rarity-tinted border matches the
    video frames' visual language for consistency across content types.
    """
    width, height = PIN_SIZE
    rarity = card.get("rarity_label", card.get("rarity", ""))
    style = RARITY_STYLES.get(rarity, DEFAULT_RARITY_STYLE)

    pin = Image.new("RGB", (width, height), COLOR_BG)
    draw = ImageDraw.Draw(pin)

    try:
        card_img = Image.open(card_image_path).convert("RGB")
    except (FileNotFoundError, OSError):
        card_img = Image.new("RGB", (600, 837), COLOR_BG_PANEL)

    art_max_w = width - 120
    art_max_h = int(height * 0.48)
    card_img.thumbnail((art_max_w, art_max_h), Image.LANCZOS)

    border_thickness = 6
    bordered = Image.new(
        "RGB",
        (card_img.width + border_thickness * 2, card_img.height + border_thickness * 2),
        style["border"],
    )
    bordered.paste(card_img, (border_thickness, border_thickness))

    # Pre-compute every text block's height so the whole composition
    # (art + title + price + rarity line) can be centered vertically as
    # one unit, rather than anchored to the top with leftover space below.
    title_font = _load_font(FONT_BOLD, 48)
    title_lines = _wrap_text(draw, title, title_font, width - 100)
    title_line_height = 58
    title_block_height = len(title_lines) * title_line_height

    price = card.get("price")
    price_str = f"${price:.2f}" if price else "Price unavailable"
    price_font = _load_font(FONT_BOLD, 90)
    price_block_height = 110

    rarity_font = _load_font(FONT_BODY_BOLD, 34)
    rarity_line = f"{rarity} — {card.get('name', '')}"
    rarity_lines = _wrap_text(draw, rarity_line, rarity_font, width - 100)
    rarity_line_height = 44
    rarity_block_height = len(rarity_lines) * rarity_line_height

    gap = 40
    total_height = (bordered.height + gap + title_block_height + gap
                     + price_block_height + rarity_block_height)
    start_y = max(30, (height - total_height) // 2)

    art_x = (width - bordered.width) // 2
    art_y = start_y
    pin.paste(bordered, (art_x, art_y))

    text_y = art_y + bordered.height + gap
    for line in title_lines:
        line_width = draw.textlength(line, font=title_font)
        draw.text(((width - line_width) // 2, text_y), line, fill=COLOR_TEXT, font=title_font)
        text_y += title_line_height

    text_y += gap - 20
    price_width = draw.textlength(price_str, font=price_font)
    draw.text(((width - price_width) // 2, text_y), price_str, fill=COLOR_AMBER, font=price_font)
    text_y += price_block_height

    for line in rarity_lines:
        line_width = draw.textlength(line, font=rarity_font)
        draw.text(((width - line_width) // 2, text_y), line, fill=COLOR_TEXT_MUTED, font=rarity_font)
        text_y += rarity_line_height

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    pin.save(output_path)
    return output_path



def generate_roundup_pin(cards_with_images: list, title: str, output_path: str) -> str:
    """
    "Roundup" style: one featured (#1) card larger at top, remaining 4
    in a 2x2 grid below -- for broader-intent searches like "pitch black
    chase cards" where a single-card pin only partially answers what
    someone's actually looking for. Destination should be the full
    chase-cards list page, not any single card's page.

    Args:
        cards_with_images: list of exactly 5 (card_dict, image_path) tuples,
            in rank order -- cards_with_images[0] is the featured card.
        title: overall roundup title, e.g. "Pitch Black: Top 5 Chase Cards"
        output_path: where to save the pin

    Returns:
        output_path
    """
    if len(cards_with_images) != 5:
        raise ValueError(f"generate_roundup_pin expects exactly 5 cards, got {len(cards_with_images)}")

    width, height = PIN_SIZE
    pin = Image.new("RGB", (width, height), COLOR_BG)
    draw = ImageDraw.Draw(pin)

    # Fixed height budget, verified by rendering (an earlier version
    # overflowed the canvas -- rows got cut off -- because these numbers
    # were guessed rather than computed against the actual 1500px limit).
    title_font = _load_font(FONT_BOLD, 44)
    title_lines = _wrap_text(draw, title, title_font, width - 100)[:2]  # cap at 2 lines
    y = 45
    for line in title_lines:
        line_width = draw.textlength(line, font=title_font)
        draw.text(((width - line_width) // 2, y), line, fill=COLOR_TEXT, font=title_font)
        y += 54
    y += 15

    featured_card, featured_image_path = cards_with_images[0]
    try:
        featured_img = Image.open(featured_image_path).convert("RGB")
    except (FileNotFoundError, OSError):
        featured_img = Image.new("RGB", (600, 837), COLOR_BG_PANEL)

    featured_img.thumbnail((360, 380), Image.LANCZOS)
    style = RARITY_STYLES.get(featured_card.get("rarity_label", ""), DEFAULT_RARITY_STYLE)
    border = 5
    bordered_featured = Image.new(
        "RGB",
        (featured_img.width + border * 2, featured_img.height + border * 2),
        style["border"],
    )
    bordered_featured.paste(featured_img, (border, border))
    featured_x = (width - bordered_featured.width) // 2
    pin.paste(bordered_featured, (featured_x, y))
    y += bordered_featured.height + 12

    rank_font = _load_font(FONT_BOLD, 34)
    rank_text = _truncate_to_width(draw, f"#1  {featured_card.get('name', '')}", rank_font, width - 80)
    rank_width = draw.textlength(rank_text, font=rank_font)
    draw.text(((width - rank_width) // 2, y), rank_text, fill=COLOR_AMBER, font=rank_font)
    y += 46

    # Grid: fixed single-line labels (no wrapping) so each cell's total
    # height is predictable -- the earlier 2-line-wrap version caused
    # unpredictable heights that overlapped into the row below.
    grid_top = y + 15
    cell_w, cell_h = 210, 220
    gap_x, gap_y = 35, 20
    row_content_h = cell_h + 8 + 30 + 32  # image + border*2(4 each side) + label line + price line
    grid_total_w = cell_w * 2 + gap_x
    grid_x0 = (width - grid_total_w) // 2

    body_font = _load_font(FONT_BODY_BOLD, 22)
    price_font = _load_font(FONT_BODY_BOLD, 26)

    for i, (card, image_path) in enumerate(cards_with_images[1:5], start=2):
        row, col = (i - 2) // 2, (i - 2) % 2
        cell_x = grid_x0 + col * (cell_w + gap_x)
        cell_y = grid_top + row * (row_content_h + gap_y)

        try:
            card_img = Image.open(image_path).convert("RGB")
        except (FileNotFoundError, OSError):
            card_img = Image.new("RGB", (600, 837), COLOR_BG_PANEL)
        card_img.thumbnail((cell_w - 8, cell_h), Image.LANCZOS)

        cell_style = RARITY_STYLES.get(card.get("rarity_label", ""), DEFAULT_RARITY_STYLE)
        cell_border = 4
        bordered_cell = Image.new(
            "RGB",
            (card_img.width + cell_border * 2, card_img.height + cell_border * 2),
            cell_style["border"],
        )
        bordered_cell.paste(card_img, (cell_border, cell_border))
        img_x = cell_x + (cell_w - bordered_cell.width) // 2
        pin.paste(bordered_cell, (img_x, cell_y))

        label = _truncate_to_width(draw, f"#{i} {card.get('name', '')}", body_font, cell_w)
        label_y = cell_y + bordered_cell.height + 6
        label_width = draw.textlength(label, font=body_font)
        draw.text((cell_x + (cell_w - label_width) // 2, label_y), label, fill=COLOR_TEXT, font=body_font)

        price = card.get("price")
        price_str = f"${price:.2f}" if price else ""
        if price_str:
            price_y = label_y + 30
            price_width = draw.textlength(price_str, font=price_font)
            draw.text((cell_x + (cell_w - price_width) // 2, price_y), price_str, fill=COLOR_AMBER, font=price_font)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    pin.save(output_path)
    return output_path

if __name__ == "__main__":
    # Quick manual test with a dummy card and no real image (exercises
    # the placeholder fallback path)
    test_card = {
        "name": "Mega Darkrai ex",
        "rarity_label": "Special Illustration Rare",
        "display_id": "116",
        "price": 264.59,
    }
    generate_reveal_pin(
        "/tmp/nonexistent.png",
        "Pitch Black's Biggest Chase Cards Revealed",
        "/tmp/test_reveal_pin.png",
    )
    print("Reveal pin saved to /tmp/test_reveal_pin.png")

    generate_price_guide_pin(
        test_card,
        "/tmp/nonexistent.png",
        "Pitch Black Price Guide: What's It Worth?",
        "/tmp/test_price_pin.png",
    )
    print("Price-guide pin saved to /tmp/test_price_pin.png")
