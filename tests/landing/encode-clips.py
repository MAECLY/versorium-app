#!/usr/bin/env python3
"""Turn record.mjs's frames into the clips and stills docs/ serves.

    python3 tests/landing/encode-clips.py [--rec /tmp/versorium-landing/rec]
                                          [--clip restore] [--lang es] [--theme needle-light]

For each clip and theme variant this writes, in docs/assets/shots/<lang>/:

    restore-<theme>-<mode>.webp            still, the clip's last frame
    restore-<theme>-<mode>.anim.webp       the clip, played once
    restore-detail-<theme>-<mode>.webp     phones: the same, cut to the left part
    restore-detail-<theme>-<mode>.anim.webp
    rewrite-<theme>-<mode>.webp            still, the preview before the pointer moves
    rewrite-<theme>-<mode>.anim.webp

Everything is at the capture's 2x, cut with the boxes record.mjs measured
(meta.json), so no frame is resampled.

How the clips are compressed, and why not as the site spec first wrote it
(img2webp -mixed -q 80). Lossy WebP is poor at small type: measured on the
restore clip at 2x, -q 80 came out at 248 kB and still rang around every
letter, and -q 50 at 182 kB was blurred. These frames are a handful of flat
interface colours plus the antialiased edges of type, so each clip is reduced
to one shared palette, built so every colour that covers more than 0.2% of the
pixels (backgrounds, the current-paragraph band, the selection, text, borders)
stays exact and the rest of the palette goes to the antialiasing in between,
and then stored lossless. At 256 colours that is indistinguishable from the
capture; down to 64 it still is at 1:1 (checked in light and dark). Frames are
not dithered, so a flat area is one colour in every frame and costs nothing
when nothing changes.

Budget ladder (deterministic, as the spec asks): 256 colours; if a file is over
its budget, 128, then 64 (the floor); if it is still over, the clip at 10 fps
(every sixth frame dropped, each shown 100 ms) is kept only if that brings it
under. The last frame is held 1200 ms (img2webp -d 1200); -loop 1 plays once.

Stills are lossless WebP on a 256-colour palette of their own, like
encode.py's, and down the same ladder while one is over its budget.

The Rewrite clip starts at its still frame, the preview: before it, the dialog
is still small (no preview yet) inside the box measured for the final one,
over the grey backdrop, so the page's swap from the still to the clip would
jump from one composition to another. From the still on it shows what the
step promises, the diff and then Aplicar pressed. (START below.)

The Rewrite dialog has rounded corners, and in its four corner wedges the box
shows the backdrop, which the compositor redraws a level lighter or darker
from one frame to the next. The page clips those wedges with the dialog's own
radius (recorded in meta.json), so nobody sees them; they are held to the
still frame's pixels in every frame, which lets identical frames merge and the
clip keep the same length in every theme.

Run tests/landing/record.mjs first. The sizes and pixel dimensions of what was
written go to tests/landing/out/clips.json, and anything over budget is
listed at the end (and fails the run with --strict).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
from palette import LADDER as PALETTES, palette_for, reduce, save_webp

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "shots"
REPORT = ROOT / "tests" / "landing" / "out" / "clips.json"

THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]
# clip -> {output name: box key in meta.json}
CLIPS = {
    "restore": {"restore": "crop", "restore-detail": "detail"},
    "rewrite": {"rewrite": "crop"},
}
# output name -> (animation budget, still budget), in bytes (site spec §9.3).
BUDGET = {
    "restore": (70 * 1024, 40 * 1024),
    "restore-detail": (45 * 1024, 25 * 1024),
    "rewrite": (90 * 1024, 60 * 1024),
}
LAST_HOLD_MS = 1200
# clip -> the meta.json key naming the frame its animation starts at.
START = {"rewrite": "stillFrame"}


def device_box(box: dict, scale: int) -> tuple[int, int, int, int]:
    x, y = round(box["x"] * scale), round(box["y"] * scale)
    return x, y, x + round(box["width"] * scale), y + round(box["height"] * scale)


def merge(frames: list[Image.Image], holds: list[int]) -> tuple[list[Image.Image], list[int]]:
    """Consecutive identical frames become one, held for their total time."""
    out, times = [], []
    for im, ms in zip(frames, holds):
        if out and im.tobytes() == out[-1].tobytes():
            times[-1] += ms
        else:
            out.append(im)
            times.append(ms)
    return out, times


def encode_anim(frames: list[Image.Image], holds: list[int], path: Path) -> int:
    frames, holds = merge(frames, holds)
    holds = holds[:-1] + [LAST_HOLD_MS]
    with tempfile.TemporaryDirectory() as tmp:
        cmd = ["img2webp", "-loop", "1", "-lossless", "-q", "100", "-m", "6"]
        for i, (im, ms) in enumerate(zip(frames, holds)):
            f = Path(tmp) / f"f{i:04d}.png"
            im.save(f)
            cmd += ["-d", str(ms), str(f)]
        partial = path.with_suffix(".tmp.webp")
        subprocess.run(cmd + ["-o", str(partial)], check=True, capture_output=True)
        partial.replace(path)
    return path.stat().st_size


def ten_fps(frames: list[Image.Image], holds: list[int]) -> tuple[list[Image.Image], list[int]]:
    kept = [(im, 100) for i, (im, _) in enumerate(zip(frames, holds)) if i % 6 != 5]
    return [k[0] for k in kept], [k[1] for k in kept]


def steady_corners(frames: list[Image.Image], reference: Image.Image, radius_px: int) -> list[Image.Image]:
    """Hold the wedges outside a rounded rectangle to the reference frame's pixels."""
    w, h = reference.size
    inside = Image.new("L", (w, h), 0)
    ImageDraw.Draw(inside).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius_px, fill=255)
    out = []
    for im in frames:
        fixed = reference.copy()
        fixed.paste(im, (0, 0), inside)
        out.append(fixed)
    return out


def encode_one(meta: dict, frames_dir: Path, box_key: str, name: str, lang: str, variant: str) -> dict:
    scale = meta["scale"]
    box = device_box(meta[box_key], scale)
    files = sorted(frames_dir.glob("f*.png"))
    holds = meta["holds"]
    if len(files) != len(holds):
        raise SystemExit(f"{frames_dir}: {len(files)} frames but {len(holds)} holds")
    start = meta[START[meta["clip"]]] if meta["clip"] in START else 0
    raw = [Image.open(f).convert("RGB").crop(box) for f in files[start:]]
    holds = holds[start:]
    still_index = meta.get("stillFrame", len(files) - 1) - start
    radius = meta[box_key].get("radius")
    if radius:
        raw = steady_corners(raw, raw[still_index], round(radius * scale))
    anim_budget, still_budget = BUDGET[name]
    base = OUT / lang / f"{name}-{variant}"
    base.parent.mkdir(parents=True, exist_ok=True)
    anim_path = base.with_name(base.name + ".anim.webp")
    still_path = base.with_name(base.name + ".webp")

    record = {"width": raw[0].width, "height": raw[0].height, "frames": len(raw), "start": start}
    # The clip.
    chosen = None
    for colours in PALETTES:
        palette = palette_for(raw, colours)
        reduced = [reduce(im, palette) for im in raw]
        size = encode_anim(reduced, holds, anim_path)
        chosen = {"colours": colours, "fps": 12, "bytes": size}
        if size <= anim_budget:
            break
    if chosen["bytes"] > anim_budget:
        frames10, holds10 = ten_fps(reduced, holds)
        trial = anim_path.with_name(anim_path.name + ".10fps")
        size10 = encode_anim(frames10, holds10, trial)
        if size10 <= anim_budget:
            trial.replace(anim_path)
            chosen = {"colours": PALETTES[-1], "fps": 10, "bytes": size10}
        else:
            trial.unlink()
    record["anim"] = chosen
    record["anim"]["ms"] = sum(merge(raw, holds)[1][:-1]) + LAST_HOLD_MS
    record["anim"]["budget"] = anim_budget
    # The still.
    size, colours = save_webp(raw[still_index], still_path, still_budget)
    record["still"] = {"colours": colours, "bytes": size, "budget": still_budget, "frame": still_index}
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rec", default="/tmp/versorium-landing/rec")
    parser.add_argument("--clip", action="append", choices=sorted(CLIPS), help="only these clips (repeatable)")
    parser.add_argument("--lang", action="append", choices=["es", "en"], help="only these languages (repeatable)")
    parser.add_argument("--theme", action="append", choices=THEMES, help="only these variants (repeatable)")
    parser.add_argument("--strict", action="store_true", help="fail when a file is over its budget")
    args = parser.parse_args()
    if not shutil.which("img2webp"):
        print("img2webp not found (brew install webp)", file=sys.stderr)
        return 1

    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    over = []
    total = 0
    jobs = []
    for lang in args.lang or ["es", "en"]:
        for clip in args.clip or sorted(CLIPS):
            for variant in args.theme or THEMES:
                frames_dir = Path(args.rec) / lang / f"{clip}-{variant}"
                meta = json.loads((frames_dir / "meta.json").read_text())
                for name, box_key in CLIPS[clip].items():
                    if meta.get(box_key) is not None:
                        jobs.append((meta, frames_dir, box_key, name, lang, variant))
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 2)) as pool:
        futures = [(job, pool.submit(encode_one, *job)) for job in jobs]
        results = [(job, future.result()) for job, future in futures]
    for (meta, frames_dir, box_key, name, lang, variant), r in results:
        report.setdefault(lang, {}).setdefault(name, {})[variant] = r
        total += r["anim"]["bytes"] + r["still"]["bytes"]
        a, s = r["anim"], r["still"]
        flag = ""
        if a["bytes"] > a["budget"]:
            over.append(f"{lang}/{name}-{variant}.anim.webp {a['bytes'] // 1024} kB > {a['budget'] // 1024} kB")
            flag += " anim OVER"
        if s["bytes"] > s["budget"]:
            over.append(f"{lang}/{name}-{variant}.webp {s['bytes'] // 1024} kB > {s['budget'] // 1024} kB")
            flag += " still OVER"
        print(
            f"{lang} {name}-{variant}: {r['width']}x{r['height']} px, "
            f"anim {a['bytes'] // 1024} kB ({a['colours']} colours, {a['fps']} fps, {a['ms']} ms), "
            f"still {s['bytes'] // 1024} kB ({s['colours']}){flag}"
        )
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")
    print(f"wrote {total / 1024 / 1024:.2f} MB into {OUT.relative_to(ROOT)}")
    if over:
        print("over budget (site spec §9.3):")
        for line in over:
            print("  " + line)
    return 1 if over and args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
