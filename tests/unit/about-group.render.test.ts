import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "$lib/tauri";
import { REPOSITORY } from "$lib/about";
import AboutGroup from "$lib/settings/groups/AboutGroup.svelte";

// Settings › About in jsdom: the version the running app reports, the links
// and where they go, every one through the opener and never the webview, and
// the way to the updater on Application.

const env = vi.hoisted(() => ({ tauri: true }));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), openManuscript: vi.fn() }));

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => env.tauri,
  api: { appInfo: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock("$lib/settings/nav", () => ({ useSettingsNav: () => nav, provideSettingsNav: () => undefined }));

/** Written out rather than imported from src/lib/about.ts, so a changed address fails here. */
const LINKS = [
  { text: "Miguel Angel Esparza Calero", href: "https://www.maecly.com/about", name: "Miguel Angel Esparza Calero (opens www.maecly.com/about in your browser)" },
  { text: "www.maecly.com", href: "https://www.maecly.com", name: "www.maecly.com (opens in your browser)" },
  { text: "github.com/MAECLY/versorium-app", href: "https://github.com/MAECLY/versorium-app", name: "github.com/MAECLY/versorium-app (opens in your browser)" },
  { text: "Read the license on GitHub", href: "https://github.com/MAECLY/versorium-app/blob/main/LICENSE", name: "Read the license on GitHub (opens in your browser)" },
  { text: "Read the CLA on GitHub", href: "https://github.com/MAECLY/versorium-app/blob/main/CLA.md", name: "Read the CLA on GitHub (opens in your browser)" },
  { text: "Read the third-party notices on GitHub", href: "https://github.com/MAECLY/versorium-app/blob/main/THIRD-PARTY-NOTICES.md", name: "Read the third-party notices on GitHub (opens in your browser)" },
  { text: "See the releases on GitHub", href: "https://github.com/MAECLY/versorium-app/releases", name: "See the releases on GitHub (opens in your browser)" },
];

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

async function render(): Promise<void> {
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AboutGroup, { target, props: {} });
  flushSync();
  await Promise.resolve();
  flushSync();
}

/** The words on screen: the link's text without its hidden part. */
function visible(link: HTMLAnchorElement): string {
  const copy = link.cloneNode(true) as HTMLAnchorElement;
  copy.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
  return copy.textContent?.trim() ?? "";
}

const links = () => [...target.querySelectorAll<HTMLAnchorElement>("a")];
const linkTo = (href: string) => links().find((a) => a.getAttribute("href") === href)!;
const click = (el: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.clearAllMocks();
  env.tauri = true;
  vi.mocked(api.appInfo).mockResolvedValue({ version: "9.8.7-test", os: "macos", family: "unix" });
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
});

it("shows the version the running app reports", async () => {
  await render();
  await vi.waitFor(() => expect(target.querySelector('[data-about="version"]')?.textContent).toBe("9.8.7-test"));
  expect(api.appInfo).toHaveBeenCalledTimes(1);
  // Next to it, the name and who makes it, in words a reader can follow.
  expect(target.querySelector("h3")?.textContent).toBe("Versorium");
  expect([...target.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
    "Installed version",
    "Made by",
    "Website",
    "Source code",
  ]);
});

it("links to the author, the website, the code, the license, the CLA and the releases", async () => {
  await render();
  expect(links().map((a) => ({ text: visible(a), href: a.getAttribute("href") }))).toEqual(
    LINKS.map(({ text, href }) => ({ text, href })),
  );
  for (const link of links()) {
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("draggable")).toBe("false");
  }
  // The documents the license section links are in this repository, at its root.
  expect(existsSync(resolve(process.cwd(), "LICENSE"))).toBe(true);
  expect(existsSync(resolve(process.cwd(), "CLA.md"))).toBe(true);
  expect(existsSync(resolve(process.cwd(), "THIRD-PARTY-NOTICES.md"))).toBe(true);
});

it("names every link by its words, then says it opens the browser", async () => {
  await render();
  // jsdom has no accessibility tree; the name is the link's text, hidden part
  // included, which is what a browser computes for it (Playwright checks the real one).
  expect(links().map((a) => a.textContent?.replace(/\s+/g, " ").trim())).toEqual(LINKS.map((l) => l.name));
});

it("opens each address through the opener, and never lets the webview follow it", async () => {
  await render();
  for (const { href } of LINKS) {
    vi.mocked(openUrl).mockClear();
    const event = click(linkTo(href));
    expect(event.defaultPrevented, href).toBe(true);
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(openUrl).toHaveBeenCalledWith(href);
  }
  // A modified click is still a click on this link: the webview would open it
  // in a window of its own.
  vi.mocked(openUrl).mockClear();
  expect(click(linkTo(LINKS[1].href), { metaKey: true }).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(LINKS[1].href));
});

it("opens the browser on the middle button, and does nothing on the right one's release", async () => {
  await render();
  const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
  linkTo(LINKS[3].href).dispatchEvent(middle);
  expect(middle.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(LINKS[3].href));
  vi.mocked(openUrl).mockClear();
  // WebKit sends the right button's release as an auxclick too.
  const right = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
  linkTo(LINKS[3].href).dispatchEvent(right);
  expect(right.defaultPrevented).toBe(true);
  // Opening waits on a dynamic import, so "not yet" proves nothing. A middle
  // press made after it is heard once it lands, and whatever the right button
  // had set off would have landed before it.
  linkTo(LINKS[4].href).dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
  await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(LINKS[4].href));
  expect(vi.mocked(openUrl).mock.calls).toEqual([[LINKS[4].href]]);
});

/** The section each link sits in, by its heading's id, in LINKS' order. */
const SECTIONS = [
  "about-versorium-title",
  "about-versorium-title",
  "about-versorium-title",
  "about-license-title",
  "about-license-title",
  "about-license-title",
  "about-updates-title",
];

it("says so in the link's own section, with the address, whichever link the browser would not open", async () => {
  await render();
  for (const [i, { href }] of LINKS.entries()) {
    vi.mocked(openUrl).mockRejectedValueOnce("Not allowed to open url");
    click(linkTo(href));
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]'), href).not.toBeNull());
    const alerts = target.querySelectorAll('[role="alert"]');
    expect(alerts, href).toHaveLength(1);
    expect(alerts[0].textContent, href).toContain("Your browser could not be opened. The address is:");
    expect(alerts[0].querySelector(".v-mono-select")?.textContent, href).toBe(href);
    // In the section of the link that failed.
    expect(alerts[0].closest("section")?.getAttribute("aria-labelledby"), href).toBe(SECTIONS[i]);
    // The next link that opens takes the line away.
    click(linkTo(LINKS[(i + 1) % LINKS.length].href));
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]'), href).toBeNull());
  }
});

it("shows a dash, and lets nothing go unhandled, when the app does not say its version", async () => {
  // Vitest fails a run on an unhandled rejection, so this also holds the
  // handler that catches it.
  vi.mocked(api.appInfo).mockRejectedValue("io");
  await render();
  await vi.waitFor(() => expect(api.appInfo).toHaveBeenCalledTimes(1));
  await new Promise((settled) => setTimeout(settled, 0));
  flushSync();
  expect(target.querySelector('[data-about="version"]')?.textContent).toBe("—");
});

it("sends the writer to the updater on Application rather than checking here", async () => {
  await render();
  const button = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Check for updates in Application ›");
  expect(button).toBeDefined();
  button!.click();
  expect(nav.navigate).toHaveBeenCalledWith({ page: "app", focus: "updates" });
});

it("outside the desktop app has no version to show and no updater to point at", async () => {
  env.tauri = false;
  await render();
  expect(api.appInfo).not.toHaveBeenCalled();
  expect(target.querySelector('[data-about="version"]')?.textContent).toBe("—");
  expect(target.querySelector("#about-updates-title")).toBeNull();
  // Every link but the releases one, which sits in the updates section.
  expect(links()).toHaveLength(LINKS.length - 1);
});

it("names the repository the updater is compiled to read", () => {
  const rust = readFileSync(resolve(process.cwd(), "src-tauri/src/update/mod.rs"), "utf8");
  const owner = /const UPDATE_OWNER: &str = "([^"]+)";/.exec(rust)?.[1];
  const repo = /const UPDATE_REPO: &str = "([^"]+)";/.exec(rust)?.[1];
  expect(owner && repo).toBeTruthy();
  expect(REPOSITORY).toBe(`https://github.com/${owner}/${repo}`);
});
