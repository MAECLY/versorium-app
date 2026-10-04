import type { ChapterDoc } from "$lib/tauri";

/**
 * What a corkboard card says about its chapter, and where that came from.
 *
 * `synopsis` is the writer's own summary (`synopsis:` in the frontmatter, kept
 * by a Scrivener import); `opening` is the chapter's first words, quoted
 * because there is no summary; `empty` means there is neither. The card shows
 * which one it is, so an excerpt is never passed off as a synopsis.
 */
export type CardText = { kind: "synopsis" | "opening" | "empty"; text: string };

/** Longest text a card shows, in characters. */
export const CARD_CHARS = 200;

/**
 * A YAML block's first line: `|` or `>`, a chomping sign or an indent digit,
 * maybe a comment. The frontmatter reader takes one line per key, so a
 * synopsis written by hand as a block arrives as this line alone, and the card
 * falls back rather than showing a lone `|`. Rust's `readable_synopsis` (in
 * src-tauri/src/formats/mod.rs) draws the same line for the Scrivener export.
 */
const BLOCK_INDICATOR = /^[|>][1-9+-]{0,2}(\s+#.*)?$/;

/** An ATX heading line, `#` to `######`, with or without words after it. */
const HEADING = /^#{1,6}(\s|$)/;

/** At most `CARD_CHARS` characters, cut between code points, never inside one. */
function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > CARD_CHARS ? `${chars.slice(0, CARD_CHARS).join("").trimEnd()}…` : text;
}

export function cardText(doc: ChapterDoc): CardText {
  const synopsis = (doc.frontmatter.synopsis ?? "").trim();
  if (synopsis && !BLOCK_INDICATOR.test(synopsis)) return { kind: "synopsis", text: clip(synopsis) };

  // Prose only. A scene heading (or the lone `#` an imported scene break
  // leaves) is structure, and glued to the sentence after it, it read as one
  // ungrammatical line quoted from the chapter.
  const opening = doc.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !HEADING.test(line))
    .join(" ");
  return opening ? { kind: "opening", text: clip(opening) } : { kind: "empty", text: "" };
}
