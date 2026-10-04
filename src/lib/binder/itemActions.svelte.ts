import { tick } from "svelte";
import { t } from "$lib/i18n";
import { store } from "$lib/binder/store.svelte";
import { restoreFocus } from "$lib/components/restoreFocus";
import type { ChapterMeta, ChapterStatus, Project } from "$lib/tauri";

/**
 * What a novel or a chapter can have done to it, for every route to its menu:
 * the binder's ⋯, a right-click on the row or on the corkboard card, and
 * Shift+F10 or the Menu key on either. One builder and one handler, so the
 * routes cannot drift apart.
 */

export interface ItemAction {
  id: string;
  label: string;
  /** Renders in the warning colour and sits after a separator. */
  destructive?: boolean;
}

/** The list an action was chosen in: focus stays in it when the item goes away. */
export type ItemSurface = "list" | "board";

/**
 * How rows and cards name themselves in data-item-key, which is what focus is
 * found by again after a move or a removal re-renders the list.
 */
export const projectKey = (path: string): string => `project:${path}`;
export const chapterKey = (file: string): string => `chapter:${file}`;

const STATUSES: ChapterStatus[] = ["draft", "revised", "final"];

export function projectActions(): ItemAction[] {
  return [
    { id: "rename", label: t("binder.menu.renameProject") },
    { id: "settings", label: t("binder.menu.projectSettings") },
    { id: "delete", label: t("binder.menu.deleteProject"), destructive: true },
  ];
}

/**
 * The same items, in the same words, for a chapter's binder row and its
 * corkboard card: the binder stays visible beside the board, so one chapter
 * must not offer two vocabularies a few centimetres apart. "Earlier" and
 * "later", because on a grid of cards "up" reads as "one row up".
 *
 * Only the statuses it is not already, so the menu never offers a no-op. The
 * moves are omitted at the ends rather than disabled: an item that cannot do
 * anything is a thing to read and then work out why (pinned by
 * binder-crud.spec.ts). On the first chapter that shifts every item after
 * Rename up one place, deliberately: the status items already differ from
 * chapter to chapter, so no slot was positionally stable to begin with, and
 * Delete always sits last behind its separator.
 */
export function chapterActions(chapter: ChapterMeta): ItemAction[] {
  const chapters = store.project?.chapters ?? [];
  const at = chapters.findIndex((c) => c.file === chapter.file);
  return [
    { id: "rename", label: t("binder.menu.renameChapter") },
    ...(at > 0 ? [{ id: "up", label: t("binder.menu.moveEarlier") }] : []),
    ...(at >= 0 && at < chapters.length - 1 ? [{ id: "down", label: t("binder.menu.moveLater") }] : []),
    ...STATUSES.filter((s) => s !== chapter.status).map((s) => ({
      id: `status:${s}`,
      label: t("binder.menu.markAs", { status: t(`binder.status.${s}`) }),
    })),
    { id: "delete", label: t("binder.menu.deleteChapter"), destructive: true },
  ];
}

interface Target {
  kind: "project" | "chapter";
  id: string;
  title: string;
}

/** A pending removal remembers its neighbours, because the item itself will be gone. */
interface Removal extends Target {
  surface: ItemSurface;
  next: string | null;
  prev: string | null;
}

/**
 * The dialogs a menu choice is waiting on. ItemActionDialogs renders them once,
 * from App, so the corkboard's menu does not depend on the sidebar being
 * mounted.
 */
export const pending = $state<{
  renaming: Target | null;
  confirming: Removal | null;
  settingsFor: string | null;
}>({ renaming: null, confirming: null, settingsFor: null });

export function runProjectAction(project: Project, id: string): void {
  const target: Target = { kind: "project", id: project.path, title: project.meta.title };
  if (id === "rename") pending.renaming = target;
  else if (id === "settings") pending.settingsFor = project.path;
  else if (id === "delete") pending.confirming = { ...target, ...neighbours("list", projectKey(project.path)) };
}

export function runChapterAction(chapter: ChapterMeta, id: string, origin: ItemSurface): void {
  const target: Target = { kind: "chapter", id: chapter.file, title: chapter.title };
  if (id === "rename") pending.renaming = target;
  else if (id === "up" || id === "down") void move(chapter.file, id === "up" ? -1 : 1);
  else if (id === "delete") pending.confirming = { ...target, ...neighbours(origin, chapterKey(chapter.file)) };
  else if (id.startsWith("status:")) {
    void store.updateChapter(chapter.file, undefined, id.slice(7) as ChapterStatus);
  }
}

export async function doRename(title: string): Promise<void> {
  const target = pending.renaming;
  if (!target) return;
  if (target.kind === "project") await store.renameProject(target.id, title);
  else await store.updateChapter(target.id, title);
}

export async function doDelete(): Promise<void> {
  const target = pending.confirming;
  pending.confirming = null;
  if (!target) return;
  if (target.kind === "project") await store.deleteProject(target.id);
  else await store.deleteChapter(target.id);
  await tick();
  if (!focusLost()) return;
  for (const key of [target.next, target.prev]) {
    if (restoreFocus(findItem(target.surface, key))) return;
  }
  // The list is empty: the way to make the next one, then the home screen's
  // first action, then the rail. A folded panel's + is inert and refuses
  // focus, which is what moves the chain on to the next.
  for (const fallback of ["[data-item-fallback]", "main .v-btn-primary", ".v-edge-rail"]) {
    if (restoreFocus(document.querySelector(fallback))) return;
  }
}

/**
 * Svelte's keyed each moves a row's node with Node.before, and moving the node
 * that holds focus blurs it. Without this, Shift+F10 → Move later leaves the
 * writer on <body>, with nothing focused to press Shift+F10 on again.
 */
async function move(file: string, delta: -1 | 1): Promise<void> {
  const had = document.activeElement;
  await store.moveChapter(file, delta);
  await tick();
  if (!focusLost() || !(had instanceof HTMLElement) || had === document.body) return;
  if (restoreFocus(had)) had.scrollIntoView({ block: "nearest" });
}

/** Nothing holds focus: whatever had it was removed, or moved under it. */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** Both binder lists are "list"; a key only ever appears in one of them. */
function surfaces(surface: ItemSurface): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-item-surface="${surface}"]`)];
}

function itemsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>("[data-item-key]")];
}

function findItem(surface: ItemSurface, key: string | null): HTMLElement | null {
  if (!key) return null;
  for (const list of surfaces(surface)) {
    const found = itemsOf(list).find((el) => el.dataset.itemKey === key);
    if (found) return found;
  }
  return null;
}

function neighbours(surface: ItemSurface, key: string): Pick<Removal, "surface" | "next" | "prev"> {
  for (const list of surfaces(surface)) {
    const items = itemsOf(list);
    const at = items.findIndex((el) => el.dataset.itemKey === key);
    if (at < 0) continue;
    return {
      surface,
      next: items[at + 1]?.dataset.itemKey ?? null,
      prev: items[at - 1]?.dataset.itemKey ?? null,
    };
  }
  return { surface, next: null, prev: null };
}
