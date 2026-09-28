import { expect, it, vi } from "vitest";
import { mount, flushSync, unmount } from "svelte";
import UpdateDialog from "$lib/components/UpdateDialog.svelte";
import { updates } from "$lib/update/state.svelte";

// jsdom has no dialog implementation; the component calls showModal on mount.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

vi.mock("$lib/tauri", async (orig) => {
  const actual = await orig<typeof import("$lib/tauri")>();
  return { ...actual, isTauri: () => true, api: { updateSkip: vi.fn() } };
});

function open() {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(UpdateDialog, { target, props: { onClose: () => {} } });
  flushSync();
  return { target, app };
}

it("offers exactly install, later and skip, and says what is verified", async () => {
  updates.status = {
    currentVersion: "0.1.0",
    available: { version: "0.2.0", notes: "Corkboard.", date: "2026-09-27" },
    channel: "stable",
    automatic: true,
    signedIn: true,
    checking: false,
    lastError: null,
  };
  const { target, app } = open();
  const text = target.textContent ?? "";

  expect(text).toContain("Version 0.2.0 is ready");
  expect(text).toContain("You have 0.1.0.");
  expect(text).toContain("Corkboard.");
  // The promise that earns trust in a passive install.
  expect(text).toContain("checks the signature and the checksum before replacing");

  const labels = [...target.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(labels).toEqual(["Skip this version", "Later", "Download & Install"]);

  await unmount(app);
  target.remove();
});

it("renders release notes as text, never as markup", async () => {
  updates.status = {
    currentVersion: "0.1.0",
    available: { version: "0.2.0", notes: "<img src=x onerror=alert(1)>", date: null },
    channel: "stable",
    automatic: true,
    signedIn: true,
    checking: false,
    lastError: null,
  };
  const { target, app } = open();

  // A release body is remote content; it must not become an element.
  expect(target.querySelector("img")).toBeNull();
  expect(target.textContent).toContain("<img src=x onerror=alert(1)>");

  await unmount(app);
  target.remove();
  updates.status = null;
});
