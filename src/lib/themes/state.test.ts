import { beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { THEME_MODES, THEME_NAMES, getTheme, setTheme, setThemeMode } from "./state.svelte";

/** What the stylesheet actually defines, so the tests compare against it. */
const css = readFileSync("src/styles.css", "utf8");

function tokensOf(variant: string): Record<string, string> {
  const block = new RegExp(`\\[data-theme="${variant}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`no [data-theme="${variant}"] in styles.css`);
  const out: Record<string, string> = {};
  for (const [, key, value] of block[1].matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    out[key] = value.trim();
  }
  return out;
}

beforeEach(() => {
  // A fresh install: Folio, following the system.
  setTheme("folio");
  setThemeMode("light");
});

it("keeps the theme the writer picked, in every mode", () => {
  // The bug this pins: the chosen theme used to be discarded whenever the mode
  // was `follow` and the system was dark — forced to Needle. Since `follow` is
  // the default, the theme picker did nothing at all on a dark-mode machine.
  for (const mode of THEME_MODES) {
    setThemeMode(mode);
    for (const name of THEME_NAMES) {
      setTheme(name);
      expect(getTheme()).toBe(name);
      expect(document.documentElement.dataset.theme).toMatch(new RegExp(`^${name}-(light|dark)$`));
    }
  }
});

it("composes a variant the stylesheet actually defines", () => {
  // A combination with no rule would leave the previous theme's colours on
  // screen, which is indistinguishable from the picker being broken.
  for (const name of THEME_NAMES) {
    for (const mode of ["light", "dark"] as const) {
      setThemeMode(mode);
      setTheme(name);
      const applied = document.documentElement.dataset.theme ?? "";
      expect(applied).toBe(`${name}-${mode}`);
      expect(css, `styles.css has no rule for ${applied}`).toContain(`[data-theme="${applied}"]`);
    }
  }
});

it("every theme has both a light and a dark variant", () => {
  // Otherwise choosing a theme could silently change the mode too.
  for (const name of THEME_NAMES) {
    for (const mode of ["light", "dark"] as const) {
      expect(() => tokensOf(`${name}-${mode}`)).not.toThrow();
    }
  }
});

it("the swatch colours are the stylesheet's own, not an approximation", () => {
  // The Appearance panel hardcodes these so it can show a theme without
  // applying it — reading a CSS variable only returns the theme in force. That
  // duplication is only safe while this test holds.
  const swatches = {
    folio: {
      light: { page: "#f3ecdd", ink: "#2c261c", accent: "#3d5a45" },
      dark: { page: "#242017", ink: "#e8e0d0", accent: "#a3b89a" },
    },
    quarry: {
      light: { page: "#f7f6f2", ink: "#1a1a18", accent: "#2a6f6a" },
      dark: { page: "#1c1c1a", ink: "#edece8", accent: "#7eb8b2" },
    },
    needle: {
      light: { page: "#f4f7f6", ink: "#1b2422", accent: "#2a6f6a" },
      dark: { page: "#121c1a", ink: "#e4ebe8", accent: "#7eb8b2" },
    },
  };
  for (const [name, byMode] of Object.entries(swatches)) {
    for (const [mode, colours] of Object.entries(byMode)) {
      const tokens = tokensOf(`${name}-${mode}`);
      expect(colours.page, `${name}-${mode} page`).toBe(tokens["--bg-editor"]);
      expect(colours.ink, `${name}-${mode} ink`).toBe(tokens["--text"]);
      expect(colours.accent, `${name}-${mode} accent`).toBe(tokens["--accent"]);
    }
  }
});

it("the accent is Needle Teal where the spec asks for it", () => {
  // Spec §5 names the accent; a theme that lost it would still look fine and be
  // wrong.
  for (const variant of ["quarry-light", "needle-light"]) {
    expect(tokensOf(variant)["--accent"]).toBe("#2a6f6a");
  }
});
