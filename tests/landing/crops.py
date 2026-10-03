#!/usr/bin/env python3
"""Cut the phone details out of the full-window captures docs/ already serves.

    python3 tests/landing/crops.py [--shot NAME ...]

A full window is 1280 CSS px wide. On a phone the page has about 320 px for it,
so the app's 13 px type arrives at 3 px: a picture of a window, not of anything
in it. Below 720 px the page shows these crops instead, each the part of the
window that makes its caption's point, drawn small enough to fit and large
enough to read (the frame stops at 1.25x; site.css):

    editor     the editor itself: the gutter with its line numbers and the
               first three paragraphs of the open chapter, in the app's own
               21 px serif, so even at 0.6x on a 320 px phone the prose reads
               at 12 px. The page's column is 780 px wide and no readable crop
               holds a whole line, so the box starts at the gutter, never cuts
               a word on its left edge, and runs a good third of the way into
               each line; site.css fades the last sixth into the page colour,
               so the lines read as going on rather than as cut off. Nothing in
               the box is cut across: it begins below the top bar, ends at a
               blank line, and leaves out the binder and the status bar, whose
               words a narrower box would slice.
    corkboard  the open chapter's card and the one below it, with the edges of
               their neighbours so it still reads as a board
    settings   the three theme swatches and the mode buttons, in whichever
               theme and mode the visitor picked (settings-pinned is the same
               box over the shots taken with Light or Dark pressed)

The source is the lossless 2x WebP of each shot (encode.py), so a crop is the
capture's own pixels, not a re-render. Each is written at 2x and at exactly
half, like the full shots: <shot>-detail-<theme>-<mode>.webp and @1x.webp.
Run this again whenever encode.py rewrites the shots. The boxes are in the
app's CSS px and must stay even in 2x pixels, which whole numbers are.

When a box changes, so do the page's numbers for it: the <source>'s width,
height, data-widths, srcset and sizes in both index.html files, and the
matching max-width in site.css. tests/landing/crop-candidates.py previews a
box at phone size before it is fixed here.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "assets" / "shots"

THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]
# shot -> (x, y, width, height) in CSS px of the 1280-wide capture. Measured on
# both languages: the binder's border is at x 239, the gutter runs to its own
# border at 275 with the line numbers at 254 to 261, the prose starts at 381,
# and the first three paragraphs and their line numbers sit at the same rows
# in Spanish and English, ending with line 6 at y 529 to 539.
CROPS = {
    "editor": (240, 48, 460, 500),
    "corkboard": (476, 84, 320, 380),
    "settings": (226, 198, 444, 198),
    "settings-pinned": (226, 198, 444, 198),
}
SCALE = 2


def save(image: Image.Image, path: Path) -> int:
    image.save(path, "WEBP", lossless=True, quality=100, method=6)
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shot", action="append", choices=sorted(CROPS), help="only these crops (repeatable)")
    args = parser.parse_args()
    wanted = {k: v for k, v in CROPS.items() if not args.shot or k in args.shot}

    total = 0
    for lang in ("es", "en"):
        for shot, (x, y, w, h) in wanted.items():
            for variant in THEMES:
                source = SHOTS / lang / f"{shot}-{variant}.webp"
                image = Image.open(source).convert("RGB")
                if image.size[0] != 1280 * SCALE:
                    print(f"{source} is {image.size[0]} px wide, not {1280 * SCALE}", file=sys.stderr)
                    return 1
                box = (x * SCALE, y * SCALE, (x + w) * SCALE, (y + h) * SCALE)
                crop = image.crop(box)
                name = f"{shot}-detail-{variant}"
                total += save(crop, SHOTS / lang / f"{name}.webp")
                half = crop.resize((w, h), Image.Resampling.BOX)
                total += save(half, SHOTS / lang / f"{name}@1x.webp")
    for shot, (x, y, w, h) in wanted.items():
        print(f"{shot:16s} {w}x{h} CSS px from ({x}, {y})")
    print(f"wrote {total / 1024 / 1024:.2f} MB into {SHOTS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
