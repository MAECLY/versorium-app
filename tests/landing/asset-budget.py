#!/usr/bin/env python3
"""The landing's asset files against their budgets (site spec §9.3), and what
one visitor downloads below the fold.

    python3 tests/landing/asset-budget.py [--strict]

Per class of file: how many there are, their pixel size, the smallest and the
largest, and every file over its budget. Then the bytes a visitor loads when
scrolling the whole page, for a 2x desktop, a 1x desktop and a 3x phone, with
motion allowed (the clips) and reduced (stills only). Then the change against
git HEAD in docs/assets. --strict exits 1 if anything is over budget.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
# DOCS_DIR weighs another copy of docs/ (verify-selftest.mjs).
DOCS = Path(os.environ.get("DOCS_DIR", ROOT / "docs"))
SHOTS = DOCS / "assets" / "shots"
KB = 1024
THEMES = [f"{t}-{m}" for t in ("folio", "quarry", "needle") for m in ("light", "dark")]

# (glob, budget in kB) per class of file; globs are inside shots/<lang>/.
CLASSES = [
    # Raised 2026-10-04 to what the clip measures at the lowest quality that
    # keeps the type sharp (three frames repaint most of the window); the
    # per-visitor total below still holds.
    ("restore-{v}.anim.webp", 110),
    ("restore-detail-{v}.anim.webp", 75),
    ("restore-{v}.webp", 46),
    ("restore-detail-{v}.webp", 30),
    ("rewrite-{v}.anim.webp", 90),
    ("rewrite-{v}.webp", 60),
    ("focus-{v}.webp", 120),
    ("focus-{v}@1x.webp", 65),
    ("focus-detail-{v}.webp", 35),
    ("focus-detail-{v}@1x.webp", 20),
    ("corkboard-{v}.webp", 115),
    ("corkboard-{v}@1x.webp", 62),
    ("corkboard-detail-{v}.webp", 27),
    ("corkboard-detail-{v}@1x.webp", 15),
    ("history-{v}.webp", 26),
]
SINGLE = [
    (DOCS / "assets/fonts/aguja-display-400.woff2", 14),
    (DOCS / "assets/paper.svg", 0.6),
    (DOCS / "assets/og.png", 120),
    (DOCS / "assets/og-en.png", 120),
]


def size(path: Path) -> int:
    return path.stat().st_size


def worst(pattern: str) -> int:
    """The largest file of a class, over both languages and all themes."""
    return max(size(SHOTS / lang / pattern.format(v=v)) for lang in ("es", "en") for v in THEMES)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    over = []
    print(f"{'class':32s} {'files':>5s} {'pixels':>11s} {'min':>8s} {'max':>8s} {'budget':>7s}")
    for pattern, budget in CLASSES:
        files = [SHOTS / lang / pattern.format(v=v) for lang in ("es", "en") for v in THEMES]
        missing = [f for f in files if not f.exists()]
        if missing:
            print(f"{pattern:32s} MISSING {len(missing)}: {missing[0].relative_to(DOCS)} ...")
            over.append(pattern)
            continue
        sizes = [size(f) for f in files]
        dims = sorted({Image.open(f).size for f in files})
        bad = [f for f, s in zip(files, sizes) if s > budget * KB]
        over += [f"{f.relative_to(SHOTS)} {size(f) / KB:.1f} kB > {budget} kB" for f in bad]
        dim = " / ".join(f"{w}x{h}" for w, h in dims)
        flag = f"  OVER x{len(bad)}" if bad else ""
        print(f"{pattern:32s} {len(files):5d} {dim:>11s} {min(sizes) / KB:7.1f}K {max(sizes) / KB:7.1f}K {budget:6g}K{flag}")
    for path, budget in SINGLE:
        s = size(path)
        flag = "  OVER" if s > budget * KB else ""
        if flag:
            over.append(f"{path.relative_to(DOCS)} {s / KB:.1f} kB > {budget} kB")
        print(f"{str(path.relative_to(DOCS)):32s} {'1':>5s} {'':>11s} {s / KB:7.1f}K {'':>8s} {budget:6g}K{flag}")

    # One visitor, whole page scrolled, worst theme. Desktop 2x loads the 2x
    # full windows; 1x loads @1x; phones load the 2x details. The restore,
    # rewrite and history pictures have one (2x) candidate each.
    still = ["history-{v}.webp", "rewrite-{v}.webp"]
    desk2 = still + ["restore-{v}.webp", "corkboard-{v}.webp", "focus-{v}.webp"]
    desk1 = still + ["restore-{v}.webp", "corkboard-{v}@1x.webp", "focus-{v}@1x.webp"]
    phone = still + ["restore-detail-{v}.webp", "corkboard-detail-{v}.webp", "focus-detail-{v}.webp"]
    clips_desk = ["restore-{v}.anim.webp", "rewrite-{v}.anim.webp"]
    clips_phone = ["restore-detail-{v}.anim.webp", "rewrite-{v}.anim.webp"]
    print("\nper visitor below the fold (worst theme), site spec target 500 kB:")
    for name, stills, clips in [("desktop 2x", desk2, clips_desk), ("desktop 1x", desk1, clips_desk), ("phone 3x", phone, clips_phone)]:
        a = sum(worst(p) for p in stills)
        b = sum(worst(p) for p in clips)
        print(f"  {name:11s} stills {a / KB:6.1f} kB, with the two clips {(a + b) / KB:6.1f} kB")

    # Against git HEAD.
    def tracked_sizes(rev: str) -> dict[str, int]:
        out = subprocess.run(["git", "ls-tree", "-r", "-l", rev, "docs/assets"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return {line.split("\t")[1]: int(line.split()[3]) for line in out.splitlines()}
    head = tracked_sizes("HEAD")
    now = {"docs/" + str(p.relative_to(DOCS)): size(p) for p in (DOCS / "assets").rglob("*") if p.is_file()}
    added = {k: v for k, v in now.items() if k not in head}
    removed = {k: v for k, v in head.items() if k not in now}
    changed = {k: (head[k], now[k]) for k in now if k in head and head[k] != now[k]}
    print(f"\ndocs/assets against HEAD: {len(added)} files added ({sum(added.values()) / KB / KB:.2f} MB), "
          f"{len(removed)} removed ({sum(removed.values()) / KB / KB:.2f} MB), "
          f"{len(changed)} rewritten ({sum(b - a for a, b in changed.values()) / KB / KB:+.2f} MB); "
          f"net {(sum(now.values()) - sum(head.values())) / KB / KB:+.2f} MB")
    if over:
        print("\nover budget:")
        for line in over:
            print("  " + line)
    return 1 if over and args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
