#!/usr/bin/env node
// Two invariants that every other check is blind to:
//
//   1. A key present in one language only. The `t()` helper falls back to
//      returning the key itself, so the writer sees `errors.llama_busy` where a
//      sentence should be — visible to a human, invisible to svelte-check.
//   2. An error code containing a space. `errors.ts` does
//      `raw.split(" ").pop()` to strip Rust's error prefixes, so a code with a
//      space silently becomes only its last word and resolves to nothing.
//
// Run: node tests/locale-parity.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "locales");

/** Every language directory, so adding one cannot quietly skip this check. */
const languages = readdirSync(localesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === "object" ? flatten(child, path) : [[path, child]];
  });
}

const tables = new Map(
  languages.map((lang) => [
    lang,
    new Map(flatten(JSON.parse(readFileSync(join(localesDir, lang, "ui.json"), "utf8")))),
  ]),
);

const problems = [];

// Compared against the union rather than pairwise, so a key missing from two
// languages at once is still reported for both.
const every = new Set([...tables.values()].flatMap((t) => [...t.keys()]));
for (const [lang, table] of tables) {
  const missing = [...every].filter((key) => !table.has(key)).sort();
  if (missing.length > 0) problems.push(`${lang} is missing ${missing.length}: ${missing.join(", ")}`);
}

for (const [lang, table] of tables) {
  const spaced = [...table.keys()]
    .filter((key) => key.startsWith("errors.") && key.split(".").pop().includes(" "))
    .sort();
  if (spaced.length > 0) problems.push(`${lang} has error codes containing a space: ${spaced.join(", ")}`);
}

// An empty string renders as nothing at all, which reads as a layout bug.
for (const [lang, table] of tables) {
  const blank = [...table.entries()]
    .filter(([, value]) => typeof value === "string" && value.trim() === "")
    .map(([key]) => key)
    .sort();
  if (blank.length > 0) problems.push(`${lang} has blank strings: ${blank.join(", ")}`);
}

if (problems.length > 0) {
  console.error("Locale check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}

console.log(
  `Locales OK: ${languages.join(", ")} — ${every.size} keys each, no blanks, no spaces in error codes.`,
);
