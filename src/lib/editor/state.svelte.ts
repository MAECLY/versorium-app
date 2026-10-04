import { api, isTauri, type EditorFont } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";
import { EDITOR_DEFAULTS, normalizePreferences, type EditorPreferences } from "./preferences";

/**
 * Settings → Editor and the editor itself read the same preferences.
 *
 * What Rust hands back is what is shown, the rule Checkbox follows: a change
 * reaches the page once `set_settings` returns it, so a value the backend did
 * not keep never looks applied. The face follows the same rule through its
 * own two commands, which answer the id Typography marks and the stack the
 * page applies, resolved by Rust from the same stored id.
 */
export class EditorPreferencesStore {
  current = $state<EditorPreferences>({ ...EDITOR_DEFAULTS });
  error = $state<string | null>(null);
  /** The face the page renders in; null until read, and the stylesheet's own meanwhile. */
  font = $state<EditorFont | null>(null);
  fontError = $state<string | null>(null);

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

  async loadFont(): Promise<void> {
    if (!isTauri()) return;
    try {
      this.font = await api.editorFont();
      this.fontError = null;
    } catch (e) {
      this.fontError = errorMessage(e);
    }
  }

  /** Kept only once Rust has kept it: a refusal leaves the page and the mark on the face they were in. */
  async chooseFont(id: string): Promise<void> {
    if (!isTauri()) return;
    this.fontError = null;
    try {
      this.font = await api.setEditorFont(id);
    } catch (e) {
      this.fontError = errorMessage(e);
    }
  }
}

export const editorPreferences = new EditorPreferencesStore();
