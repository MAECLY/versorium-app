import { isTauri } from "$lib/tauri";

/**
 * Open a web address in the system browser, never in Versorium's own window:
 * a page loaded there would replace the app, with no way back to the
 * manuscript. The capability grants the opener plugin's `open_url` and
 * nothing else, for `https://*` (src-tauri/capabilities/default.json): the
 * command alone comes with an empty scope, which the plugin reads as "open
 * nothing" (src-tauri/tests/opener_scope.rs).
 *
 * Only https is opened. Nothing in the app asks for anything else, so any
 * other scheme (`javascript:`, `file:`, plain `http:`) is a mistake, and it
 * is refused here rather than handed to the operating system, which the
 * capability would refuse too.
 */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("not_https");
  }
  if (parsed.protocol !== "https:") throw new Error("not_https");
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    // The frontend served alone (`make web`): a new tab, cut off from this one.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
