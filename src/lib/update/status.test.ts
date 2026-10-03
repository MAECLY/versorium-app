import { afterAll, beforeEach, expect, it } from "vitest";
import { setLocale } from "$lib/i18n";
import type { UpdateStatus } from "$lib/tauri";
import { statusLine } from "./status";
import en from "../../../locales/en/ui.json";
import es from "../../../locales/es/ui.json";

// Every state Settings → Updates can be in after a check, in both languages.
// Spec §11 as amended on 2026-10-03: no token means an anonymous check, so
// these lines are what a writer without one actually reads.

const checked: UpdateStatus = {
  currentVersion: "0.1.0",
  available: null,
  channel: "stable",
  automatic: true,
  tokenSet: false,
  checking: false,
  checked: true,
  lastError: null,
  resetsAt: null,
};

const failed = (lastError: string, resetsAt: number | null = null): UpdateStatus => ({
  ...checked,
  lastError,
  resetsAt,
});

const RESET = 1_791_054_785;
const clock = (locale: string) =>
  new Date(RESET * 1000).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

beforeEach(async () => {
  await setLocale("en");
});

afterAll(async () => {
  await setLocale("en");
});

it("before any check finishes it claims nothing", () => {
  expect(statusLine(null)).toEqual({ text: "Not checked yet.", tone: "quiet", hint: null });
  // Loaded, but nothing asked yet: "newest release" would be unverified.
  expect(statusLine({ ...checked, checked: false }).text).toBe("Not checked yet.");
});

it("a finished check with nothing newer says so", () => {
  expect(statusLine(checked)).toEqual({ text: "This is the newest release.", tone: "quiet", hint: null });
});

it("an offer is the one line in the accent colour", () => {
  const line = statusLine({ ...checked, available: { version: "0.2.0", notes: "", date: null } });
  expect(line).toEqual({ text: "Version 0.2.0 is available.", tone: "accent", hint: null });
});

it("nothing visible yet is a quiet status, not an error", () => {
  // The 404 a private repository, or one with no release, gives an outsider.
  const line = statusLine(failed("update_none_visible"));
  expect(line.text).toBe(en.errors.update_none_visible);
  expect(line.tone).toBe("quiet");
  expect(statusLine(failed("no_release")).tone).toBe("quiet");
});

it("the anonymous limit says a token lifts it, and when it resets", () => {
  const line = statusLine(failed("update_rate_limited", RESET));
  expect(line.text).toContain("An updates token, saved in Settings → Application, lifts it.");
  expect(line.text).toContain(`It resets at ${clock("en")}.`);
  expect(line.tone).toBe("warn");
});

it("a limit with no reset time does not invent one", () => {
  const line = statusLine(failed("update_rate_limited"));
  expect(line.text).toBe(en.errors.update_rate_limited);
  expect(line.text).not.toContain("resets");
});

it("a limit reached with a token does not advise adding one", () => {
  const line = statusLine(failed("update_rate_limited_token", RESET));
  expect(line.text).toContain(en.errors.update_rate_limited_token);
  expect(line.text).not.toContain("lifts it");
  expect(line.text).toContain(`It resets at ${clock("en")}.`);
});

it("a refused token is the writer's to fix", () => {
  const line = statusLine(failed("update_token_rejected"));
  expect(line.text).toContain("wrong or has been revoked");
  expect(line.tone).toBe("warn");
});

it("offline stays quiet and says why it stays quiet", () => {
  // Spec §11.7: "Offline: no molestar". A line, a reason, no alert. `network`
  // also covers a 5xx and a refusal that is neither a limit nor a token's, when
  // GitHub did answer, so the line may not claim it was unreachable.
  expect(statusLine(failed("network"))).toEqual({
    text: "GitHub could not be reached, or did not answer as expected, so nothing was checked.",
    tone: "quiet",
    hint: "A failed check is left alone — no pop-up, no retry loop.",
  });
});

it("a reset at one o'clock reads correctly in Spanish", async () => {
  // Spanish puts the article in agreement with the hour: "a la 1:05" but
  // "a las 13:05". The sentence carries no article, so no hour can be wrong.
  await setLocale("es");
  const oneOClock = new Date(2026, 9, 3, 1, 5).getTime() / 1000;
  const text = statusLine(failed("update_rate_limited", oneOClock)).text;
  expect(text).toContain("1:05");
  expect(text).not.toMatch(/\blas 1:/);
});

it("every state reads in Spanish, with no English left in it", async () => {
  await setLocale("es");
  const cases: [UpdateStatus | null, string][] = [
    [null, es.updates.never],
    [checked, es.updates.upToDate],
    [failed("update_none_visible"), es.errors.update_none_visible],
    [failed("update_rate_limited"), es.errors.update_rate_limited],
    [failed("update_rate_limited_token"), es.errors.update_rate_limited_token],
    [failed("update_token_rejected"), es.errors.update_token_rejected],
    [failed("network"), es.updates.offline],
  ];
  for (const [status, spanish] of cases) expect(statusLine(status).text).toBe(spanish);
  // The reset time is in the Spanish sentence, formatted the Spanish way.
  expect(statusLine(failed("update_rate_limited", RESET)).text).toBe(
    `${es.errors.update_rate_limited} ${es.updates.resetsAt.replace("{time}", clock("es"))}`,
  );
  expect(statusLine(failed("network")).hint).toBe(es.updates.offlineHint);
  // No sentence from the English table leaks through a missing key.
  const english = new Set(Object.values({ ...en.errors, ...flat(en.updates) }));
  for (const [status] of cases) expect(english.has(statusLine(status).text)).toBe(false);
});

function flat(table: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).filter((e): e is [string, string] => typeof e[1] === "string"));
}
