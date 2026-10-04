import type { Page } from "@playwright/test";

/**
 * Open the app on the mocked IPC, and wait for the mock itself.
 *
 * `page.goto` resolves at the load event, but `src/main.ts` imports the mock
 * inside `boot()`, which can finish after it. A spec that reads or changes
 * `window.__VERSORIUM_MOCK__` straight away raced that import: on a warm Vite
 * server it won, on a cold one it lost ("Cannot read properties of
 * undefined"). Anything that waits on the page first (a button, a dialog)
 * does not need this; the mock is in place before the app mounts.
 */
export async function gotoMock(page: Page, url = "/?mock=tauri"): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__VERSORIUM_MOCK__ !== undefined);
}
