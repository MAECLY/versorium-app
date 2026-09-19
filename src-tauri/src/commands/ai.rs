//! M2: agent detection + rewrite commands.
//!
//! `ai_apply_rewrite` is the only place an AI write touches a chapter:
//! git checkpoint FIRST (if the snapshot fails, the write is not applied),
//! then splice + save, then ops with `author = "ai:<provider>"`.

use crate::agents::{self, AgentInfo};
use crate::commands::chapters::save_chapter;
use crate::commands::project::split_frontmatter;
use crate::ops::Op;
use crate::storage::project_file;
use crate::text::{utf16_len, utf16_to_byte};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

/// Detect installed agent harnesses (PATH) + Ollama daemon state.
#[tauri::command]
pub async fn agents_detect() -> Vec<AgentInfo> {
    let binaries = tauri::async_runtime::spawn_blocking(agents::detect_binaries)
        .await
        .unwrap_or_default();
    let (online, models) = agents::ollama_status().await;
    let mut agents = binaries;
    if let Some(ollama) = agents.iter_mut().find(|a| a.id == "ollama") {
        if online {
            ollama.state = "connected".into();
            ollama.models = Some(models);
        }
    }
    agents
}

/// Rewrite a selected passage with the given provider.
#[tauri::command]
pub async fn ai_rewrite(provider: String, text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("ai_empty".into());
    }
    agents::rewrite(&provider, &text).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApplyArgs {
    pub path: PathBuf,
    pub file: String,
    /// Body range in UTF-16 code units (editor coordinates), frontmatter excluded.
    pub from: usize,
    pub to: usize,
    /// Replacement text.
    pub text: String,
    /// Provider id — recorded in ops as `ai:<provider>`.
    pub provider: String,
    /// The passage the user selected; the write is refused if the file moved on.
    pub expected: String,
}

/// Apply a rewrite to a chapter: validate → checkpoint → splice → ops.
///
/// Every check runs before the git checkpoint so a rejected apply never
/// leaves a commit behind.
#[tauri::command]
pub fn ai_apply_rewrite(args: AiApplyArgs) -> Result<crate::commands::project::ChapterMeta, String> {
    let full = project_file(&args.path, &args.file)?;
    let raw = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let (_, body) = split_frontmatter(&raw);
    if args.from > args.to {
        return Err("bad_range".into());
    }
    let (start, end) = match (utf16_to_byte(&body, args.from), utf16_to_byte(&body, args.to)) {
        (Some(s), Some(e)) => (s, e),
        _ => return Err("bad_range".into()),
    };
    let deleted = &body[start..end];
    if deleted != args.expected {
        return Err("stale_selection".into());
    }

    // Git checkpoint BEFORE the write. If the snapshot fails, nothing is applied.
    if let Err(e) = crate::git::repo::commit_all(
        &args.path,
        &format!("checkpoint: before ai rewrite ({})", args.provider),
    ) {
        if e != "nothing_to_commit" {
            return Err(e);
        }
    }

    let new_body = format!("{}{}{}", &body[..start], args.text, &body[end..]);
    let cm = save_chapter(args.path.clone(), args.file.clone(), new_body.clone(), None)?;

    // Ops in editor coordinates: delete at old offsets, insert at new ones.
    let author = format!("ai:{}", args.provider);
    let mut ops: Vec<Op> = Vec::new();
    if !deleted.is_empty() {
        ops.push(Op {
            seq: 0,
            ts: 0,
            author: author.clone(),
            kind: "delete".into(),
            from: args.from,
            to: args.to,
            text: deleted.to_string(),
        });
    }
    if !args.text.is_empty() {
        ops.push(Op {
            seq: 0,
            ts: 0,
            author,
            kind: "insert".into(),
            from: args.from,
            to: args.from + utf16_len(&args.text),
            text: args.text.clone(),
        });
    }
    if !ops.is_empty() {
        // Best-effort, same as the human ops path (data is already on disk).
        let _ = crate::ops::append_ops(&args.path, &cm.id, &new_body, &ops);
    }
    Ok(cm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{create_chapter, create_project, CreateProjectArgs};
    use crate::git::repo;
    use std::path::Path;

    fn make_project(dir: &Path, title: &str) -> PathBuf {
        let p = create_project(CreateProjectArgs {
            path: dir.to_path_buf(),
            title: title.into(),
            language: "en".into(),
        })
        .unwrap();
        p.path.into()
    }

    fn write_body(p: &Path, ch: &crate::commands::project::ChapterMeta, body: &str) {
        fs::write(
            p.join(&ch.file),
            format!("---\nid: {}\ntitle: One\n---\n{}", ch.id, body),
        )
        .unwrap();
    }

    fn read_ops(p: &Path, chapter: &str) -> Vec<Op> {
        let ops_dir = p.join(".versorium").join("ops").join(chapter);
        let jsonl = fs::read_dir(&ops_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .expect("ops pack missing")
            .path();
        fs::read_to_string(&jsonl)
            .unwrap()
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn apply(p: &Path, file: &str, from: usize, to: usize, text: &str, expected: &str) -> Result<crate::commands::project::ChapterMeta, String> {
        ai_apply_rewrite(AiApplyArgs {
            path: p.to_path_buf(),
            file: file.into(),
            from,
            to,
            text: text.into(),
            provider: "claude".into(),
            expected: expected.into(),
        })
    }

    #[test]
    fn apply_rewrite_splices_body_and_records_ops() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Rewrite Test");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        write_body(&p, &ch, "Old sentence one.\nOld sentence two.");

        let cm = apply(&p, &ch.file, 0, 17, "New sentence one.", "Old sentence one.").unwrap();

        let raw = fs::read_to_string(p.join(&cm.file)).unwrap();
        let (_, new_body) = split_frontmatter(&raw);
        assert_eq!(new_body, "New sentence one.\nOld sentence two.");

        let log = repo::log(&p, 10).unwrap();
        assert!(log.iter().any(|c| c.message == "checkpoint: before ai rewrite (claude)"));

        let ops = read_ops(&p, &cm.id);
        assert_eq!(ops.len(), 2);
        assert!(ops.iter().all(|o| o.author == "ai:claude"));
        assert_eq!(ops[0].kind, "delete");
        assert_eq!(ops[0].text, "Old sentence one.");
        assert_eq!(ops[1].kind, "insert");
        assert_eq!(ops[1].text, "New sentence one.");
        assert!(ops.iter().all(|o| o.seq > 0 && o.ts > 0));
    }

    #[test]
    fn apply_rewrite_uses_utf16_offsets_for_multibyte_text() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Multibyte");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        // "Año nuevo — 🌙 " = 15 UTF-16 units (emoji counts 2), 21 bytes.
        let body = "Año nuevo — 🌙 luna.\nSegunda.";
        write_body(&p, &ch, body);

        let cm = apply(&p, &ch.file, 15, 20, "estrella.", "luna.").unwrap();

        let raw = fs::read_to_string(p.join(&cm.file)).unwrap();
        let (_, new_body) = split_frontmatter(&raw);
        assert_eq!(new_body, "Año nuevo — 🌙 estrella.\nSegunda.");

        let ops = read_ops(&p, &cm.id);
        assert_eq!(ops.len(), 2);
        assert_eq!((ops[0].kind.as_str(), ops[0].from, ops[0].to), ("delete", 15, 20));
        assert_eq!(ops[0].text, "luna.");
        assert_eq!((ops[1].kind.as_str(), ops[1].from, ops[1].to), ("insert", 15, 24));
        assert_eq!(ops[1].text, "estrella.");
    }

    #[test]
    fn apply_rewrite_refuses_stale_selection_without_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Stale");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        write_body(&p, &ch, "Old sentence one.");
        let before = repo::log(&p, 10).unwrap().len();

        let err = apply(&p, &ch.file, 0, 17, "x", "Something else..").unwrap_err();
        assert_eq!(err, "stale_selection");

        let log = repo::log(&p, 10).unwrap();
        assert_eq!(log.len(), before);
        assert!(!log.iter().any(|c| c.message.starts_with("checkpoint: before ai rewrite")));
        let raw = fs::read_to_string(p.join(&ch.file)).unwrap();
        assert!(raw.ends_with("Old sentence one."));
    }

    #[test]
    fn apply_rewrite_rejects_bad_range() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Bad Range");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        write_body(&p, &ch, "short 🌙");
        let before = repo::log(&p, 10).unwrap().len();

        assert_eq!(apply(&p, &ch.file, 3, 99, "x", "").unwrap_err(), "bad_range");
        assert_eq!(apply(&p, &ch.file, 5, 3, "x", "").unwrap_err(), "bad_range");
        // Inside the surrogate pair of the emoji (units 6..8).
        assert_eq!(apply(&p, &ch.file, 6, 7, "x", "").unwrap_err(), "bad_range");
        assert_eq!(repo::log(&p, 10).unwrap().len(), before);
        assert!(apply(&p, "../outside.md", 0, 0, "x", "").is_err());
    }
}
