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
    /// Legacy: never read since Focus became session-only. Kept, and still
    /// patchable, so a file written by an older build round-trips unchanged.
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
    /// How the page behaves under the caret: Settings → Editor.
    pub editor: EditorSettings,
    /// Which bars the writer folded away, and what Focus folds. Changed on
    /// the surfaces themselves (their Hide buttons, the rail and the lip, and
    /// Focus's own ⋯ menu), never in Settings.
    pub layout: LayoutSettings,
}

pub const TEXT_SIZES: [&str; 3] = ["small", "medium", "large"];
pub const LINE_SPACINGS: [&str; 3] = ["compact", "comfortable", "airy"];
pub const TEXT_WIDTHS: [&str; 3] = ["narrow", "medium", "wide"];
/// `next`: Tab leaves the editor for the next control. `indent`: it indents.
pub const TAB_KEYS: [&str; 2] = ["next", "indent"];

/// The editor's own preferences.
///
/// The three scales are named steps rather than numbers so the stylesheet keeps
/// the typography: Rust stores which step, `src/lib/editor/preferences.ts`
/// says what each step renders as.
///
/// Read leniently (the `Deserialize` impl below), because a refused
/// settings.json makes `SettingsStore::load` fall back to defaults for
/// everything — theme, backups and MCP grants included — and a derived impl
/// refuses the file over one bad value in this block: an unknown step, a
/// `null`, a string where a boolean goes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    /// Underline what the dictionary does not know. Nothing is corrected.
    pub spellcheck: bool,
    pub text_size: String,
    pub line_spacing: String,
    pub text_width: String,
    pub line_numbers: bool,
    /// The faint band behind the paragraph that holds the caret.
    pub active_line: bool,
    pub tab_key: String,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            // On: the founder's decision of 2026-10-03.
            spellcheck: true,
            // The middle steps are what the editor rendered before it had
            // settings (21px, 1.7, 72ch): the text keeps its size and shape.
            text_size: "medium".into(),
            line_spacing: "comfortable".into(),
            text_width: "medium".into(),
            // Off: a novel is not code. No release has shipped, so no writer
            // loses a habit.
            line_numbers: false,
            active_line: true,
            // Tab leaves the editor. Indenting prose reaches no export and two
            // presses turn a paragraph into a Markdown code block; the reasons
            // are spelled out next to the keymap in `src/lib/editor/preferences.ts`.
            tab_key: "next".into(),
        }
    }
}

/// The block on disk goes through the same gate as a patch from the frontend,
/// onto the defaults: each value is taken only if it has the right type and is
/// a step this build knows, so a bad one costs itself and nothing else, and the
/// UI is never handed a step it has no option for. Any JSON at all parses as a
/// `Value`, so nothing inside the block can fail the file.
impl<'de> Deserialize<'de> for EditorSettings {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        let mut editor = Self::default();
        editor.apply(&raw);
        Ok(editor)
    }
}

impl EditorSettings {
    /// Apply a partial patch from the frontend: only the keys present, and only
    /// values this build knows. Anything else is ignored, the way every other
    /// key of `set_settings` treats a value it does not accept.
    pub fn apply(&mut self, patch: &serde_json::Value) {
        let flag = |key: &str| patch.get(key).and_then(|v| v.as_bool());
        let step = |key: &str, allowed: &[&str]| {
            patch
                .get(key)
                .and_then(|v| v.as_str())
                .filter(|v| allowed.contains(v))
                .map(str::to_string)
        };
        if let Some(v) = flag("spellcheck") {
            self.spellcheck = v;
        }
        if let Some(v) = step("textSize", &TEXT_SIZES) {
            self.text_size = v;
        }
        if let Some(v) = step("lineSpacing", &LINE_SPACINGS) {
            self.line_spacing = v;
        }
        if let Some(v) = step("textWidth", &TEXT_WIDTHS) {
            self.text_width = v;
        }
        if let Some(v) = flag("lineNumbers") {
            self.line_numbers = v;
        }
        if let Some(v) = flag("activeLine") {
            self.active_line = v;
        }
        if let Some(v) = step("tabKey", &TAB_KEYS) {
            self.tab_key = v;
        }
    }
}

/// The window's layout: whether the projects-and-chapters panel and the top
/// bar are open, and which of the two Focus folds away.
///
/// Focus itself is not here. It lasts one session, so a launch never opens
/// into hidden chrome; it borrows this layout and never writes to it.
///
/// Read leniently, for the reason `EditorSettings` is: a derived impl would
/// refuse the whole file over one hand-edited `null`, and `SettingsStore::load`
/// would then fall back to defaults for the theme, the backups and the grants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    pub binder_open: bool,
    pub top_bar_open: bool,
    pub focus_hides_binder: bool,
    pub focus_hides_top_bar: bool,
}

impl Default for LayoutSettings {
    /// Everything shown, and Focus hides both: what an install from before
    /// this block looks like, so upgrading changes nothing on screen.
    fn default() -> Self {
        Self { binder_open: true, top_bar_open: true, focus_hides_binder: true, focus_hides_top_bar: true }
    }
}

impl<'de> Deserialize<'de> for LayoutSettings {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        let mut layout = Self::default();
        layout.apply(&raw);
        Ok(layout)
    }
}

impl LayoutSettings {
    /// Apply a partial patch: only the keys present, and only JSON booleans.
    pub fn apply(&mut self, patch: &serde_json::Value) {
        let flag = |key: &str| patch.get(key).and_then(|v| v.as_bool());
        if let Some(v) = flag("binderOpen") {
            self.binder_open = v;
        }
        if let Some(v) = flag("topBarOpen") {
            self.top_bar_open = v;
        }
        if let Some(v) = flag("focusHidesBinder") {
            self.focus_hides_binder = v;
        }
        if let Some(v) = flag("focusHidesTopBar") {
            self.focus_hides_top_bar = v;
        }
    }
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
            editor: EditorSettings::default(),
            layout: LayoutSettings::default(),
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
    state.update(|s| apply_patch(s, &patch));
    Ok(state.get())
}

/// Everything `set_settings` does to the settings, apart from the store, so a
/// test can send exactly what the frontend sends. The browser mock cannot stand
/// in for that: it accepts whatever shape it is handed, so a key this function
/// never reads would pass every E2E test and still be lost on disk.
pub(crate) fn apply_patch(s: &mut Settings, patch: &serde_json::Value) {
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
    // focusMode is legacy (see the field) and kept so older writes still land.
    if let Some(v) = patch.get("focusMode").and_then(|v| v.as_bool()) {
        s.focus_mode = v;
    }
    if let Some(v) = patch.get("typewriter").and_then(|v| v.as_bool()) {
        s.typewriter = v;
    }
    if let Some(v) = patch.get("onboarded").and_then(|v| v.as_bool()) {
        s.onboarded = v;
    }
    // The editor's preferences are patchable for the same reason: each one
    // is a look or a key, and a wrong click costs one click to undo.
    if let Some(editor) = patch.get("editor") {
        s.editor.apply(editor);
    }
    // The layout too: hiding a bar costs one click to undo, on the bar itself.
    if let Some(layout) = patch.get("layout") {
        s.layout.apply(layout);
    }
    // mcpWriteClients / mcpActiveProject / slots / studio* / editorFont are
    // deliberately NOT patchable from here: granting write, pointing a task
    // at a model, aiming at a local endpoint and choosing a font that must
    // exist in the catalogue each get their own command, so the UI cannot
    // flip one by accident while saving an unrelated preference.
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
    fn a_fresh_install_checks_spelling_and_shows_no_line_numbers() {
        let editor = SettingsStore::load(PathBuf::from("/nonexistent/versorium/settings.json")).get().editor;
        assert!(editor.spellcheck, "spelling is checked out of the box");
        assert!(!editor.line_numbers, "a novel is not code");
        assert!(editor.active_line);
        // The middle steps are what the page looked like before these
        // settings existed; the frontend maps them to 21px, 1.7 and 72ch.
        assert_eq!(editor.text_size, "medium");
        assert_eq!(editor.line_spacing, "comfortable");
        assert_eq!(editor.text_width, "medium");
        assert_eq!(editor.tab_key, "next", "Tab leaves the editor unless asked to indent");
    }

    #[test]
    fn a_settings_file_from_before_the_editor_group_loads_with_its_defaults() {
        // An install that predates Settings → Editor has no `editor` key at
        // all. It must keep everything it had and gain the defaults.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"uiLocale":"es","theme":"quarry","focusMode":true,"backupKeep":7}"#).unwrap();

        let s = SettingsStore::load(path).get();
        assert_eq!(s.ui_locale, "es");
        assert_eq!(s.theme, "quarry");
        assert!(s.focus_mode);
        assert_eq!(s.backup_keep, 7);
        assert_eq!(s.editor, EditorSettings::default());
    }

    #[test]
    fn half_an_editor_block_keeps_the_rest_at_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"editor":{"textSize":"large","spellcheck":false}}"#).unwrap();

        let editor = SettingsStore::load(path).get().editor;
        assert_eq!(editor.text_size, "large");
        assert!(!editor.spellcheck);
        assert_eq!(editor.line_spacing, "comfortable");
        assert_eq!(editor.tab_key, "next");
    }

    #[test]
    fn an_unknown_editor_step_falls_back_instead_of_losing_the_file() {
        // A typo in one value must cost that value, not the theme, the
        // backups and the grants that share the file with it.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{"theme":"needle","editor":{"textSize":"huge","lineSpacing":"airy","textWidth":"","tabKey":"sideways","lineNumbers":true}}"#,
        )
        .unwrap();

        let s = SettingsStore::load(path).get();
        assert_eq!(s.theme, "needle", "the rest of the file still parsed");
        assert_eq!(s.editor.text_size, "medium");
        assert_eq!(s.editor.line_spacing, "airy", "a known value is kept");
        assert_eq!(s.editor.text_width, "medium");
        assert_eq!(s.editor.tab_key, "next");
        assert!(s.editor.line_numbers);
    }

    #[test]
    fn a_wrongly_typed_editor_value_costs_that_value_and_never_the_file() {
        // The app only ever writes what `apply` accepted, so these come from a
        // hand edit. Each must cost what it touches: the theme beside it, and
        // the good values inside the same block, survive.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let load = |json: &str| {
            fs::write(&path, json).unwrap();
            SettingsStore::load(path.clone()).get()
        };

        let s = load(r#"{"theme":"needle","editor":null}"#);
        assert_eq!(s.theme, "needle", "a null block still lets the file parse");
        assert_eq!(s.editor, EditorSettings::default());

        let s = load(r#"{"theme":"needle","editor":"large"}"#);
        assert_eq!(s.theme, "needle", "so does a block that is not an object");
        assert_eq!(s.editor, EditorSettings::default());

        let s = load(
            r#"{"theme":"needle","editor":{"spellcheck":"yes","textSize":5,"lineSpacing":"airy","lineNumbers":true,"activeLine":null,"tabKey":["indent"]}}"#,
        );
        assert_eq!(s.theme, "needle", "the rest of the file still parsed");
        assert!(s.editor.spellcheck, "not a boolean: the default");
        assert_eq!(s.editor.text_size, "medium", "not a string: the default");
        assert!(s.editor.active_line, "null: the default");
        assert_eq!(s.editor.tab_key, "next", "not a string: the default");
        assert_eq!(s.editor.line_spacing, "airy", "a good value beside bad ones is kept");
        assert!(s.editor.line_numbers, "a good value beside bad ones is kept");
    }

    #[test]
    fn the_editor_patch_takes_known_values_and_ignores_the_rest() {
        let mut editor = EditorSettings::default();
        editor.apply(&serde_json::json!({
            "spellcheck": false,
            "textSize": "small",
            "lineSpacing": "double",
            "textWidth": "wide",
            "lineNumbers": "yes",
            "activeLine": false,
            "tabKey": "indent",
        }));
        assert!(!editor.spellcheck);
        assert_eq!(editor.text_size, "small");
        assert_eq!(editor.line_spacing, "comfortable", "not a step: ignored");
        assert_eq!(editor.text_width, "wide");
        assert!(!editor.line_numbers, "not a boolean: ignored");
        assert!(!editor.active_line);
        assert_eq!(editor.tab_key, "indent");

        // A patch naming one key leaves every other one where it was.
        editor.apply(&serde_json::json!({ "textSize": "large" }));
        assert_eq!(editor.text_size, "large");
        assert_eq!(editor.text_width, "wide");
        assert_eq!(editor.tab_key, "indent");
    }

    #[test]
    fn editor_preferences_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = SettingsStore::load(path.clone());
        store.update(|s| {
            s.editor.apply(&serde_json::json!({
                "spellcheck": false,
                "textSize": "large",
                "lineSpacing": "compact",
                "textWidth": "narrow",
                "lineNumbers": true,
                "activeLine": false,
                "tabKey": "indent",
            }))
        });

        // Read back from disk, as the next launch does.
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"textSize\": \"large\""), "camelCase on disk: {raw}");
        let editor = SettingsStore::load(path).get().editor;
        assert_eq!(
            editor,
            EditorSettings {
                spellcheck: false,
                text_size: "large".into(),
                line_spacing: "compact".into(),
                text_width: "narrow".into(),
                line_numbers: true,
                active_line: false,
                tab_key: "indent".into(),
            }
        );
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

    #[test]
    fn a_fresh_install_shows_both_bars_and_focus_hides_both() {
        let layout = SettingsStore::load(PathBuf::from("/nonexistent/versorium/settings.json")).get().layout;
        assert!(layout.binder_open, "the projects-and-chapters panel starts open");
        assert!(layout.top_bar_open, "the top bar starts open");
        assert!(layout.focus_hides_binder, "Focus hides the panel unless told otherwise");
        assert!(layout.focus_hides_top_bar, "Focus hides the top bar unless told otherwise");
    }

    #[test]
    fn a_file_from_before_layout_loads_everything_shown() {
        // An install that predates the layout block, with Focus left on by the
        // build that still restored it. Upgrading must open into a full window.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"focusMode":true,"theme":"quarry"}"#).unwrap();

        let s = SettingsStore::load(path).get();
        assert_eq!(s.theme, "quarry", "the rest of the file still parsed");
        assert!(s.layout.binder_open && s.layout.top_bar_open, "both bars shown");
        assert!(s.layout.focus_hides_binder && s.layout.focus_hides_top_bar, "both recipe items ticked");
    }

    #[test]
    fn a_wrongly_typed_layout_value_costs_that_value_and_never_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let load = |json: &str| {
            fs::write(&path, json).unwrap();
            SettingsStore::load(path.clone()).get()
        };

        let s = load(r#"{"theme":"needle","layout":null}"#);
        assert_eq!(s.theme, "needle", "a null block still lets the file parse");
        assert_eq!(s.layout, LayoutSettings::default());

        let s = load(r#"{"theme":"needle","layout":"x"}"#);
        assert_eq!(s.theme, "needle", "so does a block that is not an object");
        assert_eq!(s.layout, LayoutSettings::default());

        let s = load(r#"{"theme":"needle","layout":{"binderOpen":"no","topBarOpen":false}}"#);
        assert_eq!(s.theme, "needle", "the rest of the file still parsed");
        assert!(!s.layout.top_bar_open, "a good value beside a bad one is kept");
        assert!(s.layout.binder_open, "not a boolean: the default");
    }

    #[test]
    fn the_layout_patch_takes_booleans_only() {
        let mut s = Settings::default();
        apply_patch(&mut s, &serde_json::json!({ "layout": { "binderOpen": false } }));
        assert!(!s.layout.binder_open, "the shape the frontend sends");
        assert!(s.layout.top_bar_open, "a patch naming one key leaves the others");

        apply_patch(&mut s, &serde_json::json!({ "layout": { "topBarOpen": "false" } }));
        assert!(s.layout.top_bar_open, "a string is not a boolean: ignored");

        apply_patch(&mut s, &serde_json::json!({ "layout": { "focusHidesTopBar": false } }));
        assert!(!s.layout.focus_hides_top_bar);
        assert!(s.layout.focus_hides_binder);

        // Flat keys are not the layout. A frontend that sent this shape would
        // look fine against the mock and lose every change on disk.
        let mut flat = Settings::default();
        apply_patch(&mut flat, &serde_json::json!({ "binderOpen": false, "focusHidesBinder": false }));
        assert_eq!(flat.layout, LayoutSettings::default());
    }

    #[test]
    fn layout_serializes_camel_case() {
        let mut s = Settings::default();
        s.layout.binder_open = false;
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(
            json["layout"],
            serde_json::json!({
                "binderOpen": false,
                "topBarOpen": true,
                "focusHidesBinder": true,
                "focusHidesTopBar": true,
            })
        );
        // And back, as the next launch reads it.
        let again: Settings = serde_json::from_value(json).unwrap();
        assert_eq!(again.layout, s.layout);
    }
}
