//! M2: agent detection + rewrite commands.
//!
//! `ai_apply_rewrite` is the only place an AI write touches a chapter:
//! git checkpoint FIRST (if the snapshot fails, the write is not applied),
//! then splice + save, then ops with `author = "ai:<provider>"`.

use crate::agents::{self, AgentInfo};
use crate::commands::chapters::save_chapter;
use crate::commands::project::split_frontmatter;
use crate::ops::Op;
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
    /// Body offset range (frontmatter excluded), UTF-8 valid.
    pub from: usize,
    pub to: usize,
    /// Replacement text.
    pub text: String,
    /// Provider id — recorded in ops as `ai:<provider>`.
    pub provider: String,
}

/// Apply a rewrite to a chapter: checkpoint → splice → ops.
#[tauri::command]
pub fn ai_apply_rewrite(args: AiApplyArgs) -> Result<crate::commands::project::ChapterMeta, String> {
    let full = args.path.join(&args.file);
    let raw = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let (_, body) = split_frontmatter(&raw);
    if args.from > args.to || args.to > body.len() {
        return Err("not_found".to_string());
    }
    let deleted = &body[args.from..args.to];

    // 1) Git checkpoint BEFORE the write. If the snapshot fails, the write
    //    is not applied (spec M2 DoD).
    if let Err(e) = crate::git::repo::commit_all(
        &args.path,
        &format!("checkpoint: before ai rewrite ({})", args.provider),
    ) {
        if e != "nothing_to_commit" {
            return Err(e);
        }
    }

    // 2) Splice + save (re-renders frontmatter + word count).
    let new_body = format!("{}{}{}", &body[..args.from], args.text, &body[args.to..]);
    let cm = save_chapter(args.path.clone(), args.file.clone(), new_body.clone(), None)?;

    // 3) Ops with author = "ai:<provider>" — delete at old coordinates,
    //    insert at new coordinates. append_ops re-stamps seq + ts.
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
            to: args.from + args.text.len(),
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

    #[test]
    fn apply_rewrite_splices_body_and_records_ops() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Rewrite Test");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        let body = "Old sentence one.\nOld sentence two.";
        fs::write(
            p.join(&ch.file),
            format!("---\nid: {}\ntitle: One\n---\n{}", ch.id, body),
        )
        .unwrap();

        // Replace "Old sentence one." (0..17) with "New sentence one."
        let cm = ai_apply_rewrite(AiApplyArgs {
            path: p.clone(),
            file: ch.file.clone(),
            from: 0,
            to: 17,
            text: "New sentence one.".into(),
            provider: "claude".into(),
        })
        .unwrap();

        let raw = fs::read_to_string(p.join(&cm.file)).unwrap();
        let (_, new_body) = split_frontmatter(&raw);
        assert_eq!(new_body, "New sentence one.\nOld sentence two.");

        // Git: checkpoint commit exists with the provider in the message.
        let log = repo::log(&p, 10).unwrap();
        assert!(log
            .iter()
            .any(|c| c.message == "checkpoint: before ai rewrite (claude)"));

        // Ops: delete + insert, both authored by ai:claude.
        let ops_dir = p.join(".versorium").join("ops").join(&cm.id);
        let jsonl = fs::read_dir(&ops_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .next()
            .expect("ops pack missing")
            .path();
        let lines = fs::read_to_string(&jsonl).unwrap();
        let ops: Vec<Op> = lines
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(ops.len(), 2);
        assert!(ops.iter().all(|o| o.author == "ai:claude"));
        assert_eq!(ops[0].kind, "delete");
        assert_eq!(ops[0].text, "Old sentence one.");
        assert_eq!(ops[1].kind, "insert");
        assert_eq!(ops[1].text, "New sentence one.");
        assert!(ops.iter().all(|o| o.seq > 0 && o.ts > 0));
    }

    #[test]
    fn apply_rewrite_rejects_bad_range() {
        let dir = tempfile::tempdir().unwrap();
        let p = make_project(dir.path(), "Bad Range");
        let ch = create_chapter(p.clone(), "One".into()).unwrap();
        let body = "short";
        fs::write(
            p.join(&ch.file),
            format!("---\nid: {}\ntitle: One\n---\n{}", ch.id, body),
        )
        .unwrap();
        let err = ai_apply_rewrite(AiApplyArgs {
            path: p,
            file: ch.file,
            from: 3,
            to: 99,
            text: "x".into(),
            provider: "claude".into(),
        })
        .unwrap_err();
        assert_eq!(err, "not_found");
    }
}
