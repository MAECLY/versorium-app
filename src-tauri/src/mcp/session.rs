//! Per-process MCP session: which project is in scope, and what this client is
//! allowed to do with it.
//!
//! The permission model is deliberately blunt (spec §7): every client is
//! read-only until the user grants write in Settings → MCP, the grant is keyed
//! by the client id the user approved in the config file, and the grant is
//! re-read from disk on every call so revoking it takes effect immediately —
//! the user should not have to restart an agent to take back write access.

use crate::commands::settings::Settings;
use std::path::{Path, PathBuf};

/// Which protocol revision family the client opened with. Latched on the first
/// era-determining message and kept for the process: `2026-07-28` removed the
/// handshake and made every result carry `resultType`, so the same reply has to
/// be serialized differently depending on who asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Era {
    /// `initialize` handshake, 2025-11-25 and earlier.
    Legacy,
    /// Per-request `_meta`, 2026-07-28 and later.
    Modern,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Read,
    Write,
}

impl Scope {
    pub fn as_str(self) -> &'static str {
        match self {
            Scope::Read => "read",
            Scope::Write => "write",
        }
    }
}

pub struct Session {
    client: String,
    settings_path: PathBuf,
    /// Project chosen with `open_project` this session; falls back to whatever
    /// the GUI has open. Kept in memory so an agent cannot repoint the app.
    opened: Option<PathBuf>,
    era: Option<Era>,
}

impl Session {
    pub fn new(client: String, settings_path: PathBuf) -> Self {
        Self { client, settings_path, opened: None, era: None }
    }

    pub fn client(&self) -> &str {
        &self.client
    }

    pub fn era(&self) -> Option<Era> {
        self.era
    }

    /// First era-determining message wins; later messages cannot switch it.
    pub fn latch_era(&mut self, era: Era) -> Era {
        *self.era.get_or_insert(era)
    }

    /// Sibling of the settings file, so a session pointed at a scratch settings
    /// file logs there too — production logs land in the app-data dir, tests
    /// never touch it.
    pub fn log_path(&self) -> PathBuf {
        self.settings_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("mcp-log.jsonl")
    }

    fn settings(&self) -> Settings {
        crate::commands::settings::SettingsStore::load(self.settings_path.clone()).get()
    }

    /// Re-read per call: a grant revoked in the GUI must bite immediately.
    pub fn may_write(&self) -> bool {
        self.settings()
            .mcp_write_clients
            .iter()
            .any(|granted| granted == &self.client)
    }

    /// The project this session operates on, or `no_project` when the GUI has
    /// nothing open and the agent has not chosen one.
    pub fn project(&self) -> Result<PathBuf, String> {
        if let Some(path) = &self.opened {
            return Ok(path.clone());
        }
        self.settings()
            .mcp_active_project
            .map(PathBuf::from)
            .filter(|p| p.join("versorium.json").is_file())
            .ok_or_else(|| "no_project".to_string())
    }

    /// Point this session at a project. Only accepts a real Versorium project.
    pub fn open(&mut self, path: &Path) -> Result<PathBuf, String> {
        let root = path.canonicalize().map_err(|_| "not_found".to_string())?;
        if !root.join("versorium.json").is_file() {
            return Err("not_found".into());
        }
        self.opened = Some(root.clone());
        Ok(root)
    }

    /// Gate for every write tool. Returns the reason string the caller logs.
    pub fn require_write(&self) -> Result<(), String> {
        if self.may_write() {
            Ok(())
        } else {
            Err("write_not_allowed".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{create_project, CreateProjectArgs};
    use crate::commands::settings::SettingsStore;

    fn session(dir: &Path, client: &str) -> Session {
        Session::new(client.into(), dir.join("settings.json"))
    }

    #[test]
    fn the_era_is_decided_once_and_then_held() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = session(dir.path(), "codex");
        assert_eq!(s.era(), None);
        assert_eq!(s.latch_era(Era::Legacy), Era::Legacy);
        // A later modern-looking message cannot flip a client mid-stream.
        assert_eq!(s.latch_era(Era::Modern), Era::Legacy);
        assert_eq!(s.era(), Some(Era::Legacy));
    }

    #[test]
    fn the_log_sits_next_to_the_settings_it_was_given() {
        let dir = tempfile::tempdir().unwrap();
        let s = session(dir.path(), "codex");
        assert_eq!(s.log_path(), dir.path().join("mcp-log.jsonl"));
    }

    #[test]
    fn every_client_starts_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let s = session(dir.path(), "codex");
        assert!(!s.may_write());
        assert_eq!(s.require_write().unwrap_err(), "write_not_allowed");
    }

    #[test]
    fn a_grant_is_per_client_and_revocable_without_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("settings.json"));
        store.update(|s| s.mcp_write_clients = vec!["claude-code".into()]);

        let granted = session(dir.path(), "claude-code");
        let other = session(dir.path(), "codex");
        assert!(granted.may_write());
        assert!(!other.may_write(), "a grant must not leak to another client");

        // Revoking in the GUI takes effect on the very next call.
        store.update(|s| s.mcp_write_clients.clear());
        assert!(!granted.may_write());
    }

    #[test]
    fn project_comes_from_the_gui_and_must_be_a_real_project() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join("settings.json"));
        let mut s = session(dir.path(), "claude-code");
        assert_eq!(s.project().unwrap_err(), "no_project");

        let project = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Session Test".into(),
            language: "en".into(),
        })
        .unwrap();
        store.update(|st| st.mcp_active_project = Some(project.path.clone()));
        assert!(s.project().unwrap().ends_with("session-test"));

        // A directory that is not a Versorium project is refused.
        assert!(s.open(dir.path()).is_err());
        assert!(s.open(Path::new(&project.path)).is_ok());

        // Once opened, the session keeps its own choice even if the GUI closes.
        store.update(|st| st.mcp_active_project = None);
        assert!(s.project().is_ok());
    }
}
