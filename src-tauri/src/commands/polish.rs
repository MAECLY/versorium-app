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

/// The CSS stack the editor should apply, resolved from the stored id.
#[tauri::command]
pub fn editor_font(state: tauri::State<SettingsStore>) -> String {
    fonts::stack_for(&state.get().editor_font).unwrap_or_default()
}

/// Choose a font. Only ids the catalogue knows are accepted, so settings can
/// never name something the editor cannot render.
#[tauri::command]
pub fn set_editor_font(state: tauri::State<SettingsStore>, id: String) -> Result<String, String> {
    if fonts::find(&id).is_none() {
        return Err("bad_args".into());
    }
    state.update(|s| s.editor_font = id.clone());
    fonts::stack_for(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings::Settings;

    /// The command layer takes `tauri::State`, which a unit test cannot build.
    /// These exercise the same rules against the store directly — the commands
    /// above are three-line wrappers over exactly this.
    fn store(dir: &std::path::Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    fn set_font(store: &SettingsStore, id: &str) -> Result<String, String> {
        if fonts::find(id).is_none() {
            return Err("bad_args".into());
        }
        store.update(|s| s.editor_font = id.to_string());
        fonts::stack_for(id)
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

        let stack = set_font(&store, "system-mono").unwrap();
        assert!(stack.contains("monospace"));
        assert_eq!(store.get().editor_font, "system-mono");

        // A font we do not ship must not reach settings, or the editor would
        // fall back silently and the panel would lie about what is applied.
        assert_eq!(set_font(&store, "comic-sans").unwrap_err(), "bad_args");
        assert_eq!(store.get().editor_font, "system-mono", "the rejected id changed nothing");
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
