import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// --text-mute is the binder's small headings, the status bar's chapter and
// word count, hints and labels: body-size text, so WCAG AA asks 4.5:1 against
// every background it can sit on. Folio light and Quarry light were 4.21:1
// and 4.40:1 on --bg-app until 2026-10-06.

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const THEMES = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];

function tokens(theme: string): Record<string, string> {
  const block = CSS.match(new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("--text-mute", () => {
  for (const theme of THEMES) {
    it(`holds AA on every background of ${theme}`, () => {
      const t = tokens(theme);
      expect(t["text-mute"], "the theme defines it").toMatch(/^#/);
      const backgrounds = Object.entries(t).filter(([name]) => name.startsWith("bg-"));
      expect(backgrounds.length).toBeGreaterThanOrEqual(4);
      for (const [name, hex] of backgrounds) {
        expect(contrast(t["text-mute"], hex), `${theme}: --text-mute on --${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
