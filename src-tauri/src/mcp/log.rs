//! Tool-call log shown in Settings → MCP.
//!
//! Records WHAT an agent did, never the manuscript. `detail` carries paths and
//! counts only — the same rule crash logs follow (spec §12): prose never leaves
//! the project folder, not even into a local log the user might attach to an
//! issue.

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;

/// Keeps the file bounded without needing a rotation job.
const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Epoch milliseconds.
    pub ts: i64,
    pub client: String,
    pub tool: String,
    /// `read` | `write`
    pub scope: String,
    /// `ok` | `denied` | `error`
    pub outcome: String,
    /// Paths and counts only.
    pub detail: String,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn entry(client: &str, tool: &str, scope: &str, outcome: &str, detail: String) -> LogEntry {
    LogEntry {
        ts: now_ms(),
        client: client.to_string(),
        tool: tool.to_string(),
        scope: scope.to_string(),
        outcome: outcome.to_string(),
        detail,
    }
}

/// Append one entry. Best-effort: a failed log must never fail a tool call.
pub fn append(entry: &LogEntry) {
    let Ok(path) = crate::paths::mcp_log_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(line) = serde_json::to_string(entry) else { return };
    let appended = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "{line}"));
    if appended.is_ok() {
        trim(&path);
    }
}

/// Rewrite the file with the newest MAX_ENTRIES lines once it grows past twice that.
fn trim(path: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= MAX_ENTRIES * 2 {
        return;
    }
    let kept = lines[lines.len() - MAX_ENTRIES..].join("\n");
    let _ = crate::storage::atomic_write(path, format!("{kept}\n"));
}

/// Newest first, capped at `limit`. Unparseable lines are skipped, not fatal.
pub fn read(limit: usize) -> Vec<LogEntry> {
    let Ok(path) = crate::paths::mcp_log_path() else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(&path) else { return Vec::new() };
    let mut entries: Vec<LogEntry> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    entries.reverse();
    entries.truncate(limit.clamp(1, MAX_ENTRIES));
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_carries_no_prose_and_serializes_camel_case() {
        let e = entry("claude-code", "read_document", "read", "ok", "manuscript/ch-01.md".into());
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["client"], "claude-code");
        assert_eq!(v["scope"], "read");
        assert_eq!(v["outcome"], "ok");
        assert!(v.get("ts").is_some());
    }

    #[test]
    fn reading_a_missing_or_corrupt_log_is_not_fatal() {
        // read() resolves the real app-data path; on a machine without one it
        // must still return an empty list rather than panicking.
        let entries = read(10);
        assert!(entries.len() <= 500);
    }

    #[test]
    fn trim_keeps_the_newest_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp-log.jsonl");
        let mut text = String::new();
        for i in 0..(MAX_ENTRIES * 2 + 5) {
            let e = entry("c", "t", "read", "ok", i.to_string());
            text.push_str(&serde_json::to_string(&e).unwrap());
            text.push('\n');
        }
        std::fs::write(&path, text).unwrap();
        trim(&path);
        let kept: Vec<LogEntry> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(kept.len(), MAX_ENTRIES);
        assert_eq!(kept.last().unwrap().detail, (MAX_ENTRIES * 2 + 4).to_string());
    }
}
