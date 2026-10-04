import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternal } from "$lib/external";

// Where a web address is opened: the system browser through the opener in the
// desktop app, a new tab cut off from this one in the browser preview, and
// nowhere at all for anything that is not https.

const env = vi.hoisted(() => ({ tauri: true }));

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => env.tauri,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

let windowOpen: MockInstance<typeof window.open>;

beforeEach(() => {
  vi.clearAllMocks();
  env.tauri = true;
  windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => windowOpen.mockRestore());

it("hands an https address to the opener, as written", async () => {
  await openExternal("https://www.maecly.com");
  expect(openUrl).toHaveBeenCalledTimes(1);
  expect(openUrl).toHaveBeenCalledWith("https://www.maecly.com");
  expect(windowOpen).not.toHaveBeenCalled();
});

it("refuses anything that is not https, before it reaches the opener or a window", async () => {
  for (const url of [
    "javascript:alert(1)",
    "http://www.maecly.com",
    "file:///etc/passwd",
    "data:text/html,hi",
    "www.maecly.com",
    "",
  ]) {
    for (const tauri of [true, false]) {
      env.tauri = tauri;
      await expect(openExternal(url), `${url} (${tauri ? "desktop" : "browser"})`).rejects.toThrow("not_https");
    }
  }
  expect(openUrl).not.toHaveBeenCalled();
  expect(windowOpen).not.toHaveBeenCalled();
});

it("in the browser preview opens a new tab with no way back to this one", async () => {
  env.tauri = false;
  await openExternal("https://github.com/MAECLY/versorium-app");
  expect(windowOpen).toHaveBeenCalledWith("https://github.com/MAECLY/versorium-app", "_blank", "noopener,noreferrer");
  expect(openUrl).not.toHaveBeenCalled();
});

it("lets the opener's refusal through, for the page to say so", async () => {
  vi.mocked(openUrl).mockRejectedValueOnce("denied");
  await expect(openExternal("https://www.maecly.com/about")).rejects.toBe("denied");
});
