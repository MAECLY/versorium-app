import { beforeEach, expect, it, vi } from "vitest";
import { api, type McpClient, type McpStatus } from "$lib/tauri";
import { McpStore } from "./state.svelte";

vi.mock("$lib/tauri", () => ({
  api: {
    mcpStatus: vi.fn(),
    mcpLog: vi.fn(),
    mcpSetWrite: vi.fn(),
    mcpInstallClient: vi.fn(),
    mcpUninstallClient: vi.fn(),
  },
  isTauri: () => true,
}));

const client = (over: Partial<McpClient> = {}): McpClient => ({
  id: "claude-code",
  name: "Claude Code",
  configPath: "/novel/.mcp.json",
  detected: true,
  installed: false,
  writeAllowed: false,
  ...over,
});

const status = (over: Partial<McpStatus> = {}): McpStatus => ({
  command: "/bin/versorium",
  args: ["mcp"],
  logPath: "/data/mcp-log.jsonl",
  clients: [client()],
  ...over,
});

const entry = { ts: 1, client: "claude-code", tool: "read_document", scope: "read" as const, outcome: "ok" as const, detail: "ch-01", format: 2 };

let store: McpStore;
beforeEach(() => {
  vi.clearAllMocks();
  store = new McpStore();
  vi.mocked(api.mcpStatus).mockResolvedValue(status());
  vi.mocked(api.mcpLog).mockResolvedValue([entry]);
});

it("loads the status and the log tail", async () => {
  await store.load();
  expect(store.clients[0].name).toBe("Claude Code");
  expect(store.log).toEqual([entry]);
  // All Rust keeps readable: Activity filters over it in the page.
  expect(api.mcpLog).toHaveBeenCalledWith(500);
  expect(store.error).toBeNull();
  expect(store.loading).toBe(false);
});

it("adopts the status returned when write is toggled", async () => {
  await store.load();
  vi.mocked(api.mcpSetWrite).mockResolvedValue(status({ clients: [client({ writeAllowed: true })] }));
  await store.setWrite("claude-code", true);
  expect(api.mcpSetWrite).toHaveBeenCalledWith("claude-code", true);
  expect(store.clients[0].writeAllowed).toBe(true);
});

it("a failed install localizes the error and keeps the previous status", async () => {
  await store.load();
  vi.mocked(api.mcpInstallClient).mockRejectedValue("mcp_config_failed");
  await store.install("claude-code");
  // Real dictionary, so this also pins the locale key existing.
  expect(store.error).toBe("Versorium could not write that client's config file.");
  expect(store.clients[0].installed).toBe(false);
  expect(store.loading).toBe(false);
});

it("uninstall adopts the returned status and clears a stale error", async () => {
  await store.load();
  vi.mocked(api.mcpInstallClient).mockRejectedValue("mcp_config_failed");
  await store.install("claude-code");
  vi.mocked(api.mcpUninstallClient).mockResolvedValue(status({ clients: [client({ installed: false })] }));
  await store.uninstall("claude-code");
  expect(store.error).toBeNull();
  expect(store.clients[0].installed).toBe(false);
});
