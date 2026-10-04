#!/usr/bin/env python3
"""Turn the raw captures from record.mjs into the still images docs/ serves.

    python3 tests/landing/encode.py [--raw /tmp/versorium-landing/raw]

Every file is lossless WebP. For flat interface colours and type it is both
smaller and sharper than lossy WebP at any quality worth using (measured on the
editor shot: 120 kB lossless against 174 kB at q80), and text never picks up
ringing. By default the pixels first go onto a 256-colour palette that keeps
every flat colour of the window exact and spends the rest on the antialiasing
of type (tests/landing/palette.py): indistinguishable at 1:1, 10-20% smaller,
which keeps a visitor's whole scroll under the site spec's 500 kB.
--full-colour skips that step. Each image is written at the capture's own 2x, and the full-window
shots also at exactly half, so a 1x screen downloads a quarter of the pixels.
A clean 2:1 reduction matters: resampling to any other width adds edge noise
that lossless coding has to pay for (2000 px wide came out at 274 kB).

Output: docs/assets/shots/<lang>/<shot>-<theme>-<mode>.webp (+ @1x).
Pass --shot NAME (repeatable) to re-encode only some shots.

The phone crops (<shot>-detail-*) are cut from these files, not from the raw
captures: run tests/landing/crops.py after this, or phones keep the old ones.
The two clips and their stills (restore, rewrite) come from encode-clips.py,
which works on record.mjs's frames; the editor and settings shots are no
longer on the page (the hero window is HTML) and are not encoded.
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
OUT = ROOT / "docs" / "assets" / "shots"

THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]
# shot -> whether a 1x copy is worth having (only the large full-window ones).
SHOTS = {
    "corkboard": True,
    "focus": True,
    "history": False,
}


def save(image: Image.Image, path: Path, full_colour: bool) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    return save_webp(image, path, full_colour=full_colour)[0]


def encode_one(raw: Path, lang: str, shot: str, half: bool, variant: str, full_colour: bool) -> tuple[int, tuple[int, int]]:
    src = raw / lang / f"{shot}-{variant}.png"
    meta = json.loads((raw / lang / f"{shot}-{variant}.json").read_text())
    image = Image.open(src).convert("RGB")
    scale = meta["scale"]
    crop = meta.get("crop")
    if crop:
        box = (
            crop["x"] * scale,
            crop["y"] * scale,
            (crop["x"] + crop["width"]) * scale,
            (crop["y"] + crop["height"]) * scale,
        )
        image = image.crop(box)
    # Even dimensions, so the 1x copy is an exact half. Only where there is
    # one: trimming the dialog crop would shave its border on one side.
    if half:
        w, h = image.size
        image = image.crop((0, 0, w - w % 2, h - h % 2))
    name = f"{shot}-{variant}"
    total = save(image, OUT / lang / f"{name}.webp", full_colour)
    if half:
        small = image.resize((image.width // 2, image.height // 2), Image.Resampling.BOX)
        total += save(small, OUT / lang / f"{name}@1x.webp", full_colour)
    return total, (image.width // scale, image.height // scale)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="/tmp/versorium-landing/raw")
    parser.add_argument("--shot", action="append", help="only these shots (repeatable)")
    parser.add_argument("--full-colour", action="store_true", help="no palette step: strictly lossless")
    args = parser.parse_args()
    raw = Path(args.raw)
    wanted = {k: v for k, v in SHOTS.items() if not args.shot or k in args.shot}

    jobs = [(raw, lang, shot, half, variant, args.full_colour)
            for lang in ("es", "en") for shot, half in wanted.items() for variant in THEMES]
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 2)) as pool:
        results = list(pool.map(encode_one, *zip(*jobs)))
    total = sum(r[0] for r in results)
    sizes: dict[tuple[str, str], tuple[int, int]] = {}
    for job, (_, size) in zip(jobs, results):
        sizes.setdefault((job[2], job[1]), size)

    for (shot, lang), (w, h) in sizes.items():
        print(f"{shot:10s} {lang} {w}x{h} CSS px")
    print(f"wrote {total / 1024 / 1024:.2f} MB into {OUT.relative_to(ROOT)}")
    print("now run tests/landing/crops.py, so the phone crops match")
    return 0


if __name__ == "__main__":
    sys.exit(main())
