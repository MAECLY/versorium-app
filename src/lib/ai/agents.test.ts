import { beforeEach, expect, it, vi } from "vitest";
import { api } from "$lib/tauri";
import { detectAgents, resetAgentCache } from "./agents";

vi.mock("$lib/tauri", () => ({ api: { agentsDetect: vi.fn() }, isTauri: () => true }));

const claude = { id: "claude", name: "Claude Code", path: "/bin/claude", version: "1", state: "connected" as const, models: null };

beforeEach(() => {
  resetAgentCache();
  vi.mocked(api.agentsDetect).mockReset().mockResolvedValue([claude]);
});

it("scans once per session and shares the in-flight scan", async () => {
  const [a, b] = await Promise.all([detectAgents(), detectAgents()]);
  expect(a).toEqual([claude]);
  expect(b).toBe(a);
  await detectAgents();
  expect(api.agentsDetect).toHaveBeenCalledTimes(1);
});

it("re-check forces a fresh scan and replaces the cache", async () => {
  await detectAgents();
  vi.mocked(api.agentsDetect).mockResolvedValue([{ ...claude, state: "missing", path: null }]);
  const fresh = await detectAgents(true);
  expect(fresh[0].state).toBe("missing");
  expect(await detectAgents()).toBe(fresh);
  expect(api.agentsDetect).toHaveBeenCalledTimes(2);
});

it("a failed scan is not cached", async () => {
  vi.mocked(api.agentsDetect).mockRejectedValueOnce("network");
  await expect(detectAgents()).rejects.toBe("network");
  await detectAgents();
  expect(api.agentsDetect).toHaveBeenCalledTimes(2);
});
