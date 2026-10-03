//! Settings → MCP: what the server is, who may talk to it, and what they did.
//!
//! Connecting a client and granting it write access are separate commands on
//! purpose (spec §7): registering the server is harmless, letting an agent
//! rewrite the manuscript is not, so the second never rides along with the first.

use crate::commands::settings::SettingsStore;
use crate::mcp::{clients, log};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClient {
    pub id: String,
    pub name: String,
    pub config_path: String,
    /// The client itself is installed on this machine.
    pub detected: bool,
    /// Our server entry is present in that client's config.
    pub installed: bool,
    pub write_allowed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    /// Absolute path to this binary — correct in dev and inside the bundle.
    pub command: String,
    pub args: Vec<String>,
    pub log_path: String,
    pub clients: Vec<McpClient>,
}

fn binary() -> Result<std::path::PathBuf, String> {
    std::env::current_exe().map_err(|_| "io".to_string())
}

fn status(state: &SettingsStore) -> Result<McpStatus, String> {
    let granted = state.get().mcp_write_clients;
    let clients = clients::catalog()
        .into_iter()
        .map(|c| McpClient {
            config_path: clients::config_path(c.id)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            detected: clients::detected(c.id),
            installed: clients::installed(c.id),
            write_allowed: granted.iter().any(|g| g == c.id),
            id: c.id.to_string(),
            name: c.name.to_string(),
        })
        .collect();
    Ok(McpStatus {
        command: binary()?.to_string_lossy().into_owned(),
        // The per-client `--client <id>` is added when writing a config; the
        // template shown to the user is the plain command.
        args: vec!["mcp".to_string()],
        log_path: crate::paths::mcp_log_path()?.to_string_lossy().into_owned(),
        clients,
    })
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<SettingsStore>) -> Result<McpStatus, String> {
    status(&state)
}

#[tauri::command]
pub fn mcp_set_write(
    state: tauri::State<SettingsStore>,
    client: String,
    allowed: bool,
) -> Result<McpStatus, String> {
    let id = validated(&client)?;
    state.update(|s| {
        s.mcp_write_clients.retain(|g| g != &id);
        if allowed {
            s.mcp_write_clients.push(id.clone());
        }
    });
    status(&state)
}

#[tauri::command]
pub fn mcp_install_client(
    state: tauri::State<SettingsStore>,
    client: String,
) -> Result<McpStatus, String> {
    let id = validated(&client)?;
    clients::install(&id, &binary()?)?;
    status(&state)
}

#[tauri::command]
pub fn mcp_uninstall_client(
    state: tauri::State<SettingsStore>,
    client: String,
) -> Result<McpStatus, String> {
    let id = validated(&client)?;
    clients::uninstall(&id)?;
    // Disconnecting must not leave a grant behind that would silently apply if
    // the user reconnects later.
    state.update(|s| s.mcp_write_clients.retain(|g| g != &id));
    status(&state)
}

#[tauri::command]
pub fn mcp_log(limit: Option<usize>) -> Result<Vec<log::LogEntry>, String> {
    Ok(log::read(limit.unwrap_or(50)))
}

#[tauri::command]
pub fn mcp_set_active_project(
    state: tauri::State<SettingsStore>,
    path: Option<String>,
) -> Result<(), String> {
    state.update(|s| s.mcp_active_project = path.filter(|p| !p.is_empty()));
    Ok(())
}

/// Only ids from the catalog reach the settings file or the config writer.
fn validated(client: &str) -> Result<String, String> {
    clients::catalog()
        .iter()
        .find(|c| c.id == client)
        .map(|c| c.id.to_string())
        .ok_or_else(|| "mcp_client_unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &std::path::Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    #[test]
    fn only_catalog_ids_are_accepted() {
        assert_eq!(validated("codex").unwrap(), "codex");
        assert_eq!(validated("opencode").unwrap(), "opencode");
        assert_eq!(validated("cursor").unwrap_err(), "mcp_client_unknown");
        assert_eq!(validated("").unwrap_err(), "mcp_client_unknown");
    }

    #[test]
    fn granting_write_is_idempotent_and_revocable() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());

        // The command body, without the Tauri State wrapper.
        let grant = |allowed: bool| {
            store.update(|s| {
                s.mcp_write_clients.retain(|g| g != "codex");
                if allowed {
                    s.mcp_write_clients.push("codex".into());
                }
            });
        };

        grant(true);
        grant(true);
        assert_eq!(store.get().mcp_write_clients, vec!["codex".to_string()]);
        grant(false);
        assert!(store.get().mcp_write_clients.is_empty());
    }

    #[test]
    fn active_project_round_trips_and_clears() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let set = |path: Option<String>| {
            store.update(|s| s.mcp_active_project = path.filter(|p| !p.is_empty()));
        };

        set(Some("/novels/winter".into()));
        assert_eq!(store.get().mcp_active_project.as_deref(), Some("/novels/winter"));
        set(Some(String::new()));
        assert!(store.get().mcp_active_project.is_none(), "an empty path clears it");
        set(Some("/novels/winter".into()));
        set(None);
        assert!(store.get().mcp_active_project.is_none());
    }

    #[test]
    fn disconnecting_drops_the_write_grant() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        store.update(|s| s.mcp_write_clients = vec!["codex".into(), "opencode".into()]);

        // The tail of mcp_uninstall_client, after the config edit succeeded.
        store.update(|s| s.mcp_write_clients.retain(|g| g != "codex"));

        assert_eq!(store.get().mcp_write_clients, vec!["opencode".to_string()]);
    }
}

/// Whether MCP is also served over HTTP, and where.
///
/// The token is deliberately absent: it lives in a file only the user can read,
/// and sending it to the webview would undo that.
#[tauri::command]
pub fn mcp_http_status(state: tauri::State<SettingsStore>) -> crate::mcp::http::HttpStatus {
    crate::mcp::http::status(state.get().mcp_http_enabled)
}

/// Turn the HTTP listener on or off.
///
/// Turning it on starts it immediately; turning it off takes effect on the next
/// launch, because a listener already accepted connections and tearing it down
/// mid-request would drop somebody's tool call.
#[tauri::command]
pub fn mcp_set_http(
    state: tauri::State<SettingsStore>,
    enabled: bool,
) -> crate::mcp::http::HttpStatus {
    state.update(|s| s.mcp_http_enabled = enabled);
    if enabled {
        crate::mcp::http::start_if_enabled(true, crate::mcp::DEFAULT_CLIENT.to_string());
    }
    crate::mcp::http::status(enabled)
}
