#!/usr/bin/env python3
"""Draw the Versorium app icon at every size each OS asks for.

Why a generator and not a folder of PNGs: an icon set is twenty-odd files that
have to agree with each other. Hand-exported, they drift — one gets re-cropped,
another keeps an old colour — and nobody can tell which is canonical. Here the
source of truth is this file, and `make icons` rebuilds all of them.

## What the old set got wrong, and what this fixes

The mark is a compass, and it is kept. But it was drawn once and scaled down,
which is why it dissolved: at 32px the ring was a grey hairline, the cardinal
ticks had vanished into sub-pixel smudges, and the needle was a sliver. An icon
is not one drawing — it is a family, and the small members need fewer, heavier
parts.

  * Stroke weights are a fraction of the tile, and the fraction *grows* as the
    tile shrinks, so the ring stays visible rather than staying proportional.
  * Cardinal ticks are dropped below 48px. Detail that cannot resolve is not
    detail, it is noise that muddies everything next to it.
  * The needle keeps its two tones, because that is what makes it read as a
    compass and not an abstract diamond, but both tones are pushed apart so the
    contrast survives a 4x downscale.

## Per-platform shape

macOS is the odd one: the system does not mask app icons, so the art must
supply Apple's rounded-rectangle itself, inset inside the canvas — a full-bleed
square looks oversized and wrong beside every other Dock icon. Windows and Linux
draw the tile edge to edge.

Run: python3 tests/icons/generate.py [--variant paper|ink] [--out DIR]
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

# Supersampling factor. PIL has no antialiased vector drawing, so everything is
# drawn large and reduced with LANCZOS, which is what gives clean curves.
SS = 8

REPO = Path(__file__).resolve().parents[2]
ICONS = REPO / "src-tauri" / "icons"

# Spec §5's palette. Needle Teal is the accent the whole app is built around.
TEAL = (42, 111, 106)
TEAL_DEEP = (26, 74, 70)
TEAL_BRIGHT = (126, 184, 178)
PAPER = (243, 236, 221)
PAPER_WARM = (231, 223, 208)
INK = (27, 36, 34)

# Degrees clockwise from north. Off-axis on purpose: a needle on an axis reads
# as a clock hand, and the original mark was tilted.
NEEDLE_TILT = 34

VARIANTS = {
    # The current identity: a teal compass on paper. Warm and quiet.
    "paper": {
        "bg_top": PAPER,
        "bg_bottom": PAPER_WARM,
        "ring": TEAL,
        "needle_dark": TEAL_DEEP,
        "needle_light": (255, 255, 255),
        "hub": PAPER,
        "tick": TEAL,
    },
    # The same two colours, inverted. A pale tile disappears in a Dock full of
    # saturated ones; this is the same compass that can be seen across a screen.
    "ink": {
        "bg_top": TEAL,
        "bg_bottom": TEAL_DEEP,
        "ring": PAPER,
        "needle_dark": (255, 255, 255),
        "needle_light": TEAL_BRIGHT,
        "hub": TEAL_DEEP,
        "tick": PAPER,
    },
}


def squircle_mask(size: int, radius_ratio: float, n: float = 5.0) -> Image.Image:
    """A superellipse mask — Apple's corner shape, not a rounded rectangle.

    `n` around 5 is the continuous curvature macOS uses; a plain rounded rect
    reads subtly wrong next to system icons.
    """
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    half = size / 2
    # The corner "radius" is expressed as how far the shape is inset from the
    # square; the exponent does the rest.
    a = half * radius_ratio
    points = []
    steps = max(256, size // 2)
    for i in range(steps + 1):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = half + a * math.copysign(abs(ct) ** (2 / n), ct)
        y = half + a * math.copysign(abs(st) ** (2 / n), st)
        points.append((x, y))
    draw.polygon(points, fill=255)
    return mask


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """A flat colour would be fine; a whisper of a gradient stops a large icon
    from looking like a rectangle of paint."""
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3)))
    return grad.resize((size, size), Image.Resampling.BICUBIC)


def draw_compass(canvas: Image.Image, palette: dict, box: float, ticks: bool, weight: float) -> None:
    """The mark itself, centred in `canvas`.

    `weight` scales every stroke. It is passed in rather than derived so a small
    tile can be drawn fatter than proportion would give — which is the whole
    trick to an icon that survives being shrunk.
    """
    draw = ImageDraw.Draw(canvas)
    size = canvas.size[0]
    cx = cy = size / 2
    r = box / 2

    ring_w = max(1.0, r * 0.11 * weight)
    draw.ellipse(
        [cx - r, cy - r, cx + r, cy + r],
        outline=palette["ring"],
        width=round(ring_w),
    )

    if ticks:
        # North, east, south, west. Only at sizes where they can resolve.
        tick_len = r * 0.16
        tick_w = max(1.0, ring_w * 0.85)
        for angle in (0, 90, 180, 270):
            rad = math.radians(angle - 90)
            x0 = cx + math.cos(rad) * (r - ring_w * 0.5)
            y0 = cy + math.sin(rad) * (r - ring_w * 0.5)
            x1 = cx + math.cos(rad) * (r - ring_w * 0.5 - tick_len)
            y1 = cy + math.sin(rad) * (r - ring_w * 0.5 - tick_len)
            draw.line([x0, y0, x1, y1], fill=palette["tick"], width=round(tick_w))

    # The needle: two long triangles meeting at the hub. North is the strong
    # tone, south the light one — the convention that makes it a compass.
    #
    # Tilted, as the original mark was. Vertical, it reads as a clock hand at
    # twelve or a power symbol; the tilt is what makes the silhouette say
    # compass before any detail resolves.
    reach = r * 0.78
    waist = r * 0.135
    tilt = math.radians(NEEDLE_TILT)

    def at(forward: float, side: float) -> tuple[float, float]:
        """A point `forward` along the needle and `side` across it."""
        return (
            cx + math.sin(tilt) * forward + math.cos(tilt) * side,
            cy - math.cos(tilt) * forward + math.sin(tilt) * side,
        )

    draw.polygon(
        [at(reach, 0), at(0, waist), at(-reach * 0.12, 0), at(0, -waist)],
        fill=palette["needle_dark"],
    )
    draw.polygon(
        [at(-reach, 0), at(0, -waist), at(reach * 0.12, 0), at(0, waist)],
        fill=palette["needle_light"],
    )

    # A hub, so the two halves read as one pivoting needle.
    hub = max(1.0, r * 0.085 * weight)
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=palette["hub"])


def render(size: int, variant: str, macos: bool) -> Image.Image:
    """One tile, fully drawn and reduced."""
    palette = VARIANTS[variant]
    big = size * SS

    # Below this, the ticks are smaller than a pixel after reduction, so they
    # only add mud.
    ticks = size >= 48
    # Strokes get proportionally heavier as the tile gets smaller.
    weight = 1.0 if size >= 128 else 1.25 if size >= 64 else 1.7

    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    body = vertical_gradient(big, palette["bg_top"], palette["bg_bottom"]).convert("RGBA")

    if macos:
        # Apple's grid: the rounded body occupies about 80% of the canvas, so the
        # icon sits with the same optical weight as every system icon beside it.
        inset = round(big * 0.10)
        shape = squircle_mask(big - inset * 2, 1.0)
        mask = Image.new("L", (big, big), 0)
        mask.paste(shape, (inset, inset))
        tile.paste(body, (0, 0), mask)
        box = (big - inset * 2) * (0.66 if ticks else 0.80)
    else:
        # Windows and Linux draw edge to edge, with a corner radius soft enough
        # not to look like a mistake on a square grid.
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=round(big * 0.18), fill=255
        )
        tile.paste(body, (0, 0), mask)
        box = big * (0.70 if ticks else 0.84)

    draw_compass(tile, palette, box, ticks, weight)
    return tile.resize((size, size), Image.Resampling.LANCZOS)


# What each platform actually asks for.
PNG_SIZES = [16, 32, 44, 48, 64, 71, 89, 107, 128, 142, 150, 256, 284, 310, 512, 1024]
ICNS_SIZES = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def build_icns(out: Path, variant: str) -> bool:
    """`iconutil` is macOS-only; without it the .icns is left as it was."""
    if not shutil.which("iconutil"):
        print("iconutil not found: skipping icon.icns", file=sys.stderr)
        return False
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for base, scale in ICNS_SIZES:
            name = f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"
            render(base * scale, variant, macos=True).save(iconset / name)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(out / "icon.icns")],
            check=True,
        )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=sorted(VARIANTS), default="ink")
    parser.add_argument("--out", type=Path, default=ICONS)
    parser.add_argument("--preview", action="store_true", help="write a contact sheet instead")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    if args.preview:
        # Every variant at the sizes that actually decide whether an icon works.
        checks = [16, 32, 64, 128]
        pad = 12
        width = sum(c + pad for c in checks) + pad
        height = (128 + pad) * len(VARIANTS) + pad
        sheet = Image.new("RGBA", (width, height), (128, 128, 128, 255))
        for row, variant in enumerate(sorted(VARIANTS)):
            x = pad
            y = pad + row * (128 + pad)
            for c in checks:
                sheet.alpha_composite(render(c, variant, macos=True), (x, y + (128 - c) // 2))
                x += c + pad
        target = args.out / "preview.png"
        sheet.save(target)
        print(f"wrote {target}")
        return 0

    for size in PNG_SIZES:
        render(size, args.variant, macos=False).save(args.out / f"{size}x{size}.png")
    # Tauri's own names.
    render(256, args.variant, macos=False).save(args.out / "128x128@2x.png")
    render(1024, args.variant, macos=False).save(args.out / "icon.png")
    # Windows Store tiles, which Tauri's bundler lists by name.
    for square in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        render(square, args.variant, macos=False).save(args.out / f"Square{square}x{square}Logo.png")
    render(50, args.variant, macos=False).save(args.out / "StoreLogo.png")

    # One .ico holding every size Windows picks between; it chooses per context
    # and a missing size gets scaled badly.
    render(256, args.variant, macos=False).save(
        args.out / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
    )
    build_icns(args.out, args.variant)
    print(f"wrote the {args.variant} icon set to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
