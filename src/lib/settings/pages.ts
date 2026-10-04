import type { McpClientId } from "$lib/tauri";

/**
 * Settings' pages: four labelled categories and a footer, two levels and no
 * more (Settings redesign SPEC §2). Categories run from the page you write on,
 * to the book, to what Versorium uses, to what uses the book; pages inside a
 * category by how often a writer touches them. New features become rows on a
 * page (Tasks), never new rail items. The footer is about Versorium itself,
 * outside the categories: Application, and About, which the owner asked for
 * on 2026-10-04 after the spec fixed the rail at ten; it is eleven since.
 */
export const CATEGORIES = [
  { id: "writing", pages: ["editor", "appearance"] },
  { id: "novel", pages: ["author", "backup"] },
  { id: "ai", pages: ["tasks", "models", "assistants"] },
  { id: "otherApps", pages: ["access", "activity"] },
] as const;

export const FOOTER = ["app", "about"] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type PageId = (typeof CATEGORIES)[number]["pages"][number] | (typeof FOOTER)[number];

/** Every page, in rail order. */
export const PAGES: readonly PageId[] = [...CATEGORIES.flatMap((c) => c.pages), ...FOOTER];

/** A place in Settings: a page, and what on it should take focus or be shown. */
export type SettingsTarget =
  | { page: "tasks"; focus?: "rewrite" | "continuity" }
  | { page: "models"; focus?: "start" | "ollama" | "server" }
  | { page: "app"; focus?: "updates" }
  | { page: "access"; client?: McpClientId }
  | { page: "activity"; client?: string }
  | { page: Exclude<PageId, "tasks" | "models" | "app" | "access" | "activity"> };

/**
 * The control a target lands on, as pages mark it (`data-settings-focus`).
 * Null: the page's title takes focus. Activity's `client` only presets its
 * filter, so the title is where focus goes there.
 */
export function focusKey(target: SettingsTarget): string | null {
  if ((target.page === "tasks" || target.page === "models" || target.page === "app") && "focus" in target && target.focus) {
    return `${target.page}:${target.focus}`;
  }
  if (target.page === "access" && "client" in target && target.client) return `access:${target.client}`;
  return null;
}
