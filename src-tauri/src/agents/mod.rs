//! Agent detection + rewrite invocation (M2).
//!
//! Detection: look for CLI harnesses on PATH, then in the usual install dirs
//! (claude, codex, opencode, ollama, gh) — the app may be launched without the
//! login shell's PATH.
//! Invocation order per action: CLI harness → (M3: MCP write-back) → (M4: BYOK / local).
//!
//! Detection is best-effort: a binary on PATH is "connected" (the harness manages
//! its own auth); the Ollama daemon is checked over its local API.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Cap for a rewrite call — a full passage through a CLI harness.
const CLI_TIMEOUT: Duration = Duration::from_secs(120);
/// Cap for `--version` probes during detection.
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// Cap for a question to a daemon that is already running locally.
const OLLAMA_API_TIMEOUT: Duration = Duration::from_secs(10);
/// Ollama daemon address (local only, per spec §6.2).
const OLLAMA_URL: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    /// `claude` | `codex` | `opencode` | `ollama` | `gh`
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    /// `connected` (usable now) | `detected` (binary present, not usable) | `missing`
    pub state: String,
    /// Ollama only: models served by the daemon.
    pub models: Option<Vec<String>>,
}

/// Candidate file names for a binary. Windows resolves `claude` to
/// `claude.cmd` (npm shim) or `claude.exe`; unix uses the bare name.
fn candidate_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            name.to_string(),
            format!("{name}.exe"),
            format!("{name}.cmd"),
            format!("{name}.bat"),
        ]
    } else {
        vec![name.to_string()]
    }
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// First directory in `dirs` holding an executable named `name`.
pub fn find_in_dirs(name: &str, dirs: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    let names = candidate_names(name);
    dirs.into_iter()
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|cand| is_executable(cand))
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

/// Version-manager shims keep one `bin` per installed toolchain; newest first
/// so a freshly installed CLI wins over a stale copy.
fn versioned_bins(parent: PathBuf) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(&parent) else {
        return Vec::new();
    };
    let mut versions: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort();
    versions.reverse();
    versions.into_iter().map(|v| v.join("bin")).collect()
}

/// Where installers drop CLIs when the login shell's PATH is not inherited
/// (app launched from Finder / Explorer / a launcher).
fn well_known_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        if let Some(local) = var("LOCALAPPDATA") {
            dirs.push(local.join("Programs").join("Ollama"));
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Some(roaming) = var("APPDATA") {
            dirs.push(roaming.join("npm"));
        }
        if let Some(home) = var("USERPROFILE") {
            dirs.push(home.join(".cargo").join("bin"));
            dirs.push(home.join(".bun").join("bin"));
        }
        if let Some(pf) = var("ProgramFiles") {
            dirs.push(pf.join("GitHub CLI"));
            dirs.push(pf.join("Ollama"));
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join(".local/bin"));
            dirs.push(home.join(".cargo/bin"));
            dirs.push(home.join(".bun/bin"));
            dirs.push(home.join(".volta/bin"));
            dirs.push(home.join(".npm-global/bin"));
            dirs.extend(versioned_bins(home.join(".nvm/versions/node")));
            dirs.push(home.join(".fnm/aliases/default/bin"));
        }
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/opt/local/bin"));
        dirs.push(PathBuf::from("/snap/bin"));
        #[cfg(target_os = "macos")]
        {
            dirs.push(PathBuf::from("/Applications/Ollama.app/Contents/Resources"));
            dirs.push(PathBuf::from("/usr/local/opt/ollama/bin"));
        }
    }
    dirs
}

/// Find an executable: PATH first, then the well-known install dirs.
pub fn find_binary(name: &str) -> Option<PathBuf> {
    find_in_dirs(name, path_dirs()).or_else(|| find_in_dirs(name, well_known_dirs()))
}

/// Run a command with a hard timeout. Returns trimmed stdout, or None on
/// spawn failure / timeout / read error. stdin is null; stderr is discarded
/// (crash logs must never carry manuscript text, spec §7.7).
fn run_capped(bin: &Path, args: &[String], timeout: Duration) -> Option<String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        if stdout.read_to_string(&mut s).is_err() {
            return;
        }
        let _ = tx.send(s);
    });
    match rx.recv_timeout(timeout) {
        Ok(out) => {
            let _ = child.wait();
            let out = out.trim().to_string();
            (!out.is_empty()).then_some(out)
        }
        Err(_) => {
            child.kill().ok();
            let _ = child.wait();
            None
        }
    }
}

fn version_of(bin: &Path) -> Option<String> {
    run_capped(bin, &["--version".to_string()], VERSION_TIMEOUT)
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        .filter(|s| !s.is_empty())
}

/// Detect the agent harnesses (PATH + well-known dirs). Ollama's daemon
/// state is merged in separately (it is a network check, not a PATH check).
/// Version probes run in parallel; each is capped at VERSION_TIMEOUT.
pub fn detect_binaries() -> Vec<AgentInfo> {
    const SPECS: [(&str, &str); 5] = [
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("opencode", "OpenCode"),
        ("ollama", "Ollama"),
        ("gh", "GitHub CLI"),
    ];
    std::thread::scope(|scope| {
        let handles: Vec<_> = SPECS
            .iter()
            .map(|(id, name)| {
                scope.spawn(move || match find_binary(id) {
                    Some(p) => AgentInfo {
                        id: (*id).to_string(),
                        name: (*name).to_string(),
                        path: Some(p.to_string_lossy().into_owned()),
                        version: version_of(&p),
                        // For ollama, the caller upgrades to "connected" when the
                        // daemon answers; a binary alone is "detected".
                        state: if *id == "ollama" { "detected" } else { "connected" }
                            .to_string(),
                        models: None,
                    },
                    None => AgentInfo {
                        id: (*id).to_string(),
                        name: (*name).to_string(),
                        path: None,
                        version: None,
                        state: "missing".to_string(),
                        models: None,
                    },
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("detect thread panicked"))
            .collect()
    })
}

/// Check the local Ollama daemon. Returns (online, model names).
pub async fn ollama_status() -> (bool, Vec<String>) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return (false, Vec::new());
    };
    match client.get(format!("{OLLAMA_URL}/api/tags")).send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                let models = v["models"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|m| m["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                (true, models)
            }
            Err(_) => (true, Vec::new()),
        },
        _ => (false, Vec::new()),
    }
}

/// Models the daemon has pulled: (name, size in bytes, modified timestamp).
/// Empty when the daemon is offline — callers already know that from
/// `ollama_status`, so an unreachable daemon is not an error here.
pub async fn ollama_models() -> Vec<(String, u64, String)> {
    let Ok(client) = reqwest::Client::builder().timeout(OLLAMA_API_TIMEOUT).build() else {
        return Vec::new();
    };
    let Ok(response) = client.get(format!("{OLLAMA_URL}/api/tags")).send().await else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let Ok(body) = response.json::<serde_json::Value>().await else {
        return Vec::new();
    };
    body["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    let name = m["name"].as_str()?.to_string();
                    Some((
                        name,
                        m["size"].as_u64().unwrap_or(0),
                        m["modified_at"].as_str().unwrap_or_default().to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pull a model. This downloads gigabytes, so the request carries no overall
/// deadline — only a connect timeout. Progress arrives as NDJSON, which is read
/// to completion so the call returns when the pull is really finished.
pub async fn ollama_pull(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("bad_args".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(OLLAMA_API_TIMEOUT)
        .build()
        .map_err(|_| "network".to_string())?;
    let mut response = client
        .post(format!("{OLLAMA_URL}/api/pull"))
        // `model` is the current field name; `name` is kept for older daemons,
        // which ignore the one they do not know.
        .json(&serde_json::json!({ "model": name, "name": name, "stream": true }))
        .send()
        .await
        .map_err(|_| "ollama_offline".to_string())?;
    if !response.status().is_success() {
        return Err("ollama_failed".into());
    }
    // A pull can fail midway with a 200 and an {"error": …} line, so the stream
    // has to be read rather than trusted.
    let mut tail = String::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network".to_string())? {
        tail.push_str(&String::from_utf8_lossy(&chunk));
        if let Some(cut) = tail.rfind('\n') {
            let complete: String = tail.drain(..=cut).collect();
            if let Some(error) = first_ndjson_error(&complete) {
                return Err(error);
            }
        }
    }
    if let Some(error) = first_ndjson_error(&tail) {
        return Err(error);
    }
    Ok(())
}

/// `ollama_failed` when any line reports an error; the daemon's own message is
/// not surfaced because these codes are localized on the frontend.
fn first_ndjson_error(text: &str) -> Option<String> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|v| v.get("error").is_some())
        .map(|_| "ollama_failed".to_string())
}

pub async fn ollama_delete(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("bad_args".into());
    }
    let client = reqwest::Client::builder()
        .timeout(OLLAMA_API_TIMEOUT)
        .build()
        .map_err(|_| "network".to_string())?;
    let response = client
        .delete(format!("{OLLAMA_URL}/api/delete"))
        .json(&serde_json::json!({ "model": name, "name": name }))
        .send()
        .await
        .map_err(|_| "ollama_offline".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("ollama_failed".into())
    }
}

/// The editor prompt sent to a rewrite provider. The passage is the user's
/// own text; the prompt never asks for new content (selection-only, spec §17).
pub fn rewrite_prompt(text: &str) -> String {
    format!(
        "You are a careful fiction editor. Rewrite the passage below to improve clarity, rhythm and voice.\n\
         Rules:\n\
         - Keep the original language exactly as written.\n\
         - Keep all names, places and facts unchanged.\n\
         - Keep the length within ±20% of the original.\n\
         - Return ONLY the rewritten passage. No commentary, no quotes, no headings.\n\n\
         PASSAGE:\n{text}"
    )
}

/// Rewrite `text` with the given provider. Errors are stable codes:
/// `no_provider` (binary missing / unknown id), `ai_failed` (spawn, timeout
/// or daemon failure), `ai_empty` (empty result).
pub async fn rewrite(provider: &str, text: &str) -> Result<String, String> {
    match provider {
        "claude" => cli_rewrite("claude", &["-p"], text).await,
        "codex" => cli_rewrite("codex", &["exec"], text).await,
        "opencode" => cli_rewrite("opencode", &["run"], text).await,
        "ollama" => ollama_rewrite(text).await,
        _ => Err("no_provider".to_string()),
    }
}

async fn cli_rewrite(bin: &str, args: &[&str], text: &str) -> Result<String, String> {
    let prompt = rewrite_prompt(text);
    let path = find_binary(bin).ok_or_else(|| "no_provider".to_string())?;
    let mut all: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    all.push(prompt);
    let out = tauri::async_runtime::spawn_blocking(move || run_capped(&path, &all, CLI_TIMEOUT))
        .await
        .map_err(|_| "io".to_string())?
        .ok_or_else(|| "ai_failed".to_string())?;
    Ok(out)
}

async fn ollama_rewrite(text: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "ai_failed".to_string())?;
    // First model the daemon serves (model picker is M4).
    let tags: serde_json::Value = client
        .get(format!("{OLLAMA_URL}/api/tags"))
        .send()
        .await
        .map_err(|_| "ai_failed".to_string())?
        .json()
        .await
        .map_err(|_| "ai_failed".to_string())?;
    let model = tags["models"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|m| m["name"].as_str())
        .unwrap_or("llama3.1")
        .to_string();
    let resp = client
        .post(format!("{OLLAMA_URL}/api/generate"))
        .json(&serde_json::json!({
            "model": model,
            "prompt": rewrite_prompt(text),
            "stream": false,
        }))
        .send()
        .await
        .map_err(|_| "ai_failed".to_string())?;
    let v: serde_json::Value = resp.json().await.map_err(|_| "ai_failed".to_string())?;
    let out = v["response"].as_str().unwrap_or("").trim().to_string();
    if out.is_empty() {
        return Err("ai_empty".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real harnesses on this machine (not run in CI): `cargo test -- --ignored live_`.
    #[test]
    #[ignore = "talks to the agents installed on this machine"]
    fn live_detect_and_rewrite_with_installed_agents() {
        let agents = detect_binaries();
        for a in &agents {
            eprintln!("{:<10} {:<10} {:?} {:?}", a.id, a.state, a.version, a.path);
        }
        let (online, models) = tauri::async_runtime::block_on(ollama_status());
        eprintln!("ollama daemon online={online} models={models:?}");

        let passage = "La niña esperó junto a la ventana toda la noche, pero nadie vino.";
        for provider in ["ollama", "claude"] {
            let usable = agents.iter().any(|a| a.id == provider && a.state != "missing")
                && (provider != "ollama" || online);
            if !usable {
                eprintln!("{provider}: skipped (not usable here)");
                continue;
            }
            let out = tauri::async_runtime::block_on(rewrite(provider, passage))
                .unwrap_or_else(|e| panic!("{provider} rewrite failed: {e}"));
            eprintln!("{provider} → {out}");
            assert!(!out.trim().is_empty(), "{provider} returned nothing");
            assert_ne!(out.trim(), passage, "{provider} returned the passage unchanged");
        }
    }

    #[test]
    #[ignore = "talks to the Ollama daemon on this machine"]
    fn live_ollama_lists_and_round_trips_a_tiny_model() {
        let (online, _) = tauri::async_runtime::block_on(ollama_status());
        if !online {
            eprintln!("ollama offline: skipped");
            return;
        }
        let models = tauri::async_runtime::block_on(ollama_models());
        for (name, size, modified) in &models {
            eprintln!("{name:<30} {size:>14} {modified}");
        }
        assert!(!models.is_empty(), "a running daemon with no models is unexpected here");
        assert!(models.iter().all(|(n, _, _)| !n.is_empty()));
        // An unknown tag must fail rather than hang or silently succeed.
        assert_eq!(
            tauri::async_runtime::block_on(ollama_pull("versorium-does-not-exist:1b")).unwrap_err(),
            "ollama_failed"
        );
    }

    #[test]
    fn an_empty_model_name_never_reaches_the_daemon() {
        assert_eq!(
            tauri::async_runtime::block_on(ollama_pull("   ")).unwrap_err(),
            "bad_args"
        );
        assert_eq!(
            tauri::async_runtime::block_on(ollama_delete("")).unwrap_err(),
            "bad_args"
        );
    }

    #[test]
    fn a_pull_that_reports_an_error_midstream_is_a_failure() {
        // Ollama answers 200 and then streams the failure, so success cannot be
        // inferred from the status code alone.
        let stream = "{\"status\":\"pulling manifest\"}\n{\"error\":\"model not found\"}\n";
        assert_eq!(first_ndjson_error(stream).as_deref(), Some("ollama_failed"));
        assert!(first_ndjson_error("{\"status\":\"success\"}\n").is_none());
        assert!(first_ndjson_error("").is_none());
        // A half-written line must not be mistaken for a failure.
        assert!(first_ndjson_error("{\"status\":\"downloading\",\"compl").is_none());
    }

    #[test]
    fn rewrite_prompt_contains_passage_and_rules() {
        let p = rewrite_prompt("The long winter came.");
        assert!(p.contains("The long winter came."));
        assert!(p.contains("ONLY the rewritten passage"));
        assert!(p.contains("original language"));
    }

    #[test]
    fn find_in_path_finds_shell() {
        // `sh` exists on every sane PATH; a nonsense name must not resolve.
        assert!(find_in_dirs("sh", path_dirs()).is_some());
        assert!(find_binary("sh").is_some());
        assert!(find_binary("versorium-does-not-exist-xyz").is_none());
    }

    #[test]
    fn find_in_dirs_scans_given_dirs_in_order() {
        let empty = tempfile::tempdir().unwrap();
        let bin = tempfile::tempdir().unwrap();
        let exe = bin.path().join(if cfg!(windows) { "fakecli.exe" } else { "fakecli" });
        std::fs::write(&exe, "#!/bin/sh\necho 1.0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let dirs = || [empty.path().to_path_buf(), bin.path().to_path_buf()];
        assert_eq!(find_in_dirs("fakecli", dirs()), Some(exe.clone()));
        assert!(find_in_dirs("othercli", dirs()).is_none());
        // A directory named like the binary is not a match.
        std::fs::create_dir(bin.path().join("dircli")).unwrap();
        assert!(find_in_dirs("dircli", dirs()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn find_in_dirs_requires_executable_bit() {
        let bin = tempfile::tempdir().unwrap();
        let plain = bin.path().join("notexec");
        std::fs::write(&plain, "data").unwrap();
        assert!(find_in_dirs("notexec", [bin.path().to_path_buf()]).is_none());
    }

    #[test]
    fn detect_binaries_reports_all_five_specs() {
        let found = detect_binaries();
        let ids: Vec<&str> = found.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["claude", "codex", "opencode", "ollama", "gh"]);
        for a in &found {
            match a.state.as_str() {
                "missing" => assert!(a.path.is_none()),
                "connected" | "detected" => assert!(a.path.is_some()),
                other => panic!("unexpected state {other}"),
            }
        }
    }
}
