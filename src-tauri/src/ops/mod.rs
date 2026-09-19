//! Character-level ops log: append-only JSONL packs + periodic snapshots.
//!
//! Layout inside a project:
//!   .versorium/ops/<chapter>/<YYYY-MM-DD>.jsonl   one op per line
//!   .versorium/ops/<chapter>/seq                  monotonically increasing counter
//!   .versorium/snapshots/<chapter>/<seq>.md       full chapter body every 200 ops

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

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
    day_for_seconds(now_secs())
}

fn day_for_seconds(seconds: i64) -> String {
    let days = seconds.div_euclid(86400) + 719468;
    let era = days.div_euclid(146097);
    let doe = days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

fn pack_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() { return Ok(Vec::new()); }
    let mut files = Vec::new();
    for entry in fs::read_dir(dir).map_err(|_| "io")? {
        let path = entry.map_err(|_| "io")?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn read_pack(file: &Path) -> Result<Vec<Op>, String> {
    fs::read_to_string(file).map_err(|_| "io".to_string())?
        .lines().filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).map_err(|_| "io".to_string()))
        .collect()
}

fn read_seq(dir: &Path) -> Result<u64, String> {
    let mut seq = fs::read_to_string(dir.join("seq")).ok()
        .and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    // A crash after appending but before saving the counter must not reuse IDs.
    for file in pack_files(dir)? {
        seq = seq.max(read_pack(&file)?.last().map(|op| op.seq).unwrap_or(0));
    }
    Ok(seq)
}

/// Stamp ops with seq, append to today's JSONL, snapshot every SNAPSHOT_EVERY.
/// `body` is the chapter body AFTER the ops were applied (for snapshots).
pub fn append_ops(root: &Path, chapter: &str, body: &str, ops: &[Op]) -> Result<Vec<Op>, String> {
    if ops.is_empty() {
        return Ok(Vec::new());
    }
    let _guard = WRITE_LOCK.lock().map_err(|_| "io".to_string())?;
    let dir = ops_dir(root, chapter);
    fs::create_dir_all(&dir).map_err(|_| "io".to_string())?;
    let file = dir.join(format!("{}.jsonl", now_day()));
    let mut out = String::new();
    let mut stamped = Vec::new();
    let initial_seq = read_seq(&dir)?;
    let mut seq = initial_seq;
    for op in ops {
        seq += 1;
        let full = Op {
            seq,
            ts: if op.ts > 0 { op.ts } else { now_secs() * 1000 },
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
    let mut pack = fs::OpenOptions::new().create(true).append(true).open(&file).map_err(|_| "io")?;
    let previous_len = pack.metadata().map_err(|_| "io")?.len();
    if pack.write_all(out.as_bytes()).and_then(|_| pack.sync_all()).is_err() {
        let _ = pack.set_len(previous_len);
        return Err("io".into());
    }
    // Counter/snapshot are recoverable indexes; the synced pack is authoritative.
    let _ = crate::storage::atomic_write(&dir.join("seq"), seq.to_string());
    if initial_seq / SNAPSHOT_EVERY < seq / SNAPSHOT_EVERY {
        let sdir = snap_dir(root, chapter);
        if fs::create_dir_all(&sdir).is_ok() {
            let _ = crate::storage::atomic_write(&sdir.join(format!("{seq}.md")), body);
        }
    }
    Ok(stamped)
}

pub fn recent_ops(root: &Path, chapter: &str, limit: usize) -> Result<Vec<Op>, String> {
    let dir = ops_dir(root, chapter);
    let _guard = WRITE_LOCK.lock().map_err(|_| "io".to_string())?;
    let mut ops = Vec::new();
    for file in pack_files(&dir)? { ops.extend(read_pack(&file)?); }
    ops.sort_by_key(|op| op.seq);
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
        assert_eq!(day_for_seconds(0), "1970-01-01");
        assert_eq!(day_for_seconds(1_779_062_400), "2026-05-18");
        assert_eq!(day_for_seconds(1_709_164_800), "2024-02-29");
    }

    #[test]
    fn snapshot_when_batch_crosses_boundary_and_recover_counter() {
        let dir = tempfile::tempdir().unwrap();
        let d = ops_dir(dir.path(), "ch-01");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("seq"), "199").unwrap();
        append_ops(dir.path(), "ch-01", "ab", &[op("insert", 0, 1, "a"), op("insert", 1, 2, "b")]).unwrap();
        assert_eq!(snapshots(dir.path(), "ch-01").unwrap(), vec![201]);
        fs::remove_file(d.join("seq")).unwrap();
        let stamped = append_ops(dir.path(), "ch-01", "abc", &[op("insert", 2, 3, "c")]).unwrap();
        assert_eq!(stamped[0].seq, 202);
    }

    #[test]
    fn reads_previous_day_and_preserves_event_time() {
        let dir = tempfile::tempdir().unwrap();
        let mut event = op("insert", 0, 1, "a");
        event.ts = 12345;
        append_ops(dir.path(), "ch-01", "a", &[event]).unwrap();
        let d = ops_dir(dir.path(), "ch-01");
        fs::rename(d.join(format!("{}.jsonl", now_day())), d.join("2000-01-01.jsonl")).unwrap();
        append_ops(dir.path(), "ch-01", "ab", &[op("insert", 1, 2, "b")]).unwrap();
        let recent = recent_ops(dir.path(), "ch-01", 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].ts, 12345);
    }

    #[test]
    fn concurrent_appends_have_unique_sequences() {
        let dir = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    append_ops(dir.path(), "ch-01", "a", &[op("insert", 0, 1, "a")]).unwrap();
                });
            }
        });
        let recent = recent_ops(dir.path(), "ch-01", 20).unwrap();
        assert_eq!(recent.iter().map(|op| op.seq).collect::<Vec<_>>(), (1..=8).collect::<Vec<_>>());
    }
}
