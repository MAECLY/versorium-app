//! App settings persisted in the OS app-data dir (never in the novel folder).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ui_locale: String,
    pub theme: String,
    pub theme_mode: String,
    pub censorship: bool,
    /// Two OAuth slots, never mixed: app updates vs the user's novel repos.
    pub github_updates_token: Option<String>,
    pub github_novel_token: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ui_locale: "en".into(),
            theme: "folio".into(),
            theme_mode: "follow".into(),
            censorship: false,
            github_updates_token: None,
            github_novel_token: None,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let settings = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: RwLock::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner.read().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Settings)) {
        let mut g = self.inner.write().unwrap();
        f(&mut g);
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(
            &self.path,
            serde_json::to_string_pretty(&*g).unwrap_or_default(),
        );
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<SettingsStore>) -> Settings {
    state.get()
}

#[tauri::command]
pub fn set_settings(
    state: tauri::State<SettingsStore>,
    patch: serde_json::Value,
) -> Result<Settings, String> {
    state.update(|s| {
        if let Some(v) = patch.get("uiLocale").and_then(|v| v.as_str()) {
            if v == "en" || v == "es" {
                s.ui_locale = v.into();
            }
        }
        if let Some(v) = patch.get("theme").and_then(|v| v.as_str()) {
            if matches!(v, "folio" | "quarry" | "needle") {
                s.theme = v.into();
            }
        }
        if let Some(v) = patch.get("themeMode").and_then(|v| v.as_str()) {
            if matches!(v, "light" | "dark" | "follow") {
                s.theme_mode = v.into();
            }
        }
        if let Some(v) = patch.get("censorship").and_then(|v| v.as_bool()) {
            s.censorship = v;
        }
        if let Some(v) = patch.get("githubUpdatesToken").and_then(|v| v.as_str()) {
            s.github_updates_token = if v.is_empty() { None } else { Some(v.into()) };
        }
        if let Some(v) = patch.get("githubNovelToken").and_then(|v| v.as_str()) {
            s.github_novel_token = if v.is_empty() { None } else { Some(v.into()) };
        }
    });
    Ok(state.get())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_defaults_when_missing() {
        let store = SettingsStore::load(PathBuf::from("/nonexistent/versorium/settings.json"));
        let s = store.get();
        assert_eq!(s.ui_locale, "en");
        assert_eq!(s.theme, "folio");
        assert_eq!(s.theme_mode, "follow");
    }

    #[test]
    fn updates_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("settings.json"));
        store.update(|s| {
            s.ui_locale = "es".into();
            s.censorship = true;
        });
        let s = store.get();
        assert_eq!(s.ui_locale, "es");
        assert!(s.censorship);
        let raw = fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(raw.contains("\"uiLocale\": \"es\""));
    }
}
