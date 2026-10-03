import { api, isTauri } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";
import { EDITOR_DEFAULTS, normalizePreferences, type EditorPreferences } from "./preferences";

/**
 * Settings → Editor and the editor itself read the same preferences.
 *
 * What Rust hands back is what is shown, the rule Checkbox follows: a change
 * reaches the page once `set_settings` returns it, so a value the backend did
 * not keep never looks applied.
 */
export class EditorPreferencesStore {
  current = $state<EditorPreferences>({ ...EDITOR_DEFAULTS });
  error = $state<string | null>(null);

  /** Take the editor block from settings that were already read. */
  adopt(raw: unknown): void {
    this.current = normalizePreferences(raw);
  }

  async load(): Promise<void> {
    if (!isTauri()) return;
    try {
      this.adopt((await api.getSettings()).editor);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async set<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]): Promise<void> {
    this.error = null;
    if (!isTauri()) {
      // A browser with no backend has nothing to persist to; the page still
      // follows the control so the panel can be judged in `make web`.
      this.current = { ...this.current, [key]: value };
      return;
    }
    try {
      const saved = await api.setSettings({ editor: { [key]: value } });
      this.adopt(saved.editor);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }
}

export const editorPreferences = new EditorPreferencesStore();
