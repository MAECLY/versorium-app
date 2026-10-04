import { describe, expect, it } from "vitest";
import { CARD_CHARS, cardText } from "$lib/binder/cardText";

// What a corkboard card says (src/lib/binder/cardText.ts): the writer's
// synopsis when the chapter keeps one, its opening words when it does not,
// and which of the two it is, so an excerpt is never shown as a synopsis.

const doc = (body: string, frontmatter: Record<string, string> = {}) => ({ frontmatter, body });

describe("a card", () => {
  it("prefers the synopsis over the chapter's first lines", () => {
    expect(cardText(doc("It rained for three days.", { synopsis: "She leaves." }))).toEqual({
      kind: "synopsis",
      text: "She leaves.",
    });
  });

  it("keeps a synopsis's own line breaks, and only trims its margins", () => {
    expect(cardText(doc("Body.", { synopsis: "  She leaves.\nAlone.  " }))).toEqual({
      kind: "synopsis",
      text: "She leaves.\nAlone.",
    });
  });

  it("falls back to the opening when the synopsis is blank", () => {
    for (const synopsis of ["", "   ", "\n"]) {
      expect(cardText(doc("It rained.", { synopsis })), JSON.stringify(synopsis)).toEqual({
        kind: "opening",
        text: "It rained.",
      });
    }
  });

  it("falls back when the synopsis is a YAML block the frontmatter reader cut to its first line", () => {
    for (const synopsis of ["|", ">", "|-", ">+", "|2", "| # by hand"]) {
      expect(cardText(doc("It rained.", { synopsis })).kind, synopsis).toBe("opening");
    }
    // Text that merely starts with one of those characters is a synopsis.
    expect(cardText(doc("It rained.", { synopsis: "> She leaves." })).kind).toBe("synopsis");
  });

  it("quotes the opening's prose and leaves scene headings out", () => {
    expect(cardText(doc("## Morning\n\nThe road bent north.\n\n#\n\nIt kept on.\n\n### Later"))).toEqual({
      kind: "opening",
      text: "The road bent north. It kept on.",
    });
    // A `#hashtag` is prose, not a heading.
    expect(cardText(doc("#hashtag here")).text).toBe("#hashtag here");
    // Headings and nothing else is nothing written yet.
    expect(cardText(doc("## Morning\n\n## Night")).kind).toBe("empty");
  });

  it("says there is nothing when there is neither", () => {
    expect(cardText(doc(""))).toEqual({ kind: "empty", text: "" });
    expect(cardText(doc("\n\n   \n", { synopsis: " " }))).toEqual({ kind: "empty", text: "" });
  });

  it("is cut at a whole character, never inside one", () => {
    const long = "🌙".repeat(CARD_CHARS + 10);
    for (const card of [cardText(doc(long)), cardText(doc("x", { synopsis: long }))]) {
      expect(Array.from(card.text)).toHaveLength(CARD_CHARS + 1);
      expect(card.text.endsWith("🌙…")).toBe(true);
      expect(card.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
    expect(cardText(doc("short")).text).toBe("short");
  });
});
