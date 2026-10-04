// Copies the app's theme tokens into the landing page stylesheet.
//
// docs/assets/site.css carries the six [data-theme] blocks and the two
// color-scheme rules of src/styles.css byte for byte, between the
// `tokens:begin` and `tokens:end` markers. Run this after the app's palette
// changes; `--check` exits 1 when the copy has drifted (verify.mjs runs it).
//
//   node tests/landing/tokens.mjs           # rewrite the block
//   node tests/landing/tokens.mjs --check   # compare only
//   APP_REF=HEAD node tests/landing/tokens.mjs --check   # against the committed app

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const APP_CSS = path.join(ROOT, "src/styles.css");
// DOCS_DIR points the check at another copy of docs/ (verify-selftest.mjs).
const SITE_CSS = path.join(process.env.DOCS_DIR ?? path.join(ROOT, "docs"), "assets/site.css");
const BEGIN = "/* tokens:begin — copied from src/styles.css by tests/landing/tokens.mjs; do not edit by hand */";
const END = "/* tokens:end */";

/** Every top-level rule whose selector names a theme, in source order, exactly as written. */
export async function appTokens() {
  // Comments belong to the app's file, not to the copy; none sit inside a token block.
  // APP_REF=HEAD compares with the app as committed rather than the working tree.
  const source = process.env.APP_REF
    ? execFileSync("git", ["-C", ROOT, "show", `${process.env.APP_REF}:src/styles.css`], { encoding: "utf8" })
    : await readFile(APP_CSS, "utf8");
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = css.slice(preludeStart, i);
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        // A statement such as `@import …;` can precede the selector.
        const selector = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
        if (/\[data-theme\$?="[^"]+"\]/.test(selector)) {
          rules.push(`${selector} {${css.slice(bodyStart, i)}}`);
        }
        preludeStart = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      preludeStart = i + 1;
    }
  }
  return rules.join("\n\n");
}

export async function siteTokens() {
  const css = await readFile(SITE_CSS, "utf8");
  const start = css.indexOf(BEGIN);
  const end = css.indexOf(END);
  if (start < 0 || end < 0) throw new Error("token markers missing from docs/assets/site.css");
  return { css, start, end, block: css.slice(start + BEGIN.length, end).trim() };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const tokens = await appTokens();
  const { css, start, end, block } = await siteTokens();
  if (process.argv.includes("--check")) {
    if (block !== tokens) {
      console.error("docs/assets/site.css tokens differ from src/styles.css; run node tests/landing/tokens.mjs");
      process.exitCode = 1;
    } else {
      console.log("tokens match src/styles.css");
    }
  } else {
    const next = `${css.slice(0, start)}${BEGIN}\n${tokens}\n${css.slice(end)}`;
    await writeFile(SITE_CSS, next);
    console.log(`wrote ${tokens.split("\n").length} lines of tokens into docs/assets/site.css`);
  }
}
