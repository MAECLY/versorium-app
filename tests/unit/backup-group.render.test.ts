import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import BackupGroup from "$lib/settings/groups/BackupGroup.svelte";
import { api } from "$lib/tauri";
import { store } from "$lib/binder/store.svelte";

// Settings → History & backup, rendered in jsdom against a scripted backend:
// what Back up now does before it asks Rust for anything.

const order: string[] = [];

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => true,
  onBackupState: vi.fn(async () => () => undefined),
  api: {
    backupDestinations: vi.fn(async () => [
      { kind: "icloud", path: "/icloud", available: true, volume: "1", offsite: true },
    ]),
    secretsStatus: vi.fn(async () => ({ store: { usable: true, reason: null }, updates: false, novel: false })),
    getSettings: vi.fn(async () => ({ backupDirs: ["/icloud"], backupKeep: 10 })),
    backupList: vi.fn(async () => []),
    backupCoverage: vi.fn(async () => ({ copies: 2, media: 1, offsite: true, onTheNovelsDisk: [] })),
    backupState: vi.fn(async () => ({ running: null, seq: 0 })),
    backupNow: vi.fn(async () => {
      order.push("backupNow");
      return [];
    }),
  },
}));

vi.mock("$lib/binder/store.svelte", () => ({
  store: {
    project: { path: "/novels/el-faro", chapters: [], meta: {} },
    projects: [],
    flushAll: vi.fn(),
    codeMessagePublic: (e: unknown) => `could not save: ${String(e)}`,
  },
}));

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
});

async function pressBackUpNow(): Promise<void> {
  app = mount(BackupGroup, { target });
  flushSync();
  const button = await vi.waitFor(() => {
    const found = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Back up now");
    if (!found) throw new Error("Back up now is not on the page yet");
    return found;
  });
  button.click();
}

it("saves what is on the page, then backs up", async () => {
  vi.mocked(store.flushAll).mockImplementation(async () => {
    order.push("flushAll");
  });
  await pressBackUpNow();
  await vi.waitFor(() => expect(order).toEqual(["flushAll", "backupNow"]));
});

it("a save that fails stops the backup and says, beside the button, that nothing was backed up", async () => {
  // Backing up the older text while the newer one failed to save would put
  // in the archive something the writer is not looking at.
  vi.mocked(store.flushAll).mockRejectedValue("io");
  await pressBackUpNow();
  const alert = await vi.waitFor(() => {
    const found = target.querySelector('[role="alert"]');
    if (!found) throw new Error("no alert yet");
    return found;
  });
  expect(alert.textContent?.trim()).toBe("Not backed up: the chapter could not be saved first. could not save: io");
  // Right under the button, not at the foot of the section.
  const button = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Back up now");
  expect(alert.previousElementSibling?.contains(button ?? null)).toBe(true);
  expect(api.backupNow).not.toHaveBeenCalled();
});
