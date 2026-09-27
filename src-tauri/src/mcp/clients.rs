//! Registering Versorium's MCP server with the agent the user already runs
//! (spec §6.4).
//!
//! Two strategies, chosen per client by which one is *safe*, not by which is
//! convenient:
//!
//! - **Shell out to the client's own CLI** (Claude Code, Codex). Their config
//!   files are live state the tool rewrites underneath us — `~/.claude.json` is
//!   rewritten every few seconds by a running session, and a duplicated
//!   `[mcp_servers.versorium]` TOML table makes Codex unparseable. Letting the
//!   tool edit its own file avoids both hazards and a TOML dependency.
//! - **Edit the JSON ourselves** (Claude Desktop has no CLI; OpenCode's is
//!   interactive-only). Parse, change one key, write atomically, keep a backup.
//!
//! Every write preserves the file's mode: these configs are 0600 and hold
//! third-party secrets in cleartext.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The server name we register under, in every client.
const ENTRY: &str = "versorium";
/// Suffix for the copy taken before a hand-edit.
const BACKUP_SUFFIX: &str = ".versorium-backup";
/// Registering is a local file edit; a client CLI that hangs is a bug, not work.
const CLI_TIMEOUT: Duration = Duration::from_secs(15);
/// Config files hold cleartext secrets, so anything we create starts private.
const PRIVATE_MODE: u32 = 0o600;

pub struct ClientInfo {
    pub id: &'static str,
    pub name: &'static str,
}

/// Stable order — the UI lists clients exactly like this.
pub fn catalog() -> Vec<ClientInfo> {
    vec![
        ClientInfo { id: "claude-code", name: "Claude Code" },
        ClientInfo { id: "claude-desktop", name: "Claude Desktop" },
        ClientInfo { id: "codex", name: "Codex" },
        ClientInfo { id: "opencode", name: "OpenCode" },
    ]
}

fn known(id: &str) -> Result<(), String> {
    catalog()
        .iter()
        .any(|c| c.id == id)
        .then_some(())
        .ok_or_else(|| "mcp_client_unknown".to_string())
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "no_home".to_string())
}

// ---------------------------------------------------------------- paths

/// Where OpenCode looks, in its documented precedence order. Pure so the
/// override handling is testable without touching the real environment.
fn opencode_path_from(config: Option<String>, dir: Option<String>, home: &Path) -> PathBuf {
    if let Some(explicit) = config.filter(|v| !v.is_empty()) {
        return PathBuf::from(explicit);
    }
    let base = dir
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config").join("opencode"));
    let json = base.join("opencode.json");
    // A user who keeps the commented variant must be told, not silently
    // rewritten — install() refuses a .jsonc target.
    if !json.exists() && base.join("opencode.jsonc").exists() {
        return base.join("opencode.jsonc");
    }
    json
}

fn claude_desktop_path(home: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home.join("Library/Application Support/Claude/claude_desktop_config.json")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"))
            .join("Claude/claude_desktop_config.json")
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        home.join(".config/Claude/claude_desktop_config.json")
    }
}

pub fn config_path(id: &str) -> Result<PathBuf, String> {
    known(id)?;
    let home = home()?;
    Ok(match id {
        "claude-code" => home.join(".claude.json"),
        "claude-desktop" => claude_desktop_path(&home),
        "codex" => std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"))
            .join("config.toml"),
        _ => opencode_path_from(
            std::env::var("OPENCODE_CONFIG").ok(),
            std::env::var("OPENCODE_CONFIG_DIR").ok(),
            &home,
        ),
    })
}

/// The JSON key holding the server map, for the two clients we edit by hand.
fn container_key(id: &str) -> &'static str {
    if id == "opencode" {
        "mcp"
    } else {
        "mcpServers"
    }
}

// ---------------------------------------------------------------- detection

pub fn detected(id: &str) -> bool {
    match id {
        "claude-code" => crate::agents::find_binary("claude").is_some(),
        "codex" => crate::agents::find_binary("codex").is_some(),
        "opencode" => crate::agents::find_binary("opencode").is_some(),
        // The desktop app has no CLI, so its own config directory is the signal.
        "claude-desktop" => config_path(id).map(|p| p.parent().is_some_and(Path::is_dir)).unwrap_or(false),
        _ => false,
    }
}

/// Is our entry already in that client's config?
pub fn installed(id: &str) -> bool {
    let Ok(path) = config_path(id) else { return false };
    match id {
        // Reading `~/.claude.json` is safe; only writing it is not.
        "claude-code" | "claude-desktop" | "opencode" => json_entry_present(&path, container_key(id)),
        "codex" => std::fs::read_to_string(&path)
            .map(|text| toml_table_present(&text))
            .unwrap_or(false),
        _ => false,
    }
}

/// A `[mcp_servers.versorium]` header, tolerating whitespace and quoting.
fn toml_table_present(text: &str) -> bool {
    text.lines().any(|line| {
        let line = line.trim();
        let Some(inner) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) else {
            return false;
        };
        let inner: String = inner.chars().filter(|c| !c.is_whitespace()).collect();
        inner == format!("mcp_servers.{ENTRY}") || inner == format!("mcp_servers.\"{ENTRY}\"")
    })
}

// ---------------------------------------------------------------- install

/// The entry each client expects. Shapes differ per client and are not
/// interchangeable: Claude Desktop rejects nothing but ignores `type`, and
/// OpenCode's schema is `additionalProperties: false` — an `args` or `env` key
/// there is a validation error, and its `command` is one array, not a pair.
fn json_entry(id: &str, binary: &Path) -> serde_json::Value {
    let bin = binary.to_string_lossy().to_string();
    if id == "opencode" {
        serde_json::json!({
            "type": "local",
            "command": [bin, "mcp", "--client", id],
            "enabled": true,
        })
    } else {
        serde_json::json!({
            "command": bin,
            "args": ["mcp", "--client", id],
            "env": {},
        })
    }
}

pub fn install(id: &str, binary: &Path) -> Result<(), String> {
    known(id)?;
    let path = config_path(id)?;
    match id {
        "claude-code" => {
            // `claude mcp add` refuses an existing name, so replace rather than
            // fail when the user reconnects after moving the binary.
            if installed(id) {
                let _ = uninstall(id);
            }
            run_client_cli(
                "claude",
                &["mcp", "add", "--scope", "user", ENTRY, "--", &binary.to_string_lossy(), "mcp", "--client", id],
            )
        }
        "codex" => {
            if installed(id) {
                let _ = uninstall(id);
            }
            run_client_cli(
                "codex",
                &["mcp", "add", ENTRY, "--", &binary.to_string_lossy(), "mcp", "--client", id],
            )
        }
        _ => upsert_json_entry(&path, container_key(id), json_entry(id, binary)),
    }
}

pub fn uninstall(id: &str) -> Result<(), String> {
    known(id)?;
    let path = config_path(id)?;
    match id {
        "claude-code" => run_client_cli("claude", &["mcp", "remove", "--scope", "user", ENTRY]),
        "codex" => run_client_cli("codex", &["mcp", "remove", ENTRY]),
        _ => remove_json_entry(&path, container_key(id)),
    }
}

/// Run a client's own CLI with a hard timeout. stdin is null so a prompt can
/// never hang us; stderr is dropped so a client's diagnostics never reach our
/// log (spec §12).
fn run_client_cli(bin: &str, args: &[&str]) -> Result<(), String> {
    let path = crate::agents::find_binary(bin).ok_or_else(|| "mcp_config_failed".to_string())?;
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "mcp_config_failed".to_string())?;
    let deadline = Instant::now() + CLI_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err("mcp_config_failed".into()),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("mcp_config_failed".into());
            }
            Err(_) => return Err("mcp_config_failed".into()),
        }
    }
}

// ---------------------------------------------------------------- json edits

fn json_entry_present(path: &Path, container: &str) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get(container).and_then(|c| c.get(ENTRY)).cloned())
        .is_some()
}

/// Read → parse → change one key → write. Never templated: these files also
/// hold the user's trusted folders, device pairing and provider settings, and
/// regenerating would delete them.
fn upsert_json_entry(path: &Path, container: &str, entry: serde_json::Value) -> Result<(), String> {
    if path.extension().is_some_and(|e| e == "jsonc") {
        return Err("mcp_config_jsonc".into());
    }
    let mut root = read_json_object(path)?;
    let map = root
        .entry(container.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let map = map.as_object_mut().ok_or_else(|| "mcp_config_failed".to_string())?;
    if map.get(ENTRY) == Some(&entry) {
        return Ok(()); // already registered exactly like this
    }
    map.insert(ENTRY.to_string(), entry);
    write_json_object(path, root)
}

fn remove_json_entry(path: &Path, container: &str) -> Result<(), String> {
    if path.extension().is_some_and(|e| e == "jsonc") {
        return Err("mcp_config_jsonc".into());
    }
    if !path.exists() {
        return Ok(());
    }
    let mut root = read_json_object(path)?;
    let Some(map) = root.get_mut(container).and_then(|c| c.as_object_mut()) else {
        return Ok(());
    };
    if map.remove(ENTRY).is_none() {
        return Ok(());
    }
    write_json_object(path, root)
}

/// A missing file is an empty object; a malformed one is an error, so we never
/// "repair" a config by overwriting content we failed to understand.
fn read_json_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(serde_json::Map::new());
    };
    if text.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(map)) => Ok(map),
        _ => Err("mcp_config_failed".into()),
    }
}

fn write_json_object(
    path: &Path,
    root: serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&serde_json::Value::Object(root))
        .map_err(|_| "mcp_config_failed".to_string())?;
    // Re-parse what we are about to commit: a serialization bug must not be
    // discovered by the user's agent failing to start.
    serde_json::from_str::<serde_json::Value>(&text).map_err(|_| "mcp_config_failed".to_string())?;

    // Captured before the write and carried into the replacement, so the new
    // bytes are never on disk at the umask default. A file we create ourselves
    // starts private: these configs hold third-party API keys in cleartext.
    let mode = crate::storage::file_mode(path).or(Some(PRIVATE_MODE));
    backup(path, mode)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "io".to_string())?;
    }
    crate::storage::atomic_write_mode(path, format!("{text}\n"), mode)
        .map_err(|_| "mcp_config_failed".to_string())
}

/// Copy the file aside before changing it. The copy holds the same secrets, so
/// it is created just as private as the original.
fn backup(path: &Path, mode: Option<u32>) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let content = std::fs::read(path).map_err(|_| "mcp_config_failed".to_string())?;
    let backup = path.with_file_name(format!(
        "{}{BACKUP_SUFFIX}",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    crate::storage::atomic_write_mode(&backup, content, mode)
        .map_err(|_| "mcp_config_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desktop_entry() -> serde_json::Value {
        json_entry("claude-desktop", Path::new("/usr/local/bin/versorium"))
    }

    #[test]
    fn catalog_is_stable_and_ids_are_validated() {
        let ids: Vec<&str> = catalog().iter().map(|c| c.id).collect();
        assert_eq!(ids, ["claude-code", "claude-desktop", "codex", "opencode"]);
        assert!(known("codex").is_ok());
        assert_eq!(known("cursor").unwrap_err(), "mcp_client_unknown");
        assert_eq!(config_path("cursor").unwrap_err(), "mcp_client_unknown");
    }

    #[test]
    fn writes_into_a_missing_file_and_keeps_it_private() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();

        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["versorium"]["command"], "/usr/local/bin/versorium");
        assert_eq!(v["mcpServers"]["versorium"]["args"][2], "claude-desktop");
        assert!(json_entry_present(&path, "mcpServers"));
        #[cfg(unix)]
        assert_eq!(
            crate::storage::file_mode(&path).unwrap() & 0o777,
            PRIVATE_MODE,
            "a config we create holds cleartext keys, so it is born private"
        );
    }

    #[test]
    fn unrelated_keys_survive_and_an_existing_entry_is_replaced_not_duplicated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        std::fs::write(
            &path,
            r#"{"globalShortcut":"Alt+C","preferences":{"trustedFolders":["/work"]},
                "mcpServers":{"pencil":{"command":"/bin/pencil"},
                              "versorium":{"command":"/old/versorium"}}}"#,
        )
        .unwrap();

        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(v["preferences"]["trustedFolders"][0], "/work");
        assert_eq!(v["globalShortcut"], "Alt+C");
        assert_eq!(v["mcpServers"]["pencil"]["command"], "/bin/pencil");
        assert_eq!(v["mcpServers"]["versorium"]["command"], "/usr/local/bin/versorium");
        assert_eq!(v["mcpServers"].as_object().unwrap().len(), 2, "replaced, not duplicated");
    }

    #[test]
    fn opencode_gets_its_own_shape_with_no_args_or_env_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.json");
        std::fs::write(&path, r#"{"$schema":"https://opencode.ai/config.json","model":"x"}"#).unwrap();

        upsert_json_entry(&path, "mcp", json_entry("opencode", Path::new("/bin/versorium"))).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        let entry = &v["mcp"]["versorium"];
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["command"][0], "/bin/versorium");
        assert_eq!(entry["command"][3], "opencode");
        assert_eq!(entry["enabled"], true);
        // additionalProperties: false — these keys would fail OpenCode's schema.
        assert!(entry.get("args").is_none());
        assert!(entry.get("env").is_none());
        assert_eq!(v["model"], "x", "unrelated config survives");
        assert!(v.get("mcpServers").is_none(), "OpenCode nests under `mcp`");
    }

    #[test]
    fn a_commented_config_is_refused_rather_than_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.jsonc");
        std::fs::write(&path, "{\n // keep me\n \"mcp\": {}\n}").unwrap();

        assert_eq!(
            upsert_json_entry(&path, "mcp", desktop_entry()).unwrap_err(),
            "mcp_config_jsonc"
        );
        assert_eq!(remove_json_entry(&path, "mcp").unwrap_err(), "mcp_config_jsonc");
        assert!(std::fs::read_to_string(&path).unwrap().contains("// keep me"));
    }

    #[test]
    fn a_malformed_config_fails_without_destroying_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        let original = "{ this is not json";
        std::fs::write(&path, original).unwrap();

        assert_eq!(
            upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap_err(),
            "mcp_config_failed"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(!path.with_extension("json.versorium-backup").exists());
    }

    #[test]
    fn a_backup_is_taken_before_the_edit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        std::fs::write(&path, r#"{"preferences":{"a":1}}"#).unwrap();

        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        let backup = dir.path().join(format!("claude_desktop_config.json{BACKUP_SUFFIX}"));
        assert!(backup.exists());
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&backup).unwrap()).unwrap();
        assert!(saved.get("mcpServers").is_none(), "backup predates the edit");
        assert_eq!(saved["preferences"]["a"], 1);
    }

    /// The config and its backup both carry third-party API keys in cleartext,
    /// so neither may ever exist at the umask default — not even briefly.
    #[cfg(unix)]
    #[test]
    fn neither_the_config_nor_its_backup_widens_from_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        let backup = dir.path().join(format!("claude_desktop_config.json{BACKUP_SUFFIX}"));
        let mode = |p: &Path| crate::storage::file_mode(p).unwrap() & 0o777;

        // Created by us: private from the moment it exists.
        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        assert_eq!(mode(&path), PRIVATE_MODE);

        // Rewriting a 0600 file round-trips the mode, and the backup matches.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        upsert_json_entry(&path, "mcpServers", json_entry("claude-desktop", Path::new("/new/bin")))
            .unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&backup), 0o600, "the backup holds the same secrets");

        // A user who deliberately loosened the file keeps their choice.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        upsert_json_entry(&path, "mcpServers", json_entry("claude-desktop", Path::new("/third")))
            .unwrap();
        assert_eq!(mode(&path), 0o640, "an existing mode is round-tripped, not forced");
        assert_eq!(mode(&backup), 0o640);

        // Removal writes through the same path and must not widen either.
        remove_json_entry(&path, "mcpServers").unwrap();
        assert_eq!(mode(&path), 0o640);
    }

    #[test]
    fn uninstall_removes_only_our_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        std::fs::write(&path, r#"{"mcpServers":{"pencil":{"command":"/bin/pencil"}},"globalShortcut":"Alt+C"}"#).unwrap();

        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        assert!(json_entry_present(&path, "mcpServers"));

        remove_json_entry(&path, "mcpServers").unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(v["mcpServers"].get("versorium").is_none());
        assert_eq!(v["mcpServers"]["pencil"]["command"], "/bin/pencil");
        assert_eq!(v["globalShortcut"], "Alt+C");
        // Removing twice, or from a file that never had it, is not an error.
        remove_json_entry(&path, "mcpServers").unwrap();
        remove_json_entry(&dir.path().join("absent.json"), "mcpServers").unwrap();
    }

    #[test]
    fn rewriting_an_identical_entry_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();

        upsert_json_entry(&path, "mcpServers", desktop_entry()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
        // No second backup means the file was never touched again.
        assert!(!dir.path().join(format!("claude_desktop_config.json{BACKUP_SUFFIX}")).exists());
    }

    #[test]
    fn opencode_honours_its_overrides_and_flags_a_commented_file() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();

        let explicit = opencode_path_from(Some("/tmp/custom.json".into()), None, home);
        assert_eq!(explicit, PathBuf::from("/tmp/custom.json"));

        let from_dir = opencode_path_from(None, Some(home.to_string_lossy().into()), home);
        assert_eq!(from_dir, home.join("opencode.json"));

        assert_eq!(
            opencode_path_from(None, None, home),
            home.join(".config/opencode/opencode.json")
        );

        // With only a .jsonc present we point at it so install() can refuse.
        let base = home.join(".config/opencode");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("opencode.jsonc"), "{}").unwrap();
        assert_eq!(opencode_path_from(None, None, home), base.join("opencode.jsonc"));
    }

    #[test]
    fn codex_table_detection_tolerates_quoting_and_whitespace() {
        assert!(toml_table_present("[mcp_servers.versorium]"));
        assert!(toml_table_present("  [ mcp_servers.versorium ]  "));
        assert!(toml_table_present("[mcp_servers.\"versorium\"]"));
        assert!(!toml_table_present("[mcp_servers.versorium_old]"));
        assert!(!toml_table_present("[mcp_servers.pencil]"));
        assert!(!toml_table_present("command = \"[mcp_servers.versorium]\""));
    }
}
