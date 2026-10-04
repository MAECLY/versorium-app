// WCAG 2 contrast of the token pairs the landing page (docs/) paints with, in
// all six theme variants. The values are read from src/styles.css itself, so
// this cannot drift from the app's palette.
//
//   node tests/landing/contrast.mjs          # table of every pair
//   node tests/landing/contrast.mjs --check  # exit 1 if a used pair fails
//
// A pair is listed with the minimum it has to reach on the page: 4.5 for body
// text, 3 for large text and for non-text indicators (focus ring, the selected
// swatch outline).

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const css = await readFile(path.join(ROOT, "src/styles.css"), "utf8");

const VARIANTS = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];

/** Token values per variant, with folio-light (the :root block) as the base every variant inherits. */
function tokens() {
  const blocks = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1];
    const body = m[2];
    const name = selector.match(/\[data-theme="([a-z]+-(?:light|dark))"\]/)?.[1];
    if (!name) continue;
    const vars = {};
    for (const decl of body.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) vars[decl[1]] = decl[2].trim();
    blocks[name] = vars;
  }
  const base = blocks["folio-light"];
  return Object.fromEntries(VARIANTS.map((v) => [v, { ...base, ...blocks[v] }]));
}

function lum(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** [foreground, background, minimum, where it is used]; a minimum of 0 marks a
    pair the page does not paint (listed so nobody starts to). */
export const PAIRS = [
  ["--text", "--bg-app", 4.5, "header and footer text"],
  ["--text", "--bg-editor", 4.5, "body text on the page"],
  ["--text", "--bg-elev", 4.5, "text in cards, pills and buttons"],
  ["--text-mute", "--bg-editor", 4.5, "captions, hints, the dial's labels"],
  ["--text-mute", "--bg-elev", 4.5, "secondary text in cards (details pages)"],
  ["--accent", "--bg-app", 4.5, "links in the footer"],
  ["--accent", "--bg-editor", 4.5, "links on the page"],
  ["--accent", "--bg-elev", 4.5, "links in cards"],
  ["--accent-contrast", "--accent", 4.5, "primary buttons; the closing band's text"],
  ["--accent", "--accent-contrast", 4.5, "the closing band's button"],
  ["--ok", "--bg-app", 3, "\"Guardado\" in the app window (part of a picture)"],
  ["--accent", "--bg-editor", 3, "ink underlines, rules, annotations (non-text)"],
  ["--accent", "--bg-app", 3, "focus ring on the header, selected outline (non-text)"],
  ["--warn", "--bg-elev", 3, "the pill's dot and the notices' rule (non-text)"],
  ["--text-mute", "--bg-app", 0, "not used: under 4.5 in Folio and Quarry Light"],
  ["--text-mute", "--bg-panel", 0, "not used: under 4.5 in Folio Light"],
];

const all = tokens();
const check = process.argv.includes("--check");
let failed = 0;
const rows = [];
for (const [fg, bg, min, use] of PAIRS) {
  const cells = VARIANTS.map((v) => {
    const ratio = contrast(all[v][fg], all[v][bg]);
    if (ratio < min) failed += 1;
    return `${ratio.toFixed(2)}${ratio < min ? "!" : " "}`;
  });
  rows.push([`${fg} / ${bg}`, `>=${min}`, ...cells, use]);
}
const head = ["pair", "min", ...VARIANTS, "use"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ");
console.log(line(head));
for (const r of rows) console.log(line(r));
console.log(failed ? `\n${failed} cell(s) below the minimum (marked !)` : "\nevery pair passes");
if (check && failed) process.exitCode = 1;

export { tokens, VARIANTS };
