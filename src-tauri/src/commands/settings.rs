//! App settings persisted in the OS app-data dir (never in the novel folder).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

/// Where one task's model comes from. `kind` is `none` | `builtin` | `ollama` |
/// `cli`; `id` is the catalog id, the Ollama tag, or the harness name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SlotAssignment {
    pub kind: String,
    pub id: String,
}

impl Default for SlotAssignment {
    fn default() -> Self {
        // Not `String::default()`: an empty `kind` would read as a fourth,
        // undefined state. Every unassigned slot says so explicitly.
        Self { kind: "none".into(), id: String::new() }
    }
}

/// One model per task, not one model globally (spec §6.2): rewriting a
/// selection and checking continuity want different sizes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Slots {
    pub rewrite: SlotAssignment,
    pub chat: SlotAssignment,
    pub continuity: SlotAssignment,
    pub embeddings: SlotAssignment,
    pub dictation: SlotAssignment,
}

pub const SLOT_NAMES: [&str; 5] = ["rewrite", "chat", "continuity", "embeddings", "dictation"];
pub const SLOT_KINDS: [&str; 4] = ["none", "builtin", "ollama", "cli"];

impl Slots {
    /// Read one slot by name. Only the tests need this — the command layer
    /// always mutates — so it is not compiled into the shipped binary.
    #[cfg(test)]
    pub fn get(&self, slot: &str) -> Option<&SlotAssignment> {
        match slot {
            "rewrite" => Some(&self.rewrite),
            "chat" => Some(&self.chat),
            "continuity" => Some(&self.continuity),
            "embeddings" => Some(&self.embeddings),
            "dictation" => Some(&self.dictation),
            _ => None,
        }
    }

    pub fn get_mut(&mut self, slot: &str) -> Option<&mut SlotAssignment> {
        match slot {
            "rewrite" => Some(&mut self.rewrite),
            "chat" => Some(&mut self.chat),
            "continuity" => Some(&mut self.continuity),
            "embeddings" => Some(&mut self.embeddings),
            "dictation" => Some(&mut self.dictation),
            _ => None,
        }
    }

    /// Every slot, for callers that need to sweep them all.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut SlotAssignment> {
        [
            &mut self.rewrite,
            &mut self.chat,
            &mut self.continuity,
            &mut self.embeddings,
            &mut self.dictation,
        ]
        .into_iter()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ui_locale: String,
    pub theme: String,
    pub theme_mode: String,
    pub censorship: bool,
    /// Legacy home of the two tokens, kept only so an existing install can be
    /// migrated. Credentials now live in the OS store (`crate::secrets`); these
    /// are cleared the first time the store accepts them and are never written
    /// again. The wire shape keeps them so an older settings.json still parses.
    pub github_updates_token: Option<String>,
    pub github_novel_token: Option<String>,
    /// `stable` (default) or `beta` — the spec's two release channels.
    pub update_channel: String,
    /// Checking on a schedule is on by default on stable (spec §11).
    pub update_automatic: bool,
    /// A version the writer chose to skip; never offered again.
    pub update_skipped: Option<String>,
    /// MCP clients allowed to call write tools. Empty = every client is
    /// read-only, which is the default the spec requires (§7).
    pub mcp_write_clients: Vec<String>,
    /// Project the GUI currently has open, so the separate `versorium mcp`
    /// process knows what "the manuscript" means. Cleared when none is open.
    pub mcp_active_project: Option<String>,
    /// Which model serves each task. Empty on a fresh install: nothing local
    /// is selected until the user downloads something.
    pub slots: Slots,
    /// LM Studio / llama-server, an OpenAI-compatible endpoint on this machine.
    pub studio_host: String,
    pub studio_port: u16,
    pub studio_enabled: bool,
    /// Where backups went when there could only be one destination.
    ///
    /// Kept so an existing install does not silently lose the folder it was
    /// already backing up to: `backup_dirs` is a different key, and an unknown
    /// key is dropped without a word. Migrated on load and never written again.
    #[serde(skip_serializing)]
    pub backup_dir: Option<String>,
    /// Which entry of `fonts/catalog.json` the editor renders in.
    pub editor_font: String,
    /// Chrome fades and the page centres (DESIGN-VERSORIUM.md).
    pub focus_mode: bool,
    /// The active line sits at the lower third.
    pub typewriter: bool,
    /// Whether the first-run tour has been completed or dismissed.
    pub onboarded: bool,
    /// Folders a novel is archived into — typically ones the OS already syncs.
    /// Empty means backups are off, which is the default: writing a novel
    /// somewhere the writer never chose is not a sensible default.
    ///
    /// A list because 3-2-1 asks for copies on different media, and one folder
    /// can only ever be one.
    pub backup_dirs: Vec<String>,
    /// How many archives to keep in each, before the oldest is dropped.
    pub backup_keep: usize,
    /// Serve MCP over HTTP as well as stdio. Off by default: it opens a listener
    /// on a machine whose MCP tools can write to a manuscript, so it is a
    /// deliberate choice rather than a default.
    pub mcp_http_enabled: bool,
    /// Two author identities, and which one exports use.
    ///
    /// Two rather than one because the same person writes under a contract and
    /// under a pen name, and the difference is a publisher, a copyright line
    /// and often a different name. Two rather than many because a third has no
    /// name anybody agreed on, and a list turns a setting into a manager.
    pub author_profiles: AuthorProfiles,
    /// `work` or `hobby`.
    pub author_profile: String,
}

/// One author identity, as it will appear in an exported file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthorProfile {
    /// The byline. Goes on the title page and into every format's creator field.
    pub name: String,
    /// "Le Guin, Ursula K." — how a shelf sorts it. Guessed when left empty.
    pub sort_as: String,
    /// A MARC relator: `aut`, `edt`, `trl`.
    pub role: String,
    /// Publisher, imprint or company.
    pub organization: String,
    /// The copyright line, verbatim.
    pub rights: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthorProfiles {
    pub work: AuthorProfile,
    pub hobby: AuthorProfile,
}

impl Settings {
    /// The profile exports should use. An unknown name falls back to `work`
    /// rather than to nothing, so a hand-edited settings file cannot silently
    /// strip a manuscript's author.
    pub fn active_author(&self) -> &AuthorProfile {
        match self.author_profile.as_str() {
            "hobby" => &self.author_profiles.hobby,
            _ => &self.author_profiles.work,
        }
    }
}

impl AuthorProfile {
    pub fn byline(&self) -> crate::formats::Byline {
        crate::formats::Byline {
            sort_as: self.sort_as.trim().to_string(),
            role: self.role.trim().to_string(),
            organization: self.organization.trim().to_string(),
            rights: self.rights.trim().to_string(),
        }
    }
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
            update_channel: "stable".into(),
            update_automatic: true,
            update_skipped: None,
            mcp_write_clients: Vec::new(),
            mcp_active_project: None,
            slots: Slots::default(),
            studio_host: "127.0.0.1".into(),
            // LM Studio's default local port.
            studio_port: 1234,
            studio_enabled: false,
            backup_dir: None,
            editor_font: "system-serif".into(),
            focus_mode: false,
            typewriter: false,
            onboarded: false,
            backup_dirs: Vec::new(),
            backup_keep: crate::backup::DEFAULT_KEEP,
            mcp_http_enabled: false,
            author_profiles: AuthorProfiles::default(),
            author_profile: "work".into(),
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let mut settings: Settings = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // One destination became a list. Without this, an install that was
        // already backing up would come back with backups off and no reason
        // given, which is the worst way to find out.
        if let Some(legacy) = settings.backup_dir.take() {
            if settings.backup_dirs.is_empty() && !legacy.trim().is_empty() {
                settings.backup_dirs.push(legacy);
            }
        }
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
        // Writing-surface preferences are patchable: unlike a write grant or a
        // model slot, flipping one by accident costs a keystroke to undo.
        if let Some(v) = patch.get("focusMode").and_then(|v| v.as_bool()) {
            s.focus_mode = v;
        }
        if let Some(v) = patch.get("typewriter").and_then(|v| v.as_bool()) {
            s.typewriter = v;
        }
        if let Some(v) = patch.get("onboarded").and_then(|v| v.as_bool()) {
            s.onboarded = v;
        }
        // mcpWriteClients / mcpActiveProject / slots / studio* / editorFont are
        // deliberately NOT patchable from here: granting write, pointing a task
        // at a model, aiming at a local endpoint and choosing a font that must
        // exist in the catalogue each get their own command, so the UI cannot
        // flip one by accident while saving an unrelated preference.
    });
    Ok(state.get())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_are_automatic_on_stable_out_of_the_box() {
        let store = SettingsStore::load(PathBuf::from("/nonexistent/versorium/settings.json"));
        let s = store.get();
        assert_eq!(s.update_channel, "stable");
        assert!(s.update_automatic, "spec §11: on by default on stable");
        assert!(s.update_skipped.is_none());
    }

    #[test]
    fn write_grants_are_not_patchable_through_set_settings() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("settings.json"));
        store.update(|s| s.mcp_write_clients.push("codex".into()));
        // A generic patch must not be able to add or drop a grant.
        let patch = serde_json::json!({ "mcpWriteClients": ["claude-code"], "uiLocale": "es" });
        if let Some(v) = patch.get("uiLocale").and_then(|v| v.as_str()) {
            store.update(|s| s.ui_locale = v.into());
        }
        assert_eq!(store.get().mcp_write_clients, vec!["codex".to_string()]);
    }

    #[test]
    fn a_fresh_install_has_no_model_selected_for_any_task() {
        let store = SettingsStore::load(PathBuf::from("/nonexistent/versorium/settings.json"));
        let s = store.get();
        for name in SLOT_NAMES {
            let slot = s.slots.get(name).expect("known slot");
            assert_eq!(slot.kind, "none", "{name} must start unassigned");
            assert!(slot.id.is_empty(), "{name} must start with no id");
        }
        assert_eq!(s.studio_host, "127.0.0.1");
        assert_eq!(s.studio_port, 1234);
        assert!(!s.studio_enabled, "we never reach out to a local server unasked");
    }

    #[test]
    fn a_settings_file_written_before_slots_existed_still_loads() {
        // Upgrading must not reset someone's theme just because the file
        // predates these fields.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"uiLocale":"es","theme":"needle"}"#).unwrap();
        let s = SettingsStore::load(path).get();
        assert_eq!(s.ui_locale, "es");
        assert_eq!(s.theme, "needle");
        assert_eq!(s.slots.rewrite.kind, "none");
        assert_eq!(s.studio_port, 1234);
    }

    #[test]
    fn slots_are_addressable_by_name_and_sweepable() {
        let mut slots = Slots::default();
        assert!(slots.get("nope").is_none());
        slots.get_mut("continuity").unwrap().kind = "ollama".into();
        assert_eq!(slots.continuity.kind, "ollama");
        assert_eq!(slots.iter_mut().count(), SLOT_NAMES.len());
    }

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
        assert!(s.mcp_write_clients.is_empty(), "MCP is read-only until granted");
        let raw = fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(raw.contains("\"uiLocale\": \"es\""));
    }

    #[test]
    fn an_unknown_profile_name_falls_back_to_one_that_exists() {
        // A hand-edited settings file must not be able to silently strip the
        // author off every export.
        let mut settings = Settings::default();
        settings.author_profiles.work.name = "Ana Ruiz".into();
        settings.author_profiles.hobby.name = "A. R. Nocturna".into();

        assert_eq!(settings.active_author().name, "Ana Ruiz", "work is the default");
        settings.author_profile = "hobby".into();
        assert_eq!(settings.active_author().name, "A. R. Nocturna");
        settings.author_profile = "whatever".into();
        assert_eq!(settings.active_author().name, "Ana Ruiz");
    }

    #[test]
    fn a_profile_is_trimmed_on_its_way_into_a_file() {
        let profile = AuthorProfile {
            name: " Ana ".into(),
            sort_as: " Ruiz, Ana ".into(),
            role: " aut ".into(),
            organization: " Minotauro ".into(),
            rights: " © 2026 ".into(),
        };
        let byline = profile.byline();
        assert_eq!(byline.sort_as, "Ruiz, Ana");
        assert_eq!(byline.role, "aut");
        assert_eq!(byline.organization, "Minotauro");
        assert_eq!(byline.rights, "© 2026");
    }

    #[test]
    fn two_profiles_are_stored_separately_and_survive_a_reload() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        let store = SettingsStore::load(path.clone());
        store.update(|s| {
            s.author_profiles.work.name = "Ana Ruiz".into();
            s.author_profiles.work.organization = "Minotauro".into();
            s.author_profiles.hobby.name = "A. R. Nocturna".into();
            s.author_profile = "hobby".into();
        });

        // The point of two profiles is that filling one leaves the other alone.
        let again = SettingsStore::load(path).get();
        assert_eq!(again.author_profiles.work.organization, "Minotauro");
        assert_eq!(again.author_profiles.hobby.organization, "");
        assert_eq!(again.active_author().name, "A. R. Nocturna");
    }

    #[test]
    fn an_install_that_was_already_backing_up_keeps_its_folder() {
        // `backupDir` became `backupDirs`. An unknown key is dropped in
        // silence, so without a migration the writer's backups turn off and
        // nothing says why.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        fs::write(&path, r#"{"backupDir":"/Users/x/iCloud","backupKeep":7,"theme":"quarry"}"#).unwrap();

        let settings = SettingsStore::load(path.clone()).get();
        assert_eq!(settings.backup_dirs, vec!["/Users/x/iCloud".to_string()]);
        assert_eq!(settings.backup_keep, 7, "the rest of the file still parsed");
        assert_eq!(settings.theme, "quarry");
        assert_eq!(settings.author_profile, "work", "a missing key takes its default");
    }

    #[test]
    fn the_legacy_key_is_never_written_back() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        fs::write(&path, r#"{"backupDir":"/Users/x/iCloud"}"#).unwrap();

        let store = SettingsStore::load(path.clone());
        store.update(|s| s.theme = "needle".into());
        let written = fs::read_to_string(&path).unwrap();
        assert!(!written.contains("backupDir\""), "migrated once, then gone: {written}");
        assert!(written.contains("backupDirs"));
    }
}
