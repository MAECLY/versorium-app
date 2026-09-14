//! Agent detection + rewrite invocation (M2).
//!
//! Detection: look for CLI harnesses on PATH (claude, codex, opencode, ollama, gh).
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

/// Find an executable on PATH. Returns the first match.
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let cand = dir.join(name);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
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

/// Detect the agent harnesses on PATH. Ollama's daemon state is merged in
/// separately (it is a network check, not a PATH check).
pub fn detect_binaries() -> Vec<AgentInfo> {
    const SPECS: [(&str, &str); 5] = [
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("opencode", "OpenCode"),
        ("ollama", "Ollama"),
        ("gh", "GitHub CLI"),
    ];
    SPECS
        .iter()
        .map(|(id, name)| match find_in_path(id) {
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
        .collect()
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
    let path = find_in_path(bin).ok_or_else(|| "no_provider".to_string())?;
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
        assert!(find_in_path("sh").is_some());
        assert!(find_in_path("versorium-does-not-exist-xyz").is_none());
    }
}
