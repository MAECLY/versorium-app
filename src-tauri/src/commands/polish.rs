//! Commands for the M7 polish surfaces: crash records, the continuity check
//! and the font catalogue.

use crate::commands::settings::SettingsStore;
use crate::{continuity, crash, fonts};
use std::path::PathBuf;

/// Newest first. A missing or unreadable log is an empty list, not an error:
/// "no crashes" is the normal state and must not look like a failure.
#[tauri::command]
pub fn crash_list(limit: Option<usize>) -> Vec<crash::CrashEntry> {
    crash::list(limit.unwrap_or(20))
}

/// The issue URL for one record, prefilled and already scrubbed. Opening it is
/// the writer's decision — nothing here touches the network.
#[tauri::command]
pub fn crash_report_url(id: String) -> Result<String, String> {
    crash::list(20)
        .into_iter()
        .find(|entry| entry.id == id)
        .map(|entry| crash::report_url(&entry))
        .ok_or_else(|| "not_found".to_string())
}

#[tauri::command]
pub fn crash_clear() -> Result<(), String> {
    crash::clear()
}

#[tauri::command]
pub async fn continuity_check(
    state: tauri::State<'_, SettingsStore>,
    path: PathBuf,
) -> Result<continuity::ContinuityReport, String> {
    let slot = state.get().slots.continuity;
    continuity::check(&path, &slot).await
}

#[tauri::command]
pub fn fonts_catalog() -> Result<&'static fonts::FontCatalog, String> {
    fonts::catalog()
}

/// The face settings hold, resolved: the id the Typography panel marks and the
/// stack the editor applies. A stored id the catalogue no longer has (or a
/// value that was never an id) answers the default face, under its own id, so
/// the mark and the page agree on it.
fn current_font(store: &SettingsStore) -> Result<fonts::EditorFont, String> {
    fonts::resolve(&store.get().editor_font).map(fonts::EditorFont::from)
}

/// Choose a face. Only ids the catalogue knows are kept, so settings can never
/// name something the editor cannot render; the answer is what was kept.
fn choose_font(store: &SettingsStore, id: &str) -> Result<fonts::EditorFont, String> {
    let entry = fonts::find(id).ok_or_else(|| "bad_args".to_string())?;
    store.update(|s| s.editor_font = entry.id.clone());
    Ok(entry.into())
}

#[tauri::command]
pub fn editor_font(state: tauri::State<SettingsStore>) -> Result<fonts::EditorFont, String> {
    current_font(&state)
}

#[tauri::command]
pub fn set_editor_font(state: tauri::State<SettingsStore>, id: String) -> Result<fonts::EditorFont, String> {
    choose_font(&state, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::Settings;

    /// The command layer takes `tauri::State`, which a unit test cannot build.
    /// The two font commands are one-line wrappers over `current_font` and
    /// `choose_font`, which these call with a store of their own.
    fn store(dir: &std::path::Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    #[test]
    fn a_fresh_install_writes_in_the_system_serif() {
        let settings = Settings::default();
        assert_eq!(settings.editor_font, "system-serif");
        assert!(!settings.focus_mode);
        assert!(!settings.typewriter);
        assert!(!settings.onboarded, "the tour has not been seen yet");
    }

    #[test]
    fn only_a_font_the_catalog_knows_can_be_chosen() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());

        let chosen = choose_font(&store, "system-mono").unwrap();
        assert!(chosen.stack.contains("monospace"));
        assert_eq!(store.get().editor_font, "system-mono");

        // A font we do not ship must not reach settings, or the editor would
        // fall back silently and the panel would lie about what is applied.
        assert_eq!(choose_font(&store, "comic-sans").unwrap_err(), "bad_args");
        assert_eq!(store.get().editor_font, "system-mono", "the rejected id changed nothing");
    }

    #[test]
    fn choosing_a_font_answers_what_was_kept() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let chosen = choose_font(&store, "source-serif-4").unwrap();
        // The answer is the face now in settings, read back the way the next
        // launch reads it: the panel marks it and the page renders it.
        assert_eq!(chosen, current_font(&store).unwrap());
        let reloaded = SettingsStore::load(dir.path().join("settings.json"));
        assert_eq!(current_font(&reloaded).unwrap(), chosen);
        assert_eq!(chosen.id, "source-serif-4");
    }

    #[test]
    fn the_editor_font_answers_the_id_settings_hold_and_its_stack() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        store.update(|s| s.editor_font = "source-serif-4".into());
        let font = current_font(&store).unwrap();
        // The id is what Typography compares with its rows; the stack is what
        // the page applies. The command used to answer the stack in both
        // places, so the panel's mark never matched a row.
        assert_eq!(font.id, store.get().editor_font);
        assert_ne!(font.id, font.stack);
        assert_eq!(font.stack, fonts::find("source-serif-4").unwrap().stack);
    }

    #[test]
    fn a_settings_file_naming_a_dropped_or_garbled_font_shows_and_renders_the_default() {
        let default = fonts::find("system-serif").unwrap();
        // A face a later catalogue dropped; a stack where an id belongs, which
        // no build wrote but a hand edit could; and a file from before fonts.
        for file in [
            r#"{"editorFont":"comic-sans","theme":"needle"}"#,
            r#"{"editorFont":"\"Iowan Old Style\", Palatino, serif","theme":"needle"}"#,
            r#"{"theme":"needle"}"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("settings.json");
            std::fs::write(&path, file).unwrap();
            let store = SettingsStore::load(path);
            assert_eq!(store.get().theme, "needle", "the rest of the file still loads: {file}");
            let font = current_font(&store).unwrap();
            assert_eq!(font.id, default.id, "{file}");
            assert_eq!(font.stack, default.stack, "{file}");
        }
    }

    #[test]
    fn the_editor_font_wire_shape_is_id_and_stack() {
        let font = current_font(&store(tempfile::tempdir().unwrap().path())).unwrap();
        let wire = serde_json::to_value(&font).unwrap();
        let keys: Vec<&str> = wire.as_object().unwrap().keys().map(String::as_str).collect();
        // src/lib/tauri.ts reads exactly these: `EditorFont { id, stack }`.
        assert_eq!(keys, ["id", "stack"]);
        assert_eq!(wire["id"], "system-serif");
    }

    #[test]
    fn the_writing_surface_preferences_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        store.update(|s| {
            s.focus_mode = true;
            s.typewriter = true;
            s.onboarded = true;
        });
        // Re-read from disk: a preference that does not survive the process is
        // one the writer has to set every launch.
        let reloaded = SettingsStore::load(dir.path().join("settings.json"));
        let s = reloaded.get();
        assert!(s.focus_mode && s.typewriter && s.onboarded);
    }

    #[test]
    fn a_settings_file_written_before_m7_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // No editorFont, focusMode, typewriter or onboarded keys at all.
        std::fs::write(&path, r#"{"uiLocale":"es","theme":"needle"}"#).unwrap();
        let s = SettingsStore::load(path).get();
        assert_eq!(s.ui_locale, "es", "the old keys survive");
        assert_eq!(s.theme, "needle");
        assert_eq!(s.editor_font, "system-serif", "the new ones default");
        assert!(!s.onboarded);
    }

    #[test]
    fn asking_to_report_a_crash_that_is_gone_is_not_a_crash() {
        assert_eq!(crash_report_url("no-such-id".into()).unwrap_err(), "not_found");
    }

    #[test]
    fn the_font_catalog_command_hands_back_something_renderable() {
        let catalog = fonts_catalog().unwrap();
        assert!(!catalog.fonts.is_empty());
        assert!(catalog.fonts.iter().all(|f| !f.stack.trim().is_empty()));
    }
}
