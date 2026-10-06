import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { MAX_TRANSIENT, NoticeStore, TRANSIENT_MS } from "$lib/notices/state.svelte";

// The notification store (src/lib/notices/state.svelte.ts) on a fake clock:
// what hides, when, what waits for the writer, what is one notice and what is
// two, and what a screen reader is told.

let notices: NoticeStore;

beforeEach(() => {
  vi.useFakeTimers();
  notices = new NoticeStore();
});

afterEach(() => {
  vi.useRealTimers();
});

const texts = () => notices.shown.map((n) => n.text);
const ids = () => notices.items.map((n) => n.id);

describe("a transient notice", () => {
  it("is there at 4999 ms and gone at 5000", () => {
    notices.inform("Saved.");
    vi.advanceTimersByTime(TRANSIENT_MS - 1);
    expect(texts()).toEqual(["Saved."]);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it("waits while the pointer is on it, then hides after the time it had left", () => {
    notices.inform("Saved.");
    vi.advanceTimersByTime(3000);
    notices.hold("inform:Saved.", "pointer");
    vi.advanceTimersByTime(60_000);
    expect(texts(), "held for a minute").toEqual(["Saved."]);

    notices.release("inform:Saved.", "pointer");
    vi.advanceTimersByTime(1999);
    expect(texts(), "2 s were left when the pointer arrived").toEqual(["Saved."]);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it("stays while keyboard focus is still on it after the pointer leaves", () => {
    notices.inform("Saved.");
    notices.hold("inform:Saved.", "pointer");
    notices.hold("inform:Saved.", "focus");
    notices.release("inform:Saved.", "pointer");
    vi.advanceTimersByTime(60_000);
    expect(texts()).toEqual(["Saved."]);

    notices.release("inform:Saved.", "focus");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual([]);
  });

  it("asked for again is one notice, with its full time again, and is heard again", async () => {
    notices.inform("Select a passage first.");
    await tick();
    expect(notices.polite).toBe("Select a passage first.");

    vi.advanceTimersByTime(4000);
    notices.inform("Select a passage first.");
    expect(ids()).toEqual(["inform:Select a passage first."]);
    // Cleared, then written again: a live region whose words do not change
    // says nothing.
    expect(notices.polite).toBe("");
    await tick();
    expect(notices.polite).toBe("Select a passage first.");

    vi.advanceTimersByTime(TRANSIENT_MS - 1);
    expect(texts()).toEqual(["Select a passage first."]);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it("shown again under its id in the same words is a refresh and not read again; new words are read", async () => {
    // The backup adapter calls show() for every notice it sees change (SPEC §6.3).
    const shrunk = (text: string) => ({ id: "backup:shrunk:novel:icloud", tier: "transient" as const, text });
    notices.show(shrunk("iCloud Drive: older backups kept, this one is smaller."));
    await tick();
    expect(notices.polite).toBe("iCloud Drive: older backups kept, this one is smaller.");

    notices.show(shrunk("iCloud Drive: older backups kept, this one is smaller."));
    expect(notices.polite, "not cleared to be read again").toBe("iCloud Drive: older backups kept, this one is smaller.");
    await tick();
    expect(notices.polite).toBe("iCloud Drive: older backups kept, this one is smaller.");

    notices.show(shrunk("iCloud Drive: older backups kept, this one is half the size."));
    expect(notices.polite).toBe("");
    await tick();
    expect(notices.polite).toBe("iCloud Drive: older backups kept, this one is half the size.");
  });

  it("closed while the pointer was on it does not keep the next one under its id up", () => {
    // The pointer that held it never leaves: the element went from under it.
    notices.inform("Select a passage first.");
    notices.hold("inform:Select a passage first.", "pointer");
    notices.close("inform:Select a passage first.");
    notices.inform("Select a passage first.");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual([]);
  });

  it("asked for again while held starts its full time once it is let go", () => {
    notices.inform("Saved.");
    vi.advanceTimersByTime(4000);
    notices.hold("inform:Saved.", "pointer");
    notices.inform("Saved.");
    notices.release("inform:Saved.", "pointer");
    vi.advanceTimersByTime(TRANSIENT_MS - 1);
    expect(texts()).toEqual(["Saved."]);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual([]);
  });

  it("past three at once, the oldest goes; never one being read, never the newest", () => {
    notices.fail("The chapter could not be saved.", "binder.save");
    for (const text of ["One.", "Two.", "Three."]) notices.inform(text);
    expect(texts()).toEqual(["The chapter could not be saved.", "One.", "Two.", "Three."]);

    notices.inform("Four.");
    expect(texts(), "a persistent notice is never dropped").toEqual([
      "The chapter could not be saved.",
      "Two.",
      "Three.",
      "Four.",
    ]);
    expect(notices.items.filter((n) => n.tier === "transient")).toHaveLength(MAX_TRANSIENT);

    notices.hold("inform:Two.", "pointer");
    notices.inform("Five.");
    expect(texts(), "the one under the pointer stays; the next oldest goes").toEqual([
      "The chapter could not be saved.",
      "Two.",
      "Four.",
      "Five.",
    ]);

    notices.hold("inform:Four.", "focus");
    notices.hold("inform:Five.", "pointer");
    notices.inform("Six.");
    expect(texts(), "nothing left to drop: the stack runs over rather than lose the newest").toContain("Six.");
  });
});

describe("a persistent notice", () => {
  it("is still there an hour later", () => {
    notices.fail("The chapter could not be saved.");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(texts()).toEqual(["The chapter could not be saved."]);
  });

  it("raised again is one notice, announced once", async () => {
    notices.fail("File system error.", "git.checkpoint");
    await tick();
    expect(notices.assertive).toBe("File system error.");

    notices.fail("File system error.", "git.checkpoint");
    // Not cleared: the region keeps its words, so nothing is read again.
    expect(notices.assertive).toBe("File system error.");
    await tick();
    expect(notices.assertive).toBe("File system error.");
    expect(ids()).toEqual(["git.checkpoint"]);
  });

  it("replaced by id keeps its place, takes the new words, and is not read again", async () => {
    notices.fail("Could not save.", "binder.save");
    await tick();
    notices.fail("Not found.", "binder.list");
    await tick();
    expect(notices.assertive).toBe("Not found.");

    notices.fail("Could not save. The disk is full.", "binder.save");
    expect(ids()).toEqual(["binder.save", "binder.list"]);
    expect(texts()).toEqual(["Could not save. The disk is full.", "Not found."]);
    await tick();
    expect(notices.assertive, "an update in place is not news").toBe("Not found.");
  });

  it("that takes the id of a transient one is not taken down by the transient's timer", () => {
    // Author's "Saved." then a save that fails within five seconds.
    notices.inform("Saved.", "settings.author");
    vi.advanceTimersByTime(3000);
    notices.fail("File system error.", "settings.author");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(texts()).toEqual(["File system error."]);
  });

  it("whose words change in place takes its old words out of the screen-reader copy, and reads nothing", async () => {
    notices.fail("File system error.", "git.checkpoint");
    await tick();
    expect(notices.assertive).toBe("File system error.");

    notices.fail("The repository is locked.", "git.checkpoint");
    await tick();
    expect(notices.assertive, "the old words are no longer true, and the new ones are not news").toBe("");

    notices.dismiss("git.checkpoint");
    expect(notices.items).toEqual([]);
    expect(notices.assertive).toBe("");
  });

  it("with an action keeps a box of its own, even in words another box already says", () => {
    const open = { label: "Open backup settings", run: vi.fn() };
    notices.show({ id: "backup:failed:novel:icloud", tier: "persistent", text: "Not backed up.", action: open });
    notices.show({ id: "backup:failed:novel:disk", tier: "persistent", text: "Not backed up.", action: open });
    notices.fail("Not backed up.", "binder.save");
    notices.fail("Not backed up.", "editor.ops");
    expect(notices.shown.map((n) => n.ids)).toEqual([
      ["backup:failed:novel:icloud"],
      ["backup:failed:novel:disk"],
      ["binder.save", "editor.ops"],
    ]);
    expect(notices.shown.map((n) => n.action?.label)).toEqual(["Open backup settings", "Open backup settings", undefined]);
  });

  it("replaced by a transient one under the same id keeps its place and starts its timer", async () => {
    notices.fail("Could not save.", "settings.author");
    notices.fail("Not found.", "binder.list");
    notices.inform("Saved.", "settings.author");
    expect(texts()).toEqual(["Saved.", "Not found."]);
    await tick();
    expect(notices.polite).toBe("Saved.");

    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual(["Not found."]);
  });

  it("closed by the writer tells its owner; dismissed by the code does not", () => {
    const writerClosed = vi.fn();
    notices.show({ id: "backup:failed:a", tier: "persistent", text: "Not backed up.", onDismiss: writerClosed });
    notices.dismiss("backup:failed:a");
    expect(texts()).toEqual([]);
    expect(writerClosed).not.toHaveBeenCalled();

    notices.show({ id: "backup:failed:a", tier: "persistent", text: "Not backed up.", onDismiss: writerClosed });
    notices.close("backup:failed:a");
    expect(texts()).toEqual([]);
    expect(writerClosed).toHaveBeenCalledTimes(1);
  });

  it("with the same words as another is drawn once, and goes when the last of them clears", async () => {
    notices.fail("File system error.", "binder.save");
    notices.fail("File system error.", "editor.ops");
    await tick();
    expect(notices.assertive).toBe("File system error.");
    notices.fail("File system error.", "git.checkpoint");
    expect(notices.assertive, "words already on screen are not news: not cleared to be read again").toBe(
      "File system error.",
    );
    expect(notices.shown).toHaveLength(1);
    expect(notices.shown[0].ids).toEqual(["binder.save", "editor.ops", "git.checkpoint"]);

    notices.dismiss("binder.save");
    notices.dismiss("git.checkpoint");
    expect(texts(), "the change log still fails").toEqual(["File system error."]);
    expect(notices.assertive, "and still says so to a screen reader").toBe("File system error.");
    notices.dismiss("editor.ops");
    expect(texts()).toEqual([]);
    expect(notices.assertive).toBe("");
  });

  it("takes its screen-reader copy with it when it goes", async () => {
    notices.fail("The chapter could not be saved.", "binder.save");
    await tick();
    expect(notices.assertive).toBe("The chapter could not be saved.");
    notices.close("binder.save");
    expect(notices.assertive).toBe("");

    notices.inform("Saved.");
    await tick();
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(notices.polite).toBe("");
  });
});

describe("announcements", () => {
  it("raised in the same moment are read together, not the last one alone", async () => {
    notices.inform("Select a passage first.");
    notices.inform("Nothing to restore here.");
    await tick();
    expect(notices.polite).toBe("Select a passage first. Nothing to restore here.");
  });

  it("read together stay while either notice is up, and go with the last of them", async () => {
    notices.inform("Select a passage first.");
    notices.inform("Nothing to restore here.");
    await tick();
    notices.hold("inform:Nothing to restore here.", "pointer");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual(["Nothing to restore here."]);
    expect(notices.polite, "emptied, not rewritten: rewritten, the rest is read again").toBe(
      "Select a passage first. Nothing to restore here.",
    );

    notices.release("inform:Nothing to restore here.", "pointer");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual([]);
    expect(notices.polite).toBe("");
  });

  it("whose notice went before they could be read are not read", async () => {
    notices.inform("Saved.");
    notices.dismiss("inform:Saved.");
    await tick();
    expect(notices.polite).toBe("");
  });

  it("persistent ones are assertive, transient ones polite", async () => {
    notices.fail("File system error.");
    notices.inform("Saved.");
    await tick();
    expect(notices.assertive).toBe("File system error.");
    expect(notices.polite).toBe("Saved.");
  });

  it("an informed and a failed message with the same words are two notices", () => {
    notices.inform("Not found.");
    notices.fail("Not found.");
    expect(ids()).toEqual(["inform:Not found.", "fail:Not found."]);
    // Two boxes: a hint drawn into an error's box would lose its timer to the error's ✕.
    expect(notices.shown.map((n) => n.tier)).toEqual(["transient", "persistent"]);
  });
});

describe("holding", () => {
  it("does nothing for a notice that is not there yet, and a release without a hold changes nothing", () => {
    notices.hold("inform:Saved.", "pointer");
    notices.inform("Saved.");
    notices.release("inform:Saved.", "focus");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual([]);
  });

  it("a persistent notice under the pointer that turns transient waits for the pointer to leave", () => {
    notices.fail("Could not save.", "settings.author");
    notices.hold("settings.author", "pointer");
    notices.inform("Saved.", "settings.author");
    vi.advanceTimersByTime(60_000);
    expect(texts()).toEqual(["Saved."]);
    notices.release("settings.author", "pointer");
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(texts()).toEqual([]);
  });
});
