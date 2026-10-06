//! Agent detection + rewrite invocation (M2).
//!
//! Detection: look for CLI harnesses on PATH, then in the usual install dirs
//! (claude, codex, opencode, ollama, gh) — the app may be launched without the
//! login shell's PATH.
//! Invocation order per action: CLI harness → (M3: MCP write-back) → (M4: BYOK / local).
//!
//! Detection is best-effort: a binary on PATH is "connected" (the harness manages
//! its own auth); the Ollama daemon is checked over its local API.
//!
//! A task can also run on the local server the writer saved in Settings →
//! Models (LM Studio, llama-server: anything serving the OpenAI API). It is
//! reached only once saved, and only at the address saved.

use crate::commands::settings::{Settings, SlotAssignment};
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
/// Cap for a rewrite through the local daemon — slower than a CLI harness on
/// a cold model, because the weights have to be paged in first.
const OLLAMA_GENERATE_TIMEOUT: Duration = Duration::from_secs(180);
/// Ollama daemon address (local only, per spec §6.2).
const OLLAMA_URL: &str = "http://127.0.0.1:11434";
/// Cap for asking the saved local server what it serves. Settings asks on
/// every visit, so a server that is off must not hold the page for long.
const SERVER_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// Cap for a rewrite through the local server, which may have to load the
/// model first, as Ollama does.
const SERVER_GENERATE_TIMEOUT: Duration = Duration::from_secs(180);

/// The OpenAI-compatible server the writer saved (Settings → Models → Local
/// server). Built only from a saved address (`saved_server`), so nothing in
/// Versorium reaches a server the writer did not point it at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalServer {
    pub host: String,
    pub port: u16,
}

impl LocalServer {
    fn url(&self, path: &str) -> String {
        // An IPv6 literal needs its brackets in a URL; `::1` is a loopback a
        // writer may well type.
        if self.host.contains(':') && !self.host.starts_with('[') {
            format!("http://[{}]:{}{path}", self.host, self.port)
        } else {
            format!("http://{}:{}{path}", self.host, self.port)
        }
    }
}

/// 127.0.0.0/8, `::1` and `localhost`: an address on this computer. The same
/// rule as `isLoopback` in `src/lib/settings/ai/picks.ts`, which says so in
/// Settings.
pub fn is_loopback(host: &str) -> bool {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Two spellings of one host: case, spaces and IPv6 brackets aside.
pub fn same_host(a: &str, b: &str) -> bool {
    let bare = |h: &str| h.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    bare(a) == bare(b)
}

/// The local server, if the writer saved one.
pub fn saved_server(settings: &Settings) -> Option<LocalServer> {
    settings.studio_enabled.then(|| LocalServer {
        host: settings.studio_host.clone(),
        port: settings.studio_port,
    })
}

/// Whether the server answers, and the ids of the models it serves
/// (`GET /v1/models`, read as OpenAI's `data[].id`).
pub async fn server_status(server: &LocalServer) -> (bool, Vec<String>) {
    let Ok(client) = reqwest::Client::builder().timeout(SERVER_PROBE_TIMEOUT).build() else {
        return (false, Vec::new());
    };
    match client.get(server.url("/v1/models")).send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                let models = v["data"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect())
                    .unwrap_or_default();
                (true, models)
            }
            Err(_) => (true, Vec::new()),
        },
        _ => (false, Vec::new()),
    }
}

/// One non-streaming chat completion from the local server, trimmed.
///
/// A reasoning block is taken out, as it is for a built-in model: a server
/// serving Qwen3 answers `<think>…</think>` first, and splicing that into a
/// chapter would be worse than any refusal. Shared with the continuity pass,
/// which waits longer.
pub async fn server_generate(
    server: &LocalServer,
    model: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| "ai_failed".to_string())?;
    let response = client
        .post(server.url("/v1/chat/completions"))
        .json(&serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "stream": false,
        }))
        .send()
        .await
        .map_err(|_| "ai_failed".to_string())?;
    if !response.status().is_success() {
        return Err("ai_failed".into());
    }
    let body: serde_json::Value = response.json().await.map_err(|_| "ai_failed".to_string())?;
    let text = body["choices"][0]["message"]["content"].as_str().unwrap_or("");
    Ok(crate::llama::runtime::strip_reasoning(text))
}

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
    run_capped_in(bin, args, None, timeout)
}

fn run_capped_in(bin: &Path, args: &[String], dir: Option<&Path>, timeout: Duration) -> Option<String> {
    let mut command = Command::new(bin);
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    let mut child = command
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

/// The CLI harnesses that can rewrite prose, and the flag that makes each one
/// answer a single prompt and exit. `gh` is not here: it is for git, not prose.
/// Codex refuses to run outside a git repository it trusts, and a harness
/// always runs in an empty scratch folder (`cli_rewrite`), hence its flag.
const CLI_HARNESSES: [(&str, &[&str]); 3] = [
    ("claude", &["-p"]),
    ("codex", &["exec", "--skip-git-repo-check"]),
    ("opencode", &["run"]),
];

/// Rewrite `text` with the model assigned to a slot. Errors are stable codes:
/// `no_provider` (nothing assigned, a harness that is not installed, a model
/// the daemon or the server no longer serves, a server that is not saved),
/// `not_ready` (a `builtin` slot whose weights are not fully downloaded),
/// `model_too_large` (the machine cannot hold it), `llama_busy`,
/// `ollama_offline`, `server_offline` (the saved server does not answer),
/// `ai_failed` (spawn, timeout or daemon failure), `ai_empty` (empty result).
///
/// Dispatch is on the assignment rather than on a bare provider name, because
/// a name cannot say *which* model: "ollama" alone left this picking whatever
/// the daemon happened to list first, which is not what the writer chose.
/// `server` is the saved local server (`saved_server`), or None when there is
/// none, in which case a `server` slot is refused without a request.
pub async fn rewrite(
    slot: &SlotAssignment,
    text: &str,
    server: Option<&LocalServer>,
) -> Result<String, String> {
    let id = slot.id.trim();
    match slot.kind.as_str() {
        "cli" => match CLI_HARNESSES.iter().find(|(bin, _)| *bin == id) {
            Some((bin, args)) => cli_rewrite(bin, args, text).await,
            None => Err("no_provider".to_string()),
        },
        "ollama" if !id.is_empty() => ollama_rewrite(id, text).await,
        "builtin" if !id.is_empty() => builtin_rewrite(id, text).await,
        "server" if !id.is_empty() => server_rewrite(server, id, text).await,
        _ => Err("no_provider".to_string()),
    }
}

/// Rewrite through the saved local server, the same checks in the same order
/// as Ollama: is it there, does it still serve this model, then ask.
async fn server_rewrite(server: Option<&LocalServer>, model: &str, text: &str) -> Result<String, String> {
    // Never saved, or forgotten: nothing is sent to an address the writer
    // did not keep.
    let Some(server) = server else {
        return Err("no_provider".to_string());
    };
    let (answering, served) = server_status(server).await;
    if !answering {
        return Err("server_offline".to_string());
    }
    // The server's model list changes outside the app; a substitute would be
    // worse than a refusal.
    if !served.iter().any(|m| m == model) {
        return Err("no_provider".to_string());
    }
    let out = server_generate(server, model, &rewrite_prompt(text), SERVER_GENERATE_TIMEOUT).await?;
    if out.is_empty() {
        return Err("ai_empty".to_string());
    }
    Ok(out)
}

async fn cli_rewrite(bin: &str, args: &[&str], text: &str) -> Result<String, String> {
    let prompt = rewrite_prompt(text);
    let path = find_binary(bin).ok_or_else(|| "no_provider".to_string())?;
    let mut all: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    all.push(prompt);
    let out = tauri::async_runtime::spawn_blocking(move || {
        // An app opened from the Finder or the Start menu starts in `/` or
        // System32: Codex refuses to run there, and any harness would read
        // whatever project instructions it found around it. An empty folder
        // of its own gives the passage and nothing else.
        let scratch = scratch_dir().ok()?;
        let out = run_capped_in(&path, &all, Some(&scratch), CLI_TIMEOUT);
        let _ = std::fs::remove_dir_all(&scratch);
        out
    })
    .await
    .map_err(|_| "io".to_string())?
    .ok_or_else(|| "ai_failed".to_string())?;
    Ok(out)
}

/// A new, empty folder under the system temp directory for one harness run.
fn scratch_dir() -> std::io::Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!("versorium-cli-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Rewrite through the in-process engine.
///
/// Blocking work, so it goes to a blocking thread exactly like a CLI harness
/// does; the engine has its own worker thread behind that.
async fn builtin_rewrite(id: &str, text: &str) -> Result<String, String> {
    let prompt = rewrite_prompt(text);
    let id = id.to_string();
    tauri::async_runtime::spawn_blocking(move || crate::llama::generate(&id, &prompt))
        .await
        .map_err(|_| "io".to_string())?
}

async fn ollama_rewrite(model: &str, text: &str) -> Result<String, String> {
    let (online, served) = ollama_status().await;
    if !online {
        return Err("ollama_offline".to_string());
    }
    // A slot can outlive the model it names — `ollama rm` happens outside the
    // app. Rewriting with a substitute would be worse than refusing.
    if !served.iter().any(|m| m == model) {
        return Err("no_provider".to_string());
    }
    let out = ollama_generate(model, &rewrite_prompt(text), OLLAMA_GENERATE_TIMEOUT).await?;
    if out.is_empty() {
        return Err("ai_empty".to_string());
    }
    Ok(out)
}

/// One non-streaming completion from the local daemon, trimmed.
///
/// Shared with the continuity pass, which wants the same call with a longer
/// deadline: a whole-novel summary is not a paragraph.
pub async fn ollama_generate(
    model: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| "ai_failed".to_string())?;
    let response = client
        .post(format!("{OLLAMA_URL}/api/generate"))
        .json(&serde_json::json!({ "model": model, "prompt": prompt, "stream": false }))
        .send()
        .await
        .map_err(|_| "ai_failed".to_string())?;
    let body: serde_json::Value =
        response.json().await.map_err(|_| "ai_failed".to_string())?;
    Ok(ollama_answer(&body))
}

/// The prose in Ollama's `/api/generate` answer. A model that thinks out loud
/// (Qwen3, DeepSeek-R1…) can put its `<think>…</think>` in `response`,
/// depending on the model and on Ollama's version; it is taken out here as the
/// built-in engine and the local server do, so it never reaches a chapter.
fn ollama_answer(body: &serde_json::Value) -> String {
    crate::llama::runtime::strip_reasoning(body["response"].as_str().unwrap_or(""))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, Read, Write};
    use std::sync::{Arc, Mutex};

    /// A loopback stand-in for LM Studio or llama-server. `GET /v1/models`
    /// lists `models`; `POST /v1/chat/completions` answers `answer`. Every
    /// request is kept as (method and path, body), so a test can see what was
    /// sent and that nothing was. Detached: it lives as long as the process.
    pub(crate) struct FakeServer {
        pub server: LocalServer,
        seen: Arc<Mutex<Vec<(String, String)>>>,
    }

    /// The HTTP status each endpoint answers with. Anything but 200 comes with
    /// an OpenAI-style error body, which parses as JSON: what a real server
    /// sends when a model crashes or is not loaded, so only the status says
    /// that it failed.
    #[derive(Clone, Copy)]
    pub(crate) struct Statuses {
        pub models: u16,
        pub completion: u16,
    }

    impl FakeServer {
        pub(crate) fn start(models: &[&str], answer: &str) -> Self {
            Self::start_with(models, answer, Statuses { models: 200, completion: 200 })
        }

        pub(crate) fn start_with(models: &[&str], answer: &str, statuses: Statuses) -> Self {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let port = listener.local_addr().unwrap().port();
            let seen: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
            let listing = serde_json::json!({
                "object": "list",
                "data": models.iter().map(|id| serde_json::json!({ "id": id, "object": "model" })).collect::<Vec<_>>(),
            })
            .to_string();
            let completion = serde_json::json!({
                "choices": [{ "index": 0, "message": { "role": "assistant", "content": answer } }],
            })
            .to_string();
            let log = seen.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { continue };
                    let Ok(clone) = stream.try_clone() else { continue };
                    let mut reader = std::io::BufReader::new(clone);
                    let mut first = String::new();
                    if reader.read_line(&mut first).is_err() {
                        continue;
                    }
                    let mut words = first.split_whitespace();
                    let method = words.next().unwrap_or_default().to_string();
                    let path = words.next().unwrap_or_default().to_string();
                    let mut length = 0usize;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                            break;
                        }
                        if let Some((key, value)) = line.split_once(':') {
                            if key.eq_ignore_ascii_case("content-length") {
                                length = value.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    let mut body = vec![0u8; length];
                    let _ = reader.read_exact(&mut body);
                    log.lock().unwrap().push((format!("{method} {path}"), String::from_utf8_lossy(&body).into_owned()));
                    let payload = match (method.as_str(), path.as_str()) {
                        ("GET", "/v1/models") => Some((statuses.models, &listing)),
                        ("POST", "/v1/chat/completions") => Some((statuses.completion, &completion)),
                        _ => None,
                    };
                    let failure = r#"{"error":{"message":"the fake server failed on purpose"}}"#.to_string();
                    let reply = match payload {
                        Some((status, json)) => {
                            let (line, body) =
                                if status == 200 { ("200 OK".to_string(), json) } else { (format!("{status} Failed"), &failure) };
                            format!(
                                "HTTP/1.1 {line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                                body.len()
                            )
                        }
                        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
                    };
                    let _ = stream.write_all(reply.as_bytes());
                }
            });
            Self { server: LocalServer { host: "127.0.0.1".into(), port }, seen }
        }

        pub(crate) fn seen(&self) -> Vec<(String, String)> {
            self.seen.lock().unwrap().clone()
        }
    }

    /// A port nothing listens on: bound, then given back.
    pub(crate) fn dead_server() -> LocalServer {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        LocalServer { host: "127.0.0.1".into(), port }
    }

    /// Real harnesses on this machine (not run in CI): `cargo test -- --ignored live_`.
    /// A harness whose own provider is down here can be left out by name:
    /// `VERSORIUM_LIVE_SKIP=opencode`.
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
        // Every harness, run from `/` as an app opened from the Finder is.
        std::env::set_current_dir("/").unwrap();
        let mut slots: Vec<SlotAssignment> = CLI_HARNESSES.iter().map(|(bin, _)| slot("cli", bin)).collect();
        // Name a model the daemon really serves, so this exercises the path a
        // configured slot takes rather than a default.
        if online {
            if let Some(model) = models.first() {
                slots.push(slot("ollama", model));
            }
        }
        for assignment in &slots {
            let installed = |id: &str| agents.iter().any(|a| a.id == id && a.state != "missing");
            let skipped = std::env::var("VERSORIUM_LIVE_SKIP").unwrap_or_default();
            let usable = match assignment.kind.as_str() {
                "cli" => installed(&assignment.id) && !skipped.split(',').any(|s| s.trim() == assignment.id),
                "ollama" => online,
                _ => false,
            };
            if !usable {
                eprintln!("{assignment:?}: skipped (not usable here)");
                continue;
            }
            let out = tauri::async_runtime::block_on(rewrite(assignment, passage, None))
                .unwrap_or_else(|e| panic!("{assignment:?} rewrite failed: {e}"));
            eprintln!("{assignment:?} → {out}");
            assert!(!out.trim().is_empty(), "{assignment:?} returned nothing");
            assert_ne!(out.trim(), passage, "{assignment:?} returned the passage unchanged");
        }

        // An Ollama slot naming a model the daemon does not serve must refuse
        // rather than substitute one.
        if online {
            assert_eq!(
                tauri::async_runtime::block_on(rewrite(
                    &slot("ollama", "versorium-not-a-model:1b"),
                    passage,
                    None
                ))
                .unwrap_err(),
                "no_provider"
            );
        }
    }

    fn slot(kind: &str, id: &str) -> SlotAssignment {
        SlotAssignment { kind: kind.into(), id: id.into() }
    }

    #[test]
    fn a_rewrite_slot_that_names_nothing_usable_is_refused_before_any_work() {
        let refused = |kind: &str, id: &str| {
            tauri::async_runtime::block_on(rewrite(&slot(kind, id), "Some prose.", None)).unwrap_err()
        };
        // Nothing assigned, and the empty-id cases: an assignment with no model
        // must not fall through to a default.
        assert_eq!(refused("none", ""), "no_provider");
        assert_eq!(refused("ollama", "  "), "no_provider");
        assert_eq!(refused("builtin", ""), "no_provider");
        assert_eq!(refused("cli", ""), "no_provider");
        // `gh` is a git tool, not an editor, and must never be offered prose.
        assert_eq!(refused("cli", "gh"), "no_provider");
        assert_eq!(refused("cli", "not-a-harness"), "no_provider");
        // A server slot with no model, or with no saved server to send it to.
        assert_eq!(refused("server", ""), "no_provider");
        assert_eq!(refused("server", "local-model"), "no_provider");
        // A `builtin` slot now reaches the engine, so the refusal it earns
        // depends on the machine rather than on there being no engine: an id the
        // catalog does not know is `not_found`, and a real id nobody downloaded
        // is `not_ready`. Either way it is never `no_provider`.
        let real = refused("builtin", "qwen35-4b-q4km");
        assert!(
            real == "not_ready" || real == "model_too_large" || real == "ai_empty" || real == "llama_load_failed",
            "unexpected refusal for a real catalog id: {real}"
        );
        assert_eq!(refused("builtin", "no-such-model"), "not_found");
    }

    #[test]
    fn a_server_rewrite_sends_the_prompt_to_the_chosen_model_and_returns_its_answer() {
        let fake = FakeServer::start(&["other-model", "local-model"], "  <think>Which words?</think>The winter ended.  ");
        let out = tauri::async_runtime::block_on(rewrite(
            &slot("server", "local-model"),
            "The long winter came.",
            Some(&fake.server),
        ))
        .unwrap();
        // Trimmed, and the reasoning never reaches the chapter.
        assert_eq!(out, "The winter ended.");

        let seen = fake.seen();
        assert_eq!(seen[0].0, "GET /v1/models", "it checks the model is served before asking");
        let (request, body) = &seen[1];
        assert_eq!(request, "POST /v1/chat/completions");
        let sent: serde_json::Value = serde_json::from_str(body).unwrap();
        // The model the writer chose, never whichever one the server lists first.
        assert_eq!(sent["model"], "local-model");
        assert_eq!(sent["stream"], false);
        let prompt = sent["messages"][0]["content"].as_str().unwrap();
        assert!(prompt.contains("The long winter came."), "the passage goes in the prompt");
        assert!(prompt.contains("ONLY the rewritten passage"), "with the rewrite rules");
    }

    #[test]
    fn a_server_that_does_not_answer_is_server_offline() {
        let err = tauri::async_runtime::block_on(rewrite(
            &slot("server", "local-model"),
            "Prose.",
            Some(&dead_server()),
        ))
        .unwrap_err();
        // Not `ai_failed`: the writer can act on this one, by starting it.
        assert_eq!(err, "server_offline");
    }

    #[test]
    fn a_server_slot_for_a_model_no_longer_served_is_refused() {
        let fake = FakeServer::start(&["another-model"], "Should never be asked.");
        let err = tauri::async_runtime::block_on(rewrite(&slot("server", "local-model"), "Prose.", Some(&fake.server)))
            .unwrap_err();
        assert_eq!(err, "no_provider");
        // Asked what it serves, and nothing else: no substitute model ran.
        assert_eq!(fake.seen().iter().map(|(r, _)| r.as_str()).collect::<Vec<_>>(), ["GET /v1/models"]);
    }

    #[test]
    fn an_unsaved_server_is_never_dispatched_to() {
        let fake = FakeServer::start(&["local-model"], "Should never be asked.");
        let mut settings = Settings {
            studio_host: fake.server.host.clone(),
            studio_port: fake.server.port,
            ..Default::default()
        };
        // The address is filled in but not saved: Versorium has no server.
        assert_eq!(saved_server(&settings), None);
        let err = tauri::async_runtime::block_on(rewrite(
            &slot("server", "local-model"),
            "Prose.",
            saved_server(&settings).as_ref(),
        ))
        .unwrap_err();
        assert_eq!(err, "no_provider");
        assert!(fake.seen().is_empty(), "nothing may reach a server the writer did not save");

        settings.studio_enabled = true;
        assert_eq!(saved_server(&settings), Some(fake.server.clone()));
    }

    #[test]
    fn a_server_that_answers_its_model_list_with_an_error_is_not_answering() {
        // Something answers on that port, but not as an OpenAI server would:
        // a 500 (or a web page's 404) is not a server that can run the task.
        let broken = FakeServer::start_with(&["local-model"], "Never asked.", Statuses { models: 500, completion: 200 });
        assert_eq!(tauri::async_runtime::block_on(server_status(&broken.server)), (false, Vec::new()));
        let err = tauri::async_runtime::block_on(rewrite(&slot("server", "local-model"), "Prose.", Some(&broken.server)))
            .unwrap_err();
        assert_eq!(err, "server_offline");
        assert!(
            !broken.seen().iter().any(|(request, _)| request == "POST /v1/chat/completions"),
            "a server that failed its listing is not sent the passage"
        );
    }

    #[test]
    fn a_failed_completion_is_ai_failed_not_an_empty_rewrite() {
        // The listing works; the model then fails, with an error body that
        // parses as JSON. Only the status says it failed.
        let failing = FakeServer::start_with(&["local-model"], "Never sent.", Statuses { models: 200, completion: 500 });
        let err = tauri::async_runtime::block_on(rewrite(&slot("server", "local-model"), "Prose.", Some(&failing.server)))
            .unwrap_err();
        assert_eq!(err, "ai_failed");
    }

    #[test]
    fn a_server_that_answers_nothing_is_ai_empty() {
        // Nothing at all, and a reasoning block with nothing after it: either
        // would splice an empty passage into the chapter.
        for answer in ["", "   ", "<think>Which words?</think>"] {
            let quiet = FakeServer::start(&["local-model"], answer);
            let err = tauri::async_runtime::block_on(rewrite(&slot("server", "local-model"), "Prose.", Some(&quiet.server)))
                .unwrap_err();
            assert_eq!(err, "ai_empty", "answer {answer:?}");
        }
    }

    #[test]
    fn an_ipv6_loopback_server_gets_its_brackets() {
        let server = LocalServer { host: "::1".into(), port: 1234 };
        assert_eq!(server.url("/v1/models"), "http://[::1]:1234/v1/models");
        let named = LocalServer { host: "localhost".into(), port: 8080 };
        assert_eq!(named.url("/v1/models"), "http://localhost:8080/v1/models");
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
    fn an_ollama_answer_loses_its_reasoning_before_it_reaches_a_chapter() {
        let answer = |response: &str| ollama_answer(&serde_json::json!({ "response": response }));
        assert_eq!(answer("<think>The user wants it tighter.</think>\n\nLa niña esperó."), "La niña esperó.");
        assert_eq!(answer("  La niña esperó.  "), "La niña esperó.");
        // Out of budget mid-thought: nothing of it is prose.
        assert_eq!(answer("<think>Let me consider"), "");
        assert_eq!(ollama_answer(&serde_json::json!({ "error": "model not found" })), "");
    }

    #[cfg(unix)]
    #[test]
    fn a_harness_runs_in_an_empty_folder_of_its_own() {
        let bin = tempfile::tempdir().unwrap();
        let exe = bin.path().join("pwdcli");
        std::fs::write(&exe, "#!/bin/sh\npwd\nls -A | wc -l\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let scratch = scratch_dir().unwrap();
        let out = run_capped_in(&exe, &[], Some(&scratch), Duration::from_secs(5)).unwrap();
        let mut lines = out.lines();
        let cwd = std::fs::canonicalize(lines.next().unwrap()).unwrap();
        assert_eq!(cwd, std::fs::canonicalize(&scratch).unwrap());
        assert_eq!(lines.next().unwrap().trim(), "0");
        let _ = std::fs::remove_dir_all(&scratch);
        assert_ne!(scratch_dir().unwrap(), scratch);
    }

    #[test]
    fn codex_is_told_it_may_run_outside_a_repository() {
        let (_, args) = CLI_HARNESSES.iter().find(|(bin, _)| *bin == "codex").unwrap();
        assert!(args.contains(&"--skip-git-repo-check"));
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
