import { afterEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";

// The confirm dialog grew a second kind (Settings redesign SPEC §6.5): beside
// a deletion, which fills its button with --warn, a grant, which is an alert
// read with its first paragraph and starts on the safe answer.

// jsdom has no dialog implementation; Modal calls showModal on mount.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

type Props = ComponentProps<typeof ConfirmDialog>;

function render(props: Partial<Props> = {}) {
  target = document.createElement("div");
  document.body.append(target);
  const all = {
    title: "Let Codex change your manuscript?",
    body: ["Write lets the AI change your manuscript.", "Before each change, a snapshot.", "Look in History."],
    confirmLabel: "Let Codex write",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...props,
  } as Props;
  app = mount(ConfirmDialog, { target, props: all });
  flushSync();
  const dialog = target.querySelector("dialog")!;
  const [cancel, confirm] = [...dialog.querySelectorAll("button")];
  return { dialog, cancel, confirm, props: all };
}

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
});

it("a body of paragraphs is one paragraph each, and the first one describes the dialog", () => {
  const { dialog } = render();
  const paragraphs = [...dialog.querySelectorAll("p")];
  expect(paragraphs.map((p) => p.textContent?.trim())).toEqual([
    "Write lets the AI change your manuscript.",
    "Before each change, a snapshot.",
    "Look in History.",
  ]);
  const described = dialog.getAttribute("aria-describedby");
  expect(described).toBeTruthy();
  expect(document.getElementById(described!)).toBe(paragraphs[0]);
});

it("a single string is still one paragraph, as every earlier caller passes it", () => {
  const { dialog } = render({ body: "It stays in this novel's history." });
  expect([...dialog.querySelectorAll("p")].map((p) => p.textContent?.trim())).toEqual([
    "It stays in this novel's history.",
  ]);
});

it("the safe answer says what it keeps, and is where focus starts", () => {
  const named = render({ cancelLabel: "Keep read only" });
  expect(named.cancel.textContent?.trim()).toBe("Keep read only");
  expect(named.cancel.hasAttribute("autofocus")).toBe(true);
});

it("without a label of its own the safe answer is Cancel", () => {
  const { cancel } = render();
  expect(cancel.textContent?.trim()).toBe("Cancel");
});

it("a deletion fills its button with the warning colour; a grant is a plain button", () => {
  const deletion = render();
  expect(deletion.confirm.getAttribute("style")).toContain("background: var(--warn)");
  void unmount(app!);
  target.remove();

  const grant = render({ tone: "neutral" });
  expect(grant.confirm.getAttribute("style") ?? "").not.toContain("--warn");
  expect(grant.confirm.className).toBe("v-btn");
});

it("an alert is an alertdialog; otherwise the element's own dialog role stands", () => {
  const alert = render({ alert: true });
  expect(alert.dialog.getAttribute("role")).toBe("alertdialog");
  void unmount(app!);
  target.remove();

  const plain = render();
  expect(plain.dialog.hasAttribute("role")).toBe(false);
});

it("Cancel and Escape cancel, and the confirm confirms once", async () => {
  const { dialog, cancel, confirm, props } = render();
  cancel.click();
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  // Escape closes a modal <dialog>, which fires `close`.
  dialog.dispatchEvent(new Event("close"));
  expect(props.onCancel).toHaveBeenCalledTimes(2);
  confirm.click();
  await vi.waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1));
});
