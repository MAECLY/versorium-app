#!/usr/bin/env python3
"""Preview candidate phone crops of the full-window captures, at the size a
phone shows them, so they can be judged before crops.py fixes the boxes.

    python3 tests/landing/crop-candidates.py [name ...]
Writes /tmp/versorium-landing/crop-candidates/<lang>-<variant>-<name>-<width>.png

Each candidate is drawn the way the page draws it: inside a 1px frame, 318 CSS
px wide (a 360 px phone) and 348 (a 390 px one), at 2x. A candidate with
`fade` gets the page's right-edge fade (site.css), so a crop whose lines run on
past its edge can be judged as the visitor will see it.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "assets" / "shots"
OUT = Path("/tmp/versorium-landing/crop-candidates")
OUT.mkdir(parents=True, exist_ok=True)

# name -> (shot, (x, y, w, h) in the app's CSS px, fade as a share of the width)
CANDIDATES = {
    # The crop the page served before: 19 px of prose, one or two letters a line.
    "editor-old": ("editor", (0, 0, 400, 800), 0),
    # The gutter and its line numbers, then the first three paragraphs.
    "editor-a": ("editor", (240, 48, 460, 500), 0.16),
    "editor-b": ("editor", (240, 48, 500, 500), 0.16),
    "editor-b-nofade": ("editor", (240, 48, 500, 500), 0),
    # Prose only, from just inside the page's margin.
    "editor-c": ("editor", (341, 48, 440, 500), 0.16),
    # Gutter, prose and the status bar's snapshot buttons.
    "editor-d": ("editor", (252, 48, 460, 752), 0.16),
}

VARIANTS = ("needle-light", "folio-dark")
WIDTHS = (318, 348)


def frame(crop: Image.Image, width: int, fade: float, page: tuple) -> Image.Image:
    """The crop at `width` CSS px (2x), faded on the right into the page colour,
    inside the 1px border the page draws."""
    w2 = width * 2
    h2 = round(crop.height * w2 / crop.width)
    shown = crop.resize((w2, h2), Image.Resampling.LANCZOS)
    if fade:
        start = round(w2 * (1 - fade))
        overlay = Image.new("RGB", shown.size, page)
        mask = Image.new("L", shown.size, 0)
        draw = ImageDraw.Draw(mask)
        for x in range(start, w2):
            draw.line([(x, 0), (x, h2)], fill=round(255 * (x - start) / (w2 - start)))
        shown = Image.composite(overlay, shown, mask)
    out = Image.new("RGB", (w2 + 4, h2 + 4), (150, 160, 158))
    out.paste(shown, (2, 2))
    return out


def main() -> int:
    wanted = sys.argv[1:] or list(CANDIDATES)
    for lang in ("es", "en"):
        for variant in VARIANTS:
            for name in wanted:
                shot, (x, y, w, h), fade = CANDIDATES[name]
                image = Image.open(SHOTS / lang / f"{shot}-{variant}.webp").convert("RGB")
                crop = image.crop((x * 2, y * 2, (x + w) * 2, (y + h) * 2))
                # The page colour: a blank spot just under the top bar, right of
                # the gutter, in the capture itself.
                page = image.getpixel((300 * 2, 60 * 2))
                for width in WIDTHS:
                    framed = frame(crop, width, fade, page)
                    framed.save(OUT / f"{lang}-{variant}-{name}-{width}.png")
                print(f"{lang} {variant} {name}: {w}x{h} css px, drawn at {WIDTHS[0] / w:.2f}x to {WIDTHS[1] / w:.2f}x")
    return 0


if __name__ == "__main__":
    sys.exit(main())
