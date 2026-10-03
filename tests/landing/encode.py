#!/usr/bin/env python3
"""Turn the raw captures from capture.mjs into the images docs/ serves.

    python3 tests/landing/encode.py [--raw /tmp/versorium-landing/raw]

Every file is lossless WebP. For flat interface colours and type it is both
smaller and sharper than lossy WebP at any quality worth using (measured on the
editor shot: 120 kB lossless against 174 kB at q80), and text never picks up
ringing. Each image is written at the capture's own 2x, and the full-window
shots also at exactly half, so a 1x screen downloads a quarter of the pixels.
A clean 2:1 reduction matters: resampling to any other width adds edge noise
that lossless coding has to pay for (2000 px wide came out at 274 kB).

Output: docs/assets/shots/<lang>/<shot>-<theme>-<mode>.webp (+ @1x).
Pass --shot NAME (repeatable) to re-encode only some shots.

The phone crops (<shot>-detail-*) are cut from these files, not from the raw
captures: run tests/landing/crops.py after this, or phones keep the old ones.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "shots"

THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]
# shot -> whether a 1x copy is worth having (only the large full-window ones).
SHOTS = {
    "editor": True,
    "settings": True,
    "settings-pinned": True,
    "corkboard": True,
    "rewrite": False,
    "history": False,
}


def save(image: Image.Image, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", lossless=True, quality=100, method=6)
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default="/tmp/versorium-landing/raw")
    parser.add_argument("--shot", action="append", help="only these shots (repeatable)")
    args = parser.parse_args()
    raw = Path(args.raw)
    wanted = {k: v for k, v in SHOTS.items() if not args.shot or k in args.shot}

    total = 0
    sizes: dict[str, tuple[int, int]] = {}
    for lang in ("es", "en"):
        for shot, half in wanted.items():
            for variant in THEMES:
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
                # Even dimensions, so the 1x copy is an exact half. Only where
                # there is one: trimming the dialog crop would shave its border
                # on one side.
                if half:
                    w, h = image.size
                    image = image.crop((0, 0, w - w % 2, h - h % 2))
                name = f"{shot}-{variant}"
                total += save(image, OUT / lang / f"{name}.webp")
                if half:
                    small = image.resize((image.width // 2, image.height // 2), Image.Resampling.BOX)
                    total += save(small, OUT / lang / f"{name}@1x.webp")
                sizes.setdefault(shot, (image.width // scale, image.height // scale))

    for shot, (w, h) in sizes.items():
        print(f"{shot:10s} {w}x{h} CSS px")
    print(f"wrote {total / 1024 / 1024:.2f} MB into {OUT.relative_to(ROOT)}")
    print("now run tests/landing/crops.py, so the phone crops match")
    return 0


if __name__ == "__main__":
    sys.exit(main())
