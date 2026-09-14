//! Character-level ops log: append-only JSONL packs + periodic snapshots.
//!
//! Layout inside a project:
//!   .versorium/ops/<chapter>/<YYYY-MM-DD>.jsonl   one op per line
//!   .versorium/ops/<chapter>/seq                  monotonically increasing counter
//!   .versorium/snapshots/<chapter>/<seq>.md       full chapter body every 200 ops

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const SNAPSHOT_EVERY: u64 = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Op {
    pub seq: u64,
    pub ts: i64,
    pub author: String,
    /// "insert" | "delete" | "rollback"
    pub kind: String,
    pub from: usize,
    pub to: usize,
    /// inserted text (insert) / deleted text (delete) / restored text (rollback)
    pub text: String,
}

fn safe(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

fn ops_dir(root: &Path, chapter: &str) -> PathBuf {
    root.join(".versorium").join("ops").join(safe(chapter))
}

fn snap_dir(root: &Path, chapter: &str) -> PathBuf {
    root.join(".versorium").join("snapshots").join(safe(chapter))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_day() -> String {
    let days = now_secs() / 86400;
    let era = (if days >= 0 { days } else { days - 146096 }) / 146100;
    let doe = days - era * 146100;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

fn read_seq(dir: &Path) -> u64 {
    fs::read_to_string(dir.join("seq"))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Stamp ops with seq, append to today's JSONL, snapshot every SNAPSHOT_EVERY.
/// `body` is the chapter body AFTER the ops were applied (for snapshots).
pub fn append_ops(root: &Path, chapter: &str, body: &str, ops: &[Op]) -> Result<Vec<Op>, String> {
    if ops.is_empty() {
        return Ok(Vec::new());
    }
    let dir = ops_dir(root, chapter);
    fs::create_dir_all(&dir).map_err(|_| "io".to_string())?;
    let file = dir.join(format!("{}.jsonl", now_day()));
    let mut out = fs::read_to_string(&file).unwrap_or_default();
    let mut stamped = Vec::new();
    let mut seq = read_seq(&dir);
    for op in ops {
        seq += 1;
        let full = Op {
            seq,
            ts: now_secs(),
            author: op.author.clone(),
            kind: op.kind.clone(),
            from: op.from,
            to: op.to,
            text: op.text.clone(),
        };
        stamped.push(full.clone());
        out.push_str(&serde_json::to_string(&full).map_err(|_| "io".to_string())?);
        out.push('\n');
    }
    fs::write(&file, out).map_err(|_| "io".to_string())?;
    fs::write(dir.join("seq"), seq.to_string()).map_err(|_| "io".to_string())?;
    if seq % SNAPSHOT_EVERY == 0 {
        let sdir = snap_dir(root, chapter);
        if fs::create_dir_all(&sdir).is_ok() {
            let _ = fs::write(sdir.join(format!("{seq}.md")), body);
        }
    }
    Ok(stamped)
}

pub fn recent_ops(root: &Path, chapter: &str, limit: usize) -> Result<Vec<Op>, String> {
    let dir = ops_dir(root, chapter);
    let file = dir.join(format!("{}.jsonl", now_day()));
    let text = fs::read_to_string(&file).unwrap_or_default();
    let ops: Vec<Op> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    let start = ops.len().saturating_sub(limit);
    Ok(ops[start..].to_vec())
}

pub fn snapshots(root: &Path, chapter: &str) -> Result<Vec<u64>, String> {
    let sdir = snap_dir(root, chapter);
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&sdir) {
        for e in rd.flatten() {
            if let Some(n) = e
                .file_name()
                .to_str()
                .and_then(|s| s.strip_suffix(".md"))
                .and_then(|s| s.parse::<u64>().ok())
            {
                out.push(n);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Read a snapshot body (frontend writes it back via save_chapter).
pub fn restore_snapshot(root: &Path, chapter: &str, seq: u64) -> Result<String, String> {
    fs::read_to_string(snap_dir(root, chapter).join(format!("{seq}.md")))
        .map_err(|_| "not_found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(kind: &str, from: usize, to: usize, text: &str) -> Op {
        Op { seq: 0, ts: 0, author: "human".into(), kind: kind.into(), from, to, text: text.into() }
    }

    #[test]
    fn appends_and_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let stamped =
            append_ops(root, "ch-01", "body", &[op("insert", 0, 0, "ab"), op("delete", 0, 2, "ab")])
                .unwrap();
        assert_eq!(stamped[0].seq, 1);
        assert_eq!(stamped[1].seq, 2);
        let recent = recent_ops(root, "ch-01", 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[1].text, "ab");
    }

    #[test]
    fn snapshots_every_n() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // seed seq so the next op lands on a snapshot boundary
        let d = ops_dir(root, "ch-01");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("seq"), (SNAPSHOT_EVERY - 1).to_string()).unwrap();
        append_ops(root, "ch-01", "full body", &[op("insert", 0, 0, "x")]).unwrap();
        assert_eq!(snapshots(root, "ch-01").unwrap(), vec![SNAPSHOT_EVERY]);
        assert_eq!(restore_snapshot(root, "ch-01", SNAPSHOT_EVERY).unwrap(), "full body");
    }

    #[test]
    fn day_format() {
        assert_eq!(now_day().len(), 10);
        assert_eq!(now_day().chars().nth(4).unwrap(), '-');
    }
}
