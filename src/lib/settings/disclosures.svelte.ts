/**
 * Which disclosures and expander rows in Settings are open, keyed
 * `"{page}:{id}"`, for the session only. Leaving a page and coming back finds
 * them as they were; nothing is persisted, so a relaunch starts folded.
 */
const open = $state<Record<string, boolean>>({});

export const disclosures = {
  isOpen(key: string, fallback = false): boolean {
    return open[key] ?? fallback;
  },
  set(key: string, value: boolean): void {
    open[key] = value;
  },
};
