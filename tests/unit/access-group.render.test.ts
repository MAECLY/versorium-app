import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type McpClient, type McpStatus } from "$lib/tauri";
import AccessGroup from "$lib/settings/groups/AccessGroup.svelte";
import { mcp } from "$lib/mcp/state.svelte";
import { notices } from "$lib/notices/state.svelte";
import { disclosures } from "$lib/settings/disclosures.svelte";

// Settings → Access to your novel, in jsdom against a scripted backend: write
// access is a button and a dialog, only for a connected app, and taking it
// back from every app goes one app at a time.

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => true,
  api: {
    mcpStatus: vi.fn(),
    mcpLog: vi.fn(async () => []),
    mcpSetWrite: vi.fn(),
    mcpInstallClient: vi.fn(),
    mcpUninstallClient: vi.fn(),
    mcpHttpStatus: vi.fn(async () => ({ enabled: false, url: null, endpointFile: null })),
    mcpSetHttp: vi.fn(),
  },
}));

const client = (over: Partial<McpClient>): McpClient => ({
  id: "claude-code", name: "Claude Code", configPath: "/novel/.mcp.json",
  detected: true, installed: false, writeAllowed: false, ...over,
});

const status = (clients: McpClient[]): McpStatus => ({
  command: "/bin/versorium", args: ["mcp"], logPath: "/data/mcp-log.jsonl", clients,
});

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

async function render(clients: McpClient[]): Promise<void> {
  vi.mocked(api.mcpStatus).mockResolvedValue(status(clients));
  await mcp.load();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AccessGroup, { target, props: {} });
  flushSync();
}

beforeEach(() => {
  vi.clearAllMocks();
  mcp.status = null;
  mcp.error = null;
  for (const id of ["claude-code", "claude-desktop", "codex", "opencode"]) disclosures.set(`access:${id}`, true);
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
  document.querySelectorAll("dialog").forEach((d) => d.remove());
});

const buttonsNamed = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === text);

it("Allow writing… waits for the app to be connected, and says so", async () => {
  await render([client({ installed: false })]);
  const [allow] = buttonsNamed("Allow writing…");
  expect(allow.disabled).toBe(true);
  const why = document.getElementById(allow.getAttribute("aria-describedby") ?? "");
  expect(why?.textContent?.trim()).toBe("Connect Claude Code first.");
});

it("Keep read only changes nothing; the grant asks Rust once", async () => {
  vi.mocked(api.mcpSetWrite).mockResolvedValue(status([client({ installed: true, writeAllowed: true })]));
  await render([client({ installed: true })]);

  buttonsNamed("Allow writing…")[0].click();
  flushSync();
  const dialog = document.querySelector("dialog")!;
  expect(dialog.getAttribute("role")).toBe("alertdialog");
  // The product spec's sentence comes first, and describes the dialog.
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent?.trim()).toBe(
    "Write lets the AI change your manuscript. Versorium will snapshot Git first. You can roll back. The model can still delete text if you allow the edit.",
  );
  buttonsNamed("Keep read only")[0].click();
  flushSync();
  expect(api.mcpSetWrite).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull();

  buttonsNamed("Allow writing…")[0].click();
  flushSync();
  buttonsNamed("Let Claude Code write")[0].click();
  await vi.waitFor(() => expect(api.mcpSetWrite).toHaveBeenCalledTimes(1));
  expect(api.mcpSetWrite).toHaveBeenCalledWith("claude-code", true);
  await vi.waitFor(() => expect(target.textContent).toContain("1 app can change your manuscript: Claude Code."));
});

it("Make all read only takes each grant back in turn, a stale one included", async () => {
  const order: string[] = [];
  let remaining = [
    client({ id: "claude-code", installed: true, writeAllowed: true }),
    client({ id: "codex", name: "Codex", installed: true, writeAllowed: true }),
    client({ id: "opencode", name: "OpenCode", detected: false, installed: false, writeAllowed: true }),
  ];
  vi.mocked(api.mcpSetWrite).mockImplementation(async (id: string, allowed: boolean) => {
    order.push(`${id}:${allowed}`);
    // Slow enough that a second call made meanwhile would meet the busy guard.
    await new Promise((resolve) => setTimeout(resolve, 5));
    remaining = remaining.map((c) => (c.id === id ? { ...c, writeAllowed: allowed } : c));
    return status(remaining);
  });
  await render(remaining);
  expect(target.textContent).toContain("3 apps can change your manuscript");

  buttonsNamed("Make all read only")[0].click();
  await vi.waitFor(() => expect(target.textContent).toContain("No app can change your manuscript."));
  expect(order).toEqual(["claude-code:false", "codex:false", "opencode:false"]);
});

it("with no app found, says so and opens the list of the others", async () => {
  for (const id of ["claude-code", "claude-desktop", "codex", "opencode"]) disclosures.set(`access:${id}`, false);
  await render([
    client({ id: "claude-code", detected: false }),
    client({ id: "codex", name: "Codex", detected: false }),
  ]);
  expect(target.textContent).toContain("Versorium didn't find any of the apps it can connect.");
  // Its glyph is in the button too, hidden from the name.
  const notFound = [...document.querySelectorAll("button")].find((b) => b.textContent?.endsWith("Not found on this computer (2)"))!;
  expect(notFound.getAttribute("aria-expanded")).toBe("true");
  expect(buttonsNamed("Connect anyway")).toHaveLength(2);
});

it("a grant Rust refuses after the dialog says why in the row, and changes nothing", async () => {
  // Disconnected in another window, say, while the dialog was open.
  vi.mocked(api.mcpSetWrite).mockRejectedValue("mcp_client_not_connected");
  await render([client({ installed: true })]);
  buttonsNamed("Allow writing…")[0].click();
  flushSync();
  buttonsNamed("Let Claude Code write")[0].click();

  // In the row that asked, and only there: two alerts would be read twice.
  const row = document.getElementById("access-claude-code-panel")!;
  await vi.waitFor(() => expect(row.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
    "Connect that app before allowing it to write.",
  ));
  expect(target.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(target.textContent).toContain("No app can change your manuscript.");
  expect(document.querySelector("dialog")).toBeNull();
  // Back on the button that asked, which is still there.
  await vi.waitFor(() => expect(document.activeElement).toBe(buttonsNamed("Allow writing…")[0]));
});

it("Make read only takes one app's access back at once, and says so", async () => {
  for (const notice of [...notices.items]) notices.dismiss(notice.id);
  vi.mocked(api.mcpSetWrite).mockResolvedValue(status([client({ installed: true, writeAllowed: false })]));
  await render([client({ installed: true, writeAllowed: true })]);
  expect(target.textContent).toContain("1 app can change your manuscript: Claude Code.");

  // The safe direction: no dialog stands in the way.
  buttonsNamed("Make read only")[0].click();
  await vi.waitFor(() => expect(api.mcpSetWrite).toHaveBeenCalledWith("claude-code", false));
  expect(document.querySelector("dialog")).toBeNull();
  await vi.waitFor(() => expect(target.textContent).toContain("No app can change your manuscript."));
  expect(notices.items.map((n) => n.text)).toContain("Claude Code is read only now.");
  // Its place is taken by the button that grants it again, which gets focus.
  await vi.waitFor(() => expect(document.activeElement).toBe(buttonsNamed("Allow writing…")[0]));
});
