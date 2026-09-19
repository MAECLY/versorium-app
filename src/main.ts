import { mount } from "svelte";
import "./styles.css";

/** Last-resort surface: a boot failure must never leave a silent white window. */
function showFatal(error: unknown): void {
  const el = document.getElementById("app");
  if (!el || el.childElementCount > 0) return;
  const pre = document.createElement("pre");
  pre.style.cssText = "padding:24px;white-space:pre-wrap;font:13px ui-monospace,monospace;color:#8a5a2b;";
  pre.textContent = `Versorium failed to start.\n\n${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`;
  el.replaceChildren(pre);
}

window.addEventListener("error", (event) => showFatal(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showFatal(event.reason));

async function boot(): Promise<void> {
  // Dev-only IPC stand-in so the UI runs in a plain browser for E2E (tests/e2e).
  // The check is compile-time false in production builds, so nothing is bundled.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("mock") === "tauri") {
    await import("../tests/e2e/mock-tauri");
  }
  const { default: App } = await import("./App.svelte");
  mount(App, { target: document.getElementById("app")! });
  // The native window starts hidden; reveal it only once there is a UI to show.
  const { api, isTauri } = await import("$lib/tauri");
  if (isTauri()) await api.uiReady().catch(() => undefined);
}

boot().catch(showFatal);
