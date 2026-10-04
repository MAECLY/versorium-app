import { getContext, setContext } from "svelte";
import type { SettingsTarget } from "$lib/settings/pages";

/**
 * How a page in Settings sends the writer somewhere else: another page
 * ("Choose one for Rewrite in Tasks ›", "Change access ›") or the Manuscript
 * dialog ("Run it from Manuscript › Continuity"). SettingsPage provides it.
 */
export interface SettingsNav {
  navigate(target: SettingsTarget): void;
  openManuscript(tab: "continuity"): void;
}

const KEY = Symbol("settings-nav");

/** Pages rendered on their own (unit tests) get links that go nowhere. */
const NOWHERE: SettingsNav = { navigate: () => undefined, openManuscript: () => undefined };

export function provideSettingsNav(nav: SettingsNav): void {
  setContext(KEY, nav);
}

export function useSettingsNav(): SettingsNav {
  return getContext<SettingsNav | undefined>(KEY) ?? NOWHERE;
}
