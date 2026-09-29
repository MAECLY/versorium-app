#!/usr/bin/env python3
"""Draw the Versorium app icon at every size each OS asks for.

Why a generator and not a folder of PNGs: an icon set is twenty-odd files that
have to agree with each other. Hand-exported, they drift — one gets re-cropped,
another keeps an old colour — and nobody can tell which is canonical. Here the
source of truth is this file, and `make icons` rebuilds all of them.

## Why the mark changed

It used to be a needle inside a ring. That is a compass, and a teal compass in a
rounded tile is Safari — near enough that people recognised the wrong app. The
previous pass fixed how it survived being shrunk and kept the thing that was
actually wrong with it.

The mark is now the letter the app is named for, written rather than set: a
steep Copperplate slant, the left limb a shade that swells under pressure, the
right limb a hairline pushed back up, and the nib that drew it resting at the
end of the stroke. It is drawn, not typed, because a broad-nib letter is not a
shape with an outline — it is a path with a pressure profile, and no installed
font can be relied on to exist on a Linux build machine.

## Per-size detail

An icon is not one drawing, it is a family, and the small members need fewer,
heavier parts:

  * 256px and up — the V, the nib, and the ink.
  * 64 to 128px — the V and the nib.
  * below 64px — the V alone, and heavier than proportion would give.

Detail that cannot resolve is not detail, it is mud that muddies everything next
to it.

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
    # The identity: a written V on paper. Warm and quiet.
    "paper": {
        "bg_top": PAPER,
        "bg_bottom": PAPER_WARM,
        # The shade carries the letter, so it is the strongest tone on the tile.
        "shade": TEAL_DEEP,
        "hair": TEAL,
        "nib": TEAL_DEEP,
        # The slit reads by cutting back to the page, not by being another ink.
        "slit": PAPER,
        "ink": TEAL,
    },
    # The same two colours, inverted. A pale tile disappears in a Dock full of
    # saturated ones; this is the same letter that can be seen across a screen.
    "ink": {
        "bg_top": TEAL,
        "bg_bottom": TEAL_DEEP,
        "shade": PAPER,
        "hair": TEAL_BRIGHT,
        "nib": PAPER,
        "slit": TEAL_DEEP,
        "ink": TEAL_BRIGHT,
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


def _tapered(draw, spine, widths, fill) -> None:
    """A stroke that swells and thins along its length.

    This is the entire reason the mark is drawn rather than set in a font. A
    broad-nib letter is not a shape with an outline, it is a path with a
    pressure profile — thick where the pen is pulled down, a hairline where it
    is pushed up. `spine` is the path, `widths` is the pressure.
    """
    left, right = [], []
    for i, (point, width) in enumerate(zip(spine, widths)):
        before = spine[max(0, i - 1)]
        after = spine[min(len(spine) - 1, i + 1)]
        dx, dy = after[0] - before[0], after[1] - before[1]
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        left.append((point[0] + nx * width / 2, point[1] + ny * width / 2))
        right.append((point[0] - nx * width / 2, point[1] - ny * width / 2))
    draw.polygon(left + right[::-1], fill=fill)


def _bezier(p0, p1, p2, steps: int = 48):
    """A quadratic curve, sampled. Copperplate has no straight lines."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return out


def _profile(n: int, stops) -> list[float]:
    """Interpolate a width profile given as (position, width) stops."""
    out = []
    for i in range(n):
        t = i / (n - 1)
        for (t0, w0), (t1, w1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                k = 0 if t1 == t0 else (t - t0) / (t1 - t0)
                out.append(w0 + (w1 - w0) * k)
                break
        else:
            out.append(stops[-1][1])
    return out


def draw_mark(canvas: Image.Image, palette: dict, box: float, detail: str, weight: float) -> None:
    """A V, written.

    The old mark was a ringed needle, which is a compass, which is Safari. This
    one is the letter the app is named for, drawn the way a pointed nib draws
    it: a steep Copperplate slant, the left limb a shade that swells under
    pressure, the right limb a hairline pushed back up, ending in a small curl.

    `detail` is what the tile can hold, not what would be nice:

      * `full`   — the V, the nib that wrote it, and the ink it was written in
      * `nib`    — the V and the nib
      * `letter` — the V alone, heavier

    That ladder is the same lesson as before: detail that cannot resolve is not
    detail, it is mud. A nib at 32px is four grey pixels. A V is still a V.
    """
    draw = ImageDraw.Draw(canvas)
    size = canvas.size[0]
    cx = cy = size / 2
    r = box / 2

    def at(x: float, y: float) -> tuple[float, float]:
        """Unit coordinates to canvas pixels. y grows downward, as it draws."""
        return (cx + x * r, cy + y * r)

    # The three anchors of the letter. They lean right: Copperplate is written
    # at roughly 55 degrees off the baseline, and a V standing up straight is a
    # different letter in a different hand.
    top_left = (-0.62, -0.74)
    vertex = (0.02, 0.76)
    top_right = (0.78, -0.80)

    # The shade. Pulled downward, so it is thin entering, heaviest a little past
    # the middle, and narrows into the join.
    shade = _bezier(at(*top_left), at(-0.34, -0.02), at(*vertex))
    widths = _profile(
        len(shade),
        # Thin entering, heaviest past the middle where the pull is strongest,
        # narrowing into the join. A swell centred at the midpoint reads as a
        # leaf; the whole character of the hand is that it is off-centre.
        [(0.0, 0.085 * r * weight), (0.58, 0.21 * r * weight), (1.0, 0.05 * r * weight)],
    )
    _tapered(draw, shade, widths, palette["shade"])

    # The hairline. Pushed upward, so it stays thin the whole way and finishes
    # lighter than it started.
    hair_full = _bezier(at(*vertex), at(0.46, 0.02), at(*top_right))
    # The stroke ends where the nib begins, so the two read as one object
    # rather than as a bead threaded onto a wire.
    hair = hair_full[: int(len(hair_full) * 0.72)] if detail != "letter" else hair_full
    widths = _profile(
        len(hair),
        [(0.0, 0.10 * r * weight), (0.5, 0.075 * r * weight), (1.0, 0.055 * r * weight)],
    )
    _tapered(draw, hair, widths, palette["hair"])

    if detail == "letter":
        return

    # The nib that wrote it, sitting at the end of the hairline as though the
    # pen has just been lifted. Two tines and the slit between them — the one
    # detail that makes a pointed shape read as a pen.
    # Seated on the stroke, not floating beside it. The tip is placed back
    # along the hairline so the nib and the letter are one object: a nib drawn
    # past the end of its own stroke reads as a kite that happens to be nearby.
    seat = hair[-1]
    # Pointing back down the stroke it just drew: a nib's tip is the end of the
    # line, and its body runs away from the paper.
    angle = math.atan2(hair_full[-1][1] - seat[1], hair_full[-1][0] - seat[0])
    nib_len = r * 0.40
    nib_wide = r * 0.11

    def along(forward: float, side: float) -> tuple[float, float]:
        return (
            seat[0] + math.cos(angle) * forward - math.sin(angle) * side,
            seat[1] + math.sin(angle) * forward + math.cos(angle) * side,
        )

    draw.polygon(
        [
            along(-nib_len * 0.22, 0),
            along(nib_len * 0.34, nib_wide),
            along(nib_len, nib_wide * 0.72),
            along(nib_len, -nib_wide * 0.72),
            along(nib_len * 0.34, -nib_wide),
        ],
        fill=palette["nib"],
    )
    slit = max(1.0, r * 0.028 * weight)
    draw.line([along(nib_len * 0.02, 0), along(nib_len * 0.62, 0)], fill=palette["slit"], width=round(slit))
    # The breather hole, which every nib has and which keeps the shape from
    # reading as a plain arrowhead.
    hole = max(1.0, r * 0.042)
    hx, hy = along(nib_len * 0.62, 0)
    draw.ellipse([hx - hole, hy - hole, hx + hole, hy + hole], fill=palette["slit"])

    if detail != "full":
        return

    # The ink. Not a bottle: a bottle is a container, and what this is about is
    # the ink itself — a pool gathered under the join where the pen rested, and
    # one drop about to leave it.
    pool_x, pool_y = at(0.02, 0.80)
    pool_w, pool_h = r * 0.30, r * 0.055
    draw.ellipse([pool_x - pool_w, pool_y - pool_h, pool_x + pool_w, pool_y + pool_h], fill=palette["ink"])


def render(size: int, variant: str, macos: bool) -> Image.Image:
    """One tile, fully drawn and reduced."""
    palette = VARIANTS[variant]
    big = size * SS

    # What the tile can hold. A nib at 32px is four grey pixels; a V is still a
    # V, so the small sizes get the letter alone and get it heavier.
    detail = "full" if size >= 256 else "nib" if size >= 64 else "letter"
    # Strokes get proportionally heavier as the tile gets smaller.
    weight = 1.0 if size >= 128 else 1.15 if size >= 64 else 1.35

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
        box = (big - inset * 2) * (0.62 if detail == "full" else 0.70 if detail == "nib" else 0.78)
    else:
        # Windows and Linux draw edge to edge, with a corner radius soft enough
        # not to look like a mistake on a square grid.
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=round(big * 0.18), fill=255
        )
        tile.paste(body, (0, 0), mask)
        box = big * (0.66 if detail == "full" else 0.74 if detail == "nib" else 0.82)

    draw_mark(tile, palette, box, detail, weight)
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
