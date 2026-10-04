#!/usr/bin/env python3
"""Cut the phone details out of the full-window captures docs/ already serves.

    python3 tests/landing/crops.py [--raw /tmp/versorium-landing/raw] [--shot NAME ...]

A full window is 1280 CSS px wide. On a phone the page has about 320 px for it,
so the app's 13 px type arrives at 3 px: a picture of a window, not of anything
in it. Below 720 px the page shows these crops instead, each the part of the
window that makes its caption's point, drawn small enough to fit and large
enough to read (the frame stops at 1.25x; site.css):

    corkboard  the open chapter's card and the one below it, 12 px of board
               around them (record.mjs measures the card: its left - 12, its
               top - 12, its width + 24, down to the card below + 12)
    focus      Focus mode's page: from 16 px left of the first paragraph and
               24 px above it, 420 x 480, so the first three paragraphs of the
               open chapter read in the app's own 21 px serif and the box ends
               in the blank line before the fourth. The page's column is wider
               than any readable crop, so lines run on past the right edge;
               site.css fades the last sixth into the page colour.

The boxes come from record.mjs, which measures them in the DOM and writes them
into each raw capture's JSON ("detail"); this script takes that box when the
raw captures are there, and the table below otherwise. Every variant of a
language must agree on the box (the page has one size per language).

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
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
from palette import save_webp

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "assets" / "shots"

THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]
# shot -> lang -> (x, y, width, height) in CSS px of the 1280-wide capture,
# as record.mjs measured them on 2026-10-03 (used when the raw JSON is not
# there). The English cards are taller: their previews run a line longer.
CROPS = {
    "corkboard": {"es": (504, 89, 260, 460), "en": (504, 89, 260, 478)},
    "focus": {"es": (353, 72, 420, 480), "en": (353, 72, 420, 480)},
}
SCALE = 2
# shot -> (2x budget, 1x budget) in bytes (site spec §9.3). Crops go onto the
# exact-flat-colour palette (palette.py) at 256 colours, like encode.py's
# stills, and down to 128 and 64 while one is over its budget.
BUDGET = {
    "corkboard": (27 * 1024, 15 * 1024),
    "focus": (35 * 1024, 20 * 1024),
}


def save(image: Image.Image, path: Path, budget: int | None = None) -> int:
    size, colours = save_webp(image, path, budget)
    if budget is not None and size > budget:
        print(f"{path.name}: over budget at {colours} colours ({size // 1024} kB)", file=sys.stderr)
    elif colours != 256:
        print(f"{path.name}: {colours} colours, {size // 1024} kB")
    return size


def cut_one(lang: str, shot: str, variant: str, box_css: tuple[int, int, int, int]) -> int:
    x, y, w, h = box_css
    source = SHOTS / lang / f"{shot}-{variant}.webp"
    image = Image.open(source).convert("RGB")
    if image.size[0] != 1280 * SCALE:
        raise SystemExit(f"{source} is {image.size[0]} px wide, not {1280 * SCALE}")
    crop = image.crop((x * SCALE, y * SCALE, (x + w) * SCALE, (y + h) * SCALE))
    name = f"{shot}-detail-{variant}"
    total = save(crop, SHOTS / lang / f"{name}.webp", BUDGET[shot][0])
    half = crop.resize((w, h), Image.Resampling.BOX)
    total += save(half, SHOTS / lang / f"{name}@1x.webp", BUDGET[shot][1])
    return total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="/tmp/versorium-landing/raw")
    parser.add_argument("--shot", action="append", choices=sorted(CROPS), help="only these crops (repeatable)")
    args = parser.parse_args()
    wanted = {k: v for k, v in CROPS.items() if not args.shot or k in args.shot}

    def box_for(shot: str, lang: str) -> tuple[int, int, int, int]:
        boxes = set()
        for variant in THEMES:
            meta = Path(args.raw) / lang / f"{shot}-{variant}.json"
            if meta.exists():
                d = json.loads(meta.read_text()).get("detail")
                if d:
                    boxes.add((d["x"], d["y"], d["width"], d["height"]))
        if len(boxes) > 1:
            raise SystemExit(f"{shot} {lang}: the themes disagree on the detail box: {sorted(boxes)}")
        return boxes.pop() if boxes else wanted[shot][lang]

    used = {(shot, lang): box_for(shot, lang) for lang in ("es", "en") for shot in wanted}
    jobs = [(lang, shot, variant, used[(shot, lang)]) for (shot, lang) in used for variant in THEMES]
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 2)) as pool:
        sizes = list(pool.map(cut_one, *zip(*jobs)))
    total = sum(sizes)
    for (shot, lang), (x, y, w, h) in used.items():
        print(f"{shot:10s} {lang} {w}x{h} CSS px from ({x}, {y})")
    print(f"wrote {total / 1024 / 1024:.2f} MB into {SHOTS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
