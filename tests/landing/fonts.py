#!/usr/bin/env python3
"""Build the site's one display font, Aguja Display, from Source Serif 4.

    npm pack @fontsource-variable/source-serif-4@5.3.0      # dev time only
    python3 tests/landing/fonts.py fontsource-variable-source-serif-4-5.3.0.tgz

Writes docs/assets/fonts/aguja-display-400.woff2 and docs/assets/fonts/OFL.txt.
The argument is the npm tarball (checked against the registry's sha512 below,
then read without unpacking) or the woff2 inside it,
package/files/source-serif-4-latin-opsz-normal.woff2. Nothing is fetched by
this script, and nothing third-party is fetched at page time.

What it does (site spec §3.2, §9.5):
  - instances the variable font at optical size 60 and weight 400, so the
    headings get Source Serif's display cut and the file has no fvar;
  - subsets it to Basic Latin plus the Spanish and typographic punctuation the
    pages use, keeping kerning and the figure features;
  - renames it. Source Serif 4 is under the SIL Open Font License 1.1 with the
    Reserved Font Name "Source" (name ID 0), and a Modified Version may not use
    a Reserved Font Name, so every family/full/PostScript name becomes "Aguja
    Display" and name ID 10 says what was changed. The copyright notice (ID 0)
    and the licence URL (ID 14) are kept, as the OFL requires.

OFL.txt is the package's own licence text with Adobe's copyright line first
(fontsource heads it with a generic "Google Inc."; the font's copyright is
Adobe's, name ID 0) and a line naming the Modified Version.
"""

import base64
import hashlib
import io
import sys
import tarfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "fonts" / "aguja-display-400.woff2"
LICENCE = ROOT / "docs" / "assets" / "fonts" / "OFL.txt"

PACKAGE = "@fontsource-variable/source-serif-4@5.3.0"
# `npm view @fontsource-variable/source-serif-4@5.3.0 dist.integrity`
INTEGRITY = "sha512-9vch9WqxjaaA+1o9Ur8pOgIGbCYLjRReOUel23A6lOpD1syptgjtkORevvNmldJ5kGXQL29onQUqI5Ltz0s3bQ=="
MEMBER = "package/files/source-serif-4-latin-opsz-normal.woff2"
LICENCE_MEMBER = "package/LICENSE"

TEXT = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "¡¿«»·ºª°×÷€ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÇçÂÊÎÔÛâêîôûÄËÏÖäëïöŒœ"
    + "–—‘’“”…•"
)
FEATURES = ["kern", "liga", "calt", "case", "lnum", "pnum", "onum", "tnum"]
COPYRIGHT = "Copyright 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'."
MODIFIED = "Aguja Display: Modified Version by MAECLY, 2026 (instanced, subset, renamed)."
DESCRIPTION = (
    "Aguja Display is a Modified Version of Source Serif 4 (Adobe): optical size 60, weight 400, "
    "Latin subset, renamed under the SIL Open Font License 1.1."
)


def read_inputs(src: Path) -> tuple[bytes, str | None]:
    if src.suffix == ".woff2":
        return src.read_bytes(), None
    data = src.read_bytes()
    digest = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if digest != INTEGRITY:
        raise SystemExit(f"{src} is not {PACKAGE}: {digest}")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        font = tar.extractfile(MEMBER).read()
        licence = tar.extractfile(LICENCE_MEMBER).read().decode("utf-8")
    return font, licence


def build(font_bytes: bytes) -> TTFont:
    font = TTFont(io.BytesIO(font_bytes))
    font = instancer.instantiateVariableFont(font, {"opsz": 60, "wght": 400}, inplace=False)
    # Keep the source's head.modified, so the same input gives the same bytes.
    font.recalcTimestamp = False
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=TEXT)
    subsetter.subset(font)

    names = font["name"]
    for record in names.names:
        if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22, 25):
            record.string = (
                record.toUnicode()
                .replace("Source Serif 4", "Aguja Display")
                .replace("SourceSerif4Roman", "AgujaDisplay")
                .replace("SourceSerif4", "AgujaDisplay")
            )
    names.setName(DESCRIPTION, 10, 3, 1, 0x409)
    for record in names.names:
        if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22, 25) and "Source" in record.toUnicode():
            raise SystemExit(f"Reserved Font Name still in name {record.nameID}: {record.toUnicode()}")
    if "fvar" in font:
        raise SystemExit("still variable")
    font.flavor = "woff2"
    return font


def licence_text(package_licence: str | None) -> str:
    if package_licence is None:
        raise SystemExit("OFL.txt needs the tarball (its LICENSE); pass the .tgz")
    body = package_licence.split("\n", 2)
    # Drop fontsource's "Google Inc." heading and the blank line after it.
    if body[0].strip() != "Google Inc." or body[1].strip():
        raise SystemExit("unexpected LICENSE heading in the package")
    text = body[2]
    if "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007" not in text:
        raise SystemExit("the package LICENSE is not the OFL 1.1")
    return f"{COPYRIGHT}\n{MODIFIED}\n\n{text}"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    font_bytes, package_licence = read_inputs(Path(sys.argv[1]))
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT
    font = build(font_bytes)
    out.parent.mkdir(parents=True, exist_ok=True)
    font.save(out)
    check = TTFont(out)
    family = check["name"].getDebugName(1)
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: {out.stat().st_size} bytes, "
          f"{len(check.getGlyphOrder())} glyphs, family {family!r}")
    if package_licence is not None:
        LICENCE.write_text(licence_text(package_licence))
        print(f"{LICENCE.relative_to(ROOT)}: {LICENCE.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
