import { getLocale, t } from "$lib/i18n";
import { errorMessage } from "$lib/i18n/errors";
import type { UpdateStatus } from "$lib/tauri";

/**
 * What Settings → Updates says about the last check, and in what voice.
 *
 * `quiet` is for states that are nobody's fault and need nothing from the
 * writer: nothing published yet, offline. `warn` is for the ones they can act
 * on: a limit a token would lift, a token GitHub refused. None of them is an
 * alert or a modal — spec §11.7, "Offline: no molestar".
 */
export interface StatusLine {
  text: string;
  tone: "accent" | "quiet" | "warn";
  /** A second, smaller line: why an offline check stays quiet. */
  hint: string | null;
}

/** Codes that describe the world rather than a fault. */
const QUIET = new Set(["update_none_visible", "no_release"]);

const RATE_LIMITED = new Set(["update_rate_limited", "update_rate_limited_token"]);

/** Local wall-clock time, in the UI's language: the limit lifts within the hour. */
function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(getLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Pure over the status, so every state is tested in both languages without
 * rendering the panel. `checked` comes first: before any check finishes,
 * "this is the newest release" would be a claim nobody verified.
 */
export function statusLine(status: UpdateStatus | null): StatusLine {
  if (!status?.checked) return { text: t("updates.never"), tone: "quiet", hint: null };
  if (status.available) {
    return {
      text: t("updates.availableShort", { version: status.available.version }),
      tone: "accent",
      hint: null,
    };
  }
  const code = status.lastError;
  if (!code) return { text: t("updates.upToDate"), tone: "quiet", hint: null };
  if (code === "network") {
    return { text: t("updates.offline"), tone: "quiet", hint: t("updates.offlineHint") };
  }
  let text = errorMessage(code);
  if (RATE_LIMITED.has(code) && status.resetsAt !== null) {
    text = `${text} ${t("updates.resetsAt", { time: clockTime(status.resetsAt) })}`;
  }
  return { text, tone: QUIET.has(code) ? "quiet" : "warn", hint: null };
}
