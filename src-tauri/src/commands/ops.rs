//! Tauri commands for the character-level ops log.

use crate::ops::{self, Op};
use std::path::PathBuf;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpArgs {
    path: PathBuf,
    chapter: String,
    body: String,
    ops: Vec<Op>,
}

#[tauri::command]
pub fn ops_append(args: OpArgs) -> Result<Vec<Op>, String> {
    ops::append_ops(&args.path, &args.chapter, &args.body, &args.ops)
}

#[tauri::command]
pub fn ops_recent(path: PathBuf, chapter: String, limit: Option<usize>) -> Result<Vec<Op>, String> {
    ops::recent_ops(&path, &chapter, limit.unwrap_or(50).clamp(1, 500))
}

#[tauri::command]
pub fn ops_snapshots(path: PathBuf, chapter: String) -> Result<Vec<u64>, String> {
    ops::snapshots(&path, &chapter)
}

#[tauri::command]
pub fn ops_restore_snapshot(path: PathBuf, chapter: String, seq: u64) -> Result<String, String> {
    ops::restore_snapshot(&path, &chapter, seq)
}
