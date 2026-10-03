import { beforeEach, expect, it, vi } from "vitest";
import { api, type UpdateStatus } from "$lib/tauri";
import { UpdateStore } from "./state.svelte";
import { errorMessage } from "$lib/i18n/errors";

vi.mock("$lib/tauri", () => ({
  api: {
    updateStatus: vi.fn(),
    updateCheck: vi.fn(),
    updateInstall: vi.fn(),
    updateSkip: vi.fn(),
    updateSetChannel: vi.fn(),
    updateSetAutomatic: vi.fn(),
  },
  isTauri: () => true,
}));

const base: UpdateStatus = {
  currentVersion: "0.1.0",
  available: null,
  channel: "stable",
  automatic: true,
  tokenSet: false,
  checking: false,
  checked: true,
  lastError: null,
  resetsAt: null,
};
const offered: UpdateStatus = {
  ...base,
  available: { version: "0.2.0", notes: "Corkboard, focus mode.", date: "2026-09-27" },
};

let updates: UpdateStore;
beforeEach(() => {
  vi.clearAllMocks();
  updates = new UpdateStore();
});

it("loads the current state without checking the network", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue(base);

  await updates.load();

  expect(api.updateStatus).toHaveBeenCalledOnce();
  expect(api.updateCheck).not.toHaveBeenCalled();
  expect(updates.status).toEqual(base);
  expect(updates.busy).toBe(false);
});

it("a check that finds nothing leaves no update on offer", async () => {
  vi.mocked(api.updateCheck).mockResolvedValue(base);

  await updates.check();

  expect(updates.available).toBeNull();
  expect(updates.error).toBeNull();
});

it("a failed check localizes the code and keeps the status it had", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue(offered);
  await updates.load();

  vi.mocked(api.updateCheck).mockRejectedValue("network");
  await updates.check();

  // Spec §11.7: a network problem must not blank the panel.
  expect(updates.status).toEqual(offered);
  expect(updates.error).toBe(errorMessage("network"));
  expect(updates.busy).toBe(false);
});

it("skipping a version takes it off the offer", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue(offered);
  await updates.load();

  vi.mocked(api.updateSkip).mockResolvedValue(base);
  await updates.skip();

  expect(api.updateSkip).toHaveBeenCalledWith("0.2.0");
  expect(updates.available).toBeNull();
});

it("there is nothing to skip when nothing is offered", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue(base);
  await updates.load();

  await updates.skip();

  expect(api.updateSkip).not.toHaveBeenCalled();
});

it("switching channel adopts whatever Rust returns", async () => {
  const beta: UpdateStatus = { ...base, channel: "beta" };
  vi.mocked(api.updateSetChannel).mockResolvedValue(beta);

  await updates.setChannel("beta");

  expect(api.updateSetChannel).toHaveBeenCalledWith("beta");
  expect(updates.status?.channel).toBe("beta");
});

it("turning automatic off adopts the returned status", async () => {
  vi.mocked(api.updateSetAutomatic).mockResolvedValue({ ...base, automatic: false });

  await updates.setAutomatic(false);

  expect(api.updateSetAutomatic).toHaveBeenCalledWith(false);
  expect(updates.status?.automatic).toBe(false);
});

it("the startup check runs without a token, once", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue({ ...base, tokenSet: false, checked: false });
  vi.mocked(api.updateCheck).mockResolvedValue(base);

  await updates.checkOnStartup();

  // Spec §11 as amended on 2026-10-03: no token means an anonymous check,
  // not no check. Still exactly one, never a loop.
  expect(api.updateCheck).toHaveBeenCalledOnce();
});

it("the startup check runs the same way with a token", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue({ ...base, tokenSet: true, checked: false });
  vi.mocked(api.updateCheck).mockResolvedValue({ ...base, tokenSet: true });

  await updates.checkOnStartup();

  expect(api.updateCheck).toHaveBeenCalledOnce();
});

it("the startup check stays quiet when automatic updates are off", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue({ ...base, automatic: false });

  await updates.checkOnStartup();

  expect(api.updateCheck).not.toHaveBeenCalled();
});

it("a startup check that finds the limit reached greets nobody with an error", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue({ ...base, checked: false });
  // A refusal is a status, not a rejection: the panel shows it when opened.
  vi.mocked(api.updateCheck).mockResolvedValue({
    ...base,
    lastError: "update_rate_limited",
    resetsAt: 1_791_054_785,
  });

  await updates.checkOnStartup();

  expect(updates.error).toBeNull();
  expect(updates.status?.lastError).toBe("update_rate_limited");
});

it("a startup check that fails greets nobody with an error", async () => {
  vi.mocked(api.updateStatus).mockResolvedValue(base);
  vi.mocked(api.updateCheck).mockRejectedValue("network");

  await updates.checkOnStartup();

  expect(api.updateCheck).toHaveBeenCalledOnce();
  expect(updates.error).toBeNull();
});

it("a failed install surfaces the reason and lets the writer try again", async () => {
  vi.mocked(api.updateInstall).mockRejectedValue("sha_mismatch");

  await updates.install();

  expect(updates.error).toBe(errorMessage("sha_mismatch"));
  expect(updates.busy).toBe(false);
});
