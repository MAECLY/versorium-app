import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import en from "../../locales/en/ui.json";
import es from "../../locales/es/ui.json";

// Every literal key the Settings pages, the Continuity tab and the links that
// leave the app ask t() for exists in English and Spanish. `t()` falls back to
// English and then to the key itself, so a key missing from es shows English
// in the Spanish app, and a misspelt one shows the raw key: neither is caught
// by the type checker, and locale-parity only compares the two files with each
// other.

const ROOT = process.cwd();

/**
 * Missing before the Settings redesign, and outside it: Application's
 * credential-store line asks for a key neither locale has, so the raw key is
 * what a writer would read (docs/project/TODO.md, "Found while building the Settings
 * redesign"). Listed so this test guards everything else; it fails once the
 * key is written, as a reminder to take it off this list.
 */
const KNOWN_MISSING = ["en errors.keyring_unavailable", "es errors.keyring_unavailable"];
const SOURCES = [
  "src/lib/settings",
  "src/lib/components/ContinuityPanel.svelte",
  "src/lib/components/ExternalLink.svelte",
  "src/lib/mcp/activity.ts",
];

function files(path: string): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
}

/** `t("a.b")` and `t('a.b', …)`: literal keys only; template keys are checked where they are built. */
function literalKeys(source: string): string[] {
  return [...source.matchAll(/\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g)].map((m) => m[1]);
}

it("every literal key in Settings and the Continuity tab is in English and Spanish", () => {
  const sources = SOURCES.flatMap(files).filter((f) => /\.(svelte|ts)$/.test(f) && !f.endsWith(".test.ts"));
  const keys = new Set(sources.flatMap((file) => literalKeys(readFileSync(file, "utf8"))));
  expect(keys.size, "the scan found the keys it is meant to check").toBeGreaterThan(150);
  const missing: string[] = [];
  for (const key of keys) {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      const value = lookup(dict, key);
      if (typeof value !== "string" || value.trim() === "") missing.push(`${lang} ${key}`);
    }
  }
  expect(missing).toEqual(KNOWN_MISSING);
});
