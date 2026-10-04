// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enabledCapabilities,
  globMatches,
  refusal,
  resolveOpenUrl,
  urlAllowed,
  type Capability,
  type Manifest,
} from "../e2e/opener-acl";

// The in-browser mock's opener (tests/e2e/opener-acl.ts) reads the app's
// capabilities the way Tauri and tauri-plugin-opener do, so that E2E tests
// fail when the real app would refuse an address. Here: what it makes of the
// shipped capability, and of each rule it copies, against the plugins' real
// ACL manifests. The Rust side, the real one, is src-tauri/tests/opener_scope.rs.

const ROOT = process.cwd();
const ACL = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/gen/schemas/acl-manifests.json"), "utf8")) as Record<
  string,
  Manifest
>;
const SHIPPED = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/capabilities/default.json"), "utf8")) as Capability;

const REPO = "https://github.com/MAECLY/versorium-app";
/** What the page opens: About's six links and a crash report's Report. */
const PAGE = [
  "https://www.maecly.com/about",
  "https://www.maecly.com",
  REPO,
  `${REPO}/blob/main/LICENSE`,
  `${REPO}/blob/main/CLA.md`,
  `${REPO}/releases`,
  `${REPO}/issues/new?title=Crash%3A%20x&body=Versorium%200.1.0`,
];
/** What it has no reason to open. */
const NEVER = [
  "http://www.maecly.com",
  "file:///etc/passwd",
  "mailto:someone@example.com",
  "tel:+15555550100",
  "javascript:alert(1)",
  "data:text/html,hi",
];

const capability = (permissions: Capability["permissions"], windows = ["main"]): Capability => ({
  identifier: "probe",
  windows,
  permissions,
});

/** Whether `url` would open, for the main window, under these capabilities. */
function opens(capabilities: Capability[], url: string, program?: string): boolean {
  const access = resolveOpenUrl(capabilities, ACL);
  return access.granted && urlAllowed(access, url, program);
}

describe("the shipped capability, as the mock reads it", () => {
  it("opens every address the page links to, and none it has no reason to", () => {
    for (const url of PAGE) expect(opens([SHIPPED], url), url).toBe(true);
    for (const url of NEVER) expect(opens([SHIPPED], url), url).toBe(false);
    // Only in the writer's default browser: the page never names a program.
    expect(opens([SHIPPED], PAGE[0], "Safari")).toBe(false);
  });
});

describe("the rules the mock copies from Tauri and the opener plugin", () => {
  it("grants the bare permission's command with an empty scope, which opens nothing", () => {
    // How v0.1.0's capability read: every About link refused in the real app.
    const bare = resolveOpenUrl([capability(["opener:allow-open-url"])], ACL);
    expect(bare.granted).toBe(true);
    expect(bare.allow).toEqual([]);
    for (const url of PAGE) expect(urlAllowed(bare, url), url).toBe(false);
  });

  it("opens http, https, mailto and tel with the plugin's default set, its global scope", () => {
    const defaults = [capability(["opener:default"])];
    for (const url of ["https://a.example", "http://a.example", "mailto:a@example.com", "tel:1"]) {
      expect(opens(defaults, url), url).toBe(true);
    }
    expect(opens(defaults, "file:///etc/passwd")).toBe(false);
    // The scope alone grants no command.
    expect(resolveOpenUrl([capability(["opener:allow-default-urls"])], ACL).granted).toBe(false);
  });

  it("lets a deny entry win over an allow entry", () => {
    const narrowed = capability([
      { identifier: "opener:allow-open-url", allow: [{ url: "https://*" }], deny: [{ url: "https://evil.example/*" }] },
    ]);
    expect(opens([narrowed], "https://www.maecly.com")).toBe(true);
    expect(opens([narrowed], "https://evil.example/x")).toBe(false);
  });

  it("refuses the command to a window no capability names, and to every window once any denies it", () => {
    const https = { identifier: "opener:allow-open-url", allow: [{ url: "https://*" }] };
    expect(opens([capability([https], ["settings"])], PAGE[0])).toBe(false);
    expect(opens([capability([https]), capability(["opener:deny-open-url"], ["other"])], PAGE[0])).toBe(false);
  });

  it("matches a program only where the entry names it, and any program with `app: true`", () => {
    const named = capability([{ identifier: "opener:allow-open-url", allow: [{ url: "https://*", app: "firefox" }] }]);
    expect(opens([named], PAGE[0], "firefox")).toBe(true);
    expect(opens([named], PAGE[0])).toBe(false);
    const any = capability([{ identifier: "opener:allow-open-url", allow: [{ url: "https://*", app: true }] }]);
    expect(opens([any], PAGE[0], "firefox")).toBe(true);
    expect(opens([any], PAGE[0])).toBe(true);
  });

  it("reads only the capabilities tauri.conf.json lists, when it lists any", () => {
    const other = { ...capability(["opener:default"]), identifier: "other" };
    expect(enabledCapabilities([SHIPPED, other])).toEqual([SHIPPED, other]);
    expect(enabledCapabilities([SHIPPED, other], ["default"])).toEqual([SHIPPED]);
    expect(() => enabledCapabilities([SHIPPED], ["missing"])).toThrow(/missing/);
  });

  it("matches as Rust's glob does: `*` across slashes, `?` one character, the rest literally", () => {
    expect(globMatches("https://*", `${REPO}/blob/main/LICENSE`)).toBe(true);
    expect(globMatches("https://*", "http://www.maecly.com")).toBe(false);
    expect(globMatches("https://*", "HTTPS://WWW.MAECLY.COM")).toBe(false);
    expect(globMatches("https://www.maecly.com/?", "https://www.maecly.com/a")).toBe(true);
    expect(globMatches("https://www.maecly.com", "https://wwwXmaecly.com")).toBe(false);
    expect(() => globMatches("https://[ab]*", "https://a")).toThrow(/classes/);
  });

  it("refuses in the plugin's words", () => {
    expect(refusal("http://a.example")).toBe("Not allowed to open url http://a.example");
    expect(refusal("https://a.example", "Safari")).toBe("Not allowed to open url https://a.example with Safari");
  });
});
