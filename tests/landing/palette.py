"""One palette for interface pictures, kept honest about its flat colours.

Screenshots of the app are a handful of flat colours (backgrounds, the
current-paragraph band, the selection, text, borders) plus the antialiased
edges of type. palette_for() keeps every colour that covers more than 0.2% of
the pixels exactly and spends the rest of the palette on the antialiasing in
between; reduce() maps a picture onto it without dithering, so a flat area is
one colour everywhere. At 256 colours the result is indistinguishable from the
capture, and down to 64 it still is at 1:1 (checked in light and dark themes).
Used by encode-clips.py for the clips, and by it and crops.py for a still that
would otherwise be over its budget.
"""

from collections import Counter

from PIL import Image

FLAT_SHARE = 0.002
LADDER = (256, 128, 64)


def palette_for(images: list[Image.Image], size: int) -> Image.Image:
    counts: Counter = Counter()
    for im in images:
        counts.update({c: n for n, c in im.getcolors(maxcolors=1 << 24)})
    total = sum(counts.values())
    flat = [c for c, n in counts.most_common() if n / total > FLAT_SHARE][:size]
    colours = list(flat)
    room = size - len(flat)
    if room > 0:
        exact = set(flat)
        # The remaining colours, each repeated by how often it occurs (capped,
        # so one huge antialiasing step cannot take the whole palette).
        pixels = []
        for c, n in counts.items():
            if c not in exact:
                pixels.extend([c] * max(1, min(n, 5000) // 50))
        if pixels:
            side = int(len(pixels) ** 0.5) + 1
            strip = Image.new("RGB", (side, side))
            strip.putdata(pixels + [pixels[-1]] * (side * side - len(pixels)))
            cut = strip.quantize(colors=room, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            values = cut.getpalette()[: room * 3]
            colours += [tuple(values[i : i + 3]) for i in range(0, len(values), 3)]
    flat_values = [v for c in colours for v in c]
    palette = Image.new("P", (1, 1))
    palette.putpalette(flat_values + [0] * (768 - len(flat_values)))
    return palette


def reduce(im: Image.Image, palette: Image.Image) -> Image.Image:
    return im.quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")


def save_webp(image: Image.Image, path, budget: int | None = None, full_colour: bool = False) -> tuple[int, str]:
    """Save a still as lossless WebP: on the 256-colour palette (or at full
    colour), then down the ladder while it is over `budget` bytes.

    Returns (bytes written, the colours used: "full", 256, 128 or 64)."""
    steps = [None] if full_colour else []
    steps += list(LADDER)
    used = None
    for colours in steps:
        im = image if colours is None else reduce(image, palette_for([image], colours))
        im.save(path, "WEBP", lossless=True, quality=100, method=6)
        size = path.stat().st_size
        used = "full" if colours is None else colours
        if budget is None or size <= budget:
            break
    return size, used
