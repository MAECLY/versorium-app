import { mount } from "svelte";
import "./styles.css";

async function boot(): Promise<void> {
  // Dev-only IPC stand-in so the UI runs in a plain browser for E2E (tests/e2e).
  // The check is compile-time false in production builds, so nothing is bundled.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("mock") === "tauri") {
    await import("../tests/e2e/mock-tauri");
  }
  const { default: App } = await import("./App.svelte");
  mount(App, { target: document.getElementById("app")! });
}

void boot();
