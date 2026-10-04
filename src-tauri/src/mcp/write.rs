//! The agent write path (spec §7).
//!
//! Order is not negotiable: permission (already checked by `tools::call`) →
//! validate → preview unless confirmed → git checkpoint → apply → ops. Every
//! check runs before the checkpoint so a refused write never leaves a commit
//! behind, and `commands::ai::ai_apply_rewrite` — the keyboard-side equivalent —
//! does the same thing in the same order.

use crate::commands::chapters::save_chapter;
use crate::commands::project::{self, split_frontmatter};
use crate::git::lock::{Wait, BACKGROUND_WAIT};
use crate::mcp::session::Session;
use crate::mcp::tools::{arg_bool, arg_str, arg_usize, ToolDef, ToolOutput};
use crate::ops::Op;
use crate::storage::{atomic_write, project_file};
use crate::text::{utf16_len, utf16_to_byte};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

/// Codex directories an entry may live in (spec §4).
const CODEX_KINDS: [&str; 4] = ["characters", "factions", "items", "locations"];
/// Context lines around a change in a preview.
const CONTEXT: usize = 3;

/// A body edit in UTF-16 editor coordinates — the same units the ops log uses.
struct Edit {
    from: usize,
    to: usize,
    insert: String,
}

pub fn call(session: &mut Session, tool: &ToolDef, args: &Value) -> Result<ToolOutput, String> {
    match tool.name {
        "write_document" => {
            let content = arg_str(args, "content")?;
            edit_chapter(session, tool, args, |body| {
                Ok(Edit { from: 0, to: utf16_len(body), insert: content.clone() })
            })
        }
        "insert_text" => {
            let at = arg_usize(args, "at")?;
            let text = arg_str(args, "text")?;
            edit_chapter(session, tool, args, |_| {
                Ok(Edit { from: at, to: at, insert: text.clone() })
            })
        }
        "delete_text" => {
            let from = arg_usize(args, "from")?;
            let to = arg_usize(args, "to")?;
            edit_chapter(session, tool, args, |_| {
                Ok(Edit { from, to, insert: String::new() })
            })
        }
        "replace_text" => {
            let from = arg_usize(args, "from")?;
            let to = arg_usize(args, "to")?;
            let text = arg_str(args, "text")?;
            edit_chapter(session, tool, args, |_| {
                Ok(Edit { from, to, insert: text.clone() })
            })
        }
        "create_document" => create_document(session, tool, args),
        "codex_upsert" => codex_upsert(session, tool, args),
        "git_commit" => git_commit(session, args),
        "delete_document" => delete_document(session, tool, args),
        _ => Err("unknown_tool".into()),
    }
}

// ------------------------------------------------------------------ helpers

/// Snapshot the project before touching it. A failed snapshot aborts the write:
/// without a restore point the user cannot roll the agent back.
///
/// Waits up to ten seconds for a backup reading the history: this process has
/// no window to freeze. Still held after that, the agent is told `repo_busy`
/// and nothing is written.
fn checkpoint(root: &Path, tool: &str, client: &str) -> Result<(), String> {
    let message = format!("checkpoint: before mcp {tool} ({client})");
    match crate::git::repo::commit_all_waiting(root, &message, Wait::Upto(BACKGROUND_WAIT)) {
        Ok(_) => Ok(()),
        Err(code) if code == "nothing_to_commit" => Ok(()),
        Err(code) => Err(code),
    }
}

/// Unified-style diff. Not byte-identical to git's, but honest about what the
/// agent is about to change, which is what the preview is for.
fn preview(file: &str, old: &str, new: &str) -> String {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }
    let (mut end_a, mut end_b) = (a.len(), b.len());
    while end_a > start && end_b > start && a[end_a - 1] == b[end_b - 1] {
        end_a -= 1;
        end_b -= 1;
    }

    let mut out = format!("--- a/{file}\n+++ b/{file}\n");
    if start == end_a && start == end_b {
        out.push_str("(no change)\n");
        return out;
    }
    for line in &a[start.saturating_sub(CONTEXT)..start] {
        out.push_str(&format!(" {line}\n"));
    }
    for line in &a[start..end_a] {
        out.push_str(&format!("-{line}\n"));
    }
    for line in &b[start..end_b] {
        out.push_str(&format!("+{line}\n"));
    }
    for line in &a[end_a..(end_a + CONTEXT).min(a.len())] {
        out.push_str(&format!(" {line}\n"));
    }
    out
}

fn previewed(file: &str, old: &str, new: &str) -> ToolOutput {
    let diff = preview(file, old, new);
    ToolOutput::with(
        format!("Preview only — nothing was written. Call again with confirm: true to apply.\n\n{diff}"),
        json!({ "applied": false, "file": file, "diff": diff }),
    )
}

fn applied(file: &str, message: &str, extra: Value) -> ToolOutput {
    let mut value = json!({ "applied": true, "file": file });
    if let (Some(map), Some(more)) = (value.as_object_mut(), extra.as_object()) {
        for (key, item) in more {
            map.insert(key.clone(), item.clone());
        }
    }
    ToolOutput::with(message, value)
}

// ------------------------------------------------------------- chapter edits

/// Shared pipeline for write_document / insert_text / delete_text / replace_text.
fn edit_chapter(
    session: &mut Session,
    tool: &ToolDef,
    args: &Value,
    edit_of: impl Fn(&str) -> Result<Edit, String>,
) -> Result<ToolOutput, String> {
    let root = session.project()?;
    let file = arg_str(args, "file")?;

    // Validation, all of it, before any commit can happen.
    let full = project_file(&root, &file)?;
    let raw = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let (_, body) = split_frontmatter(&raw);
    let edit = edit_of(&body)?;
    if edit.from > edit.to {
        return Err("bad_range".into());
    }
    let (start, end) = match (utf16_to_byte(&body, edit.from), utf16_to_byte(&body, edit.to)) {
        (Some(s), Some(e)) => (s, e),
        _ => return Err("bad_range".into()),
    };
    let deleted = body[start..end].to_string();
    let new_body = format!("{}{}{}", &body[..start], edit.insert, &body[end..]);

    if !arg_bool(args, "confirm") {
        return Ok(previewed(&file, &body, &new_body));
    }

    checkpoint(&root, tool.name, session.client())?;
    let meta = save_chapter(root.clone(), file.clone(), new_body.clone(), None)?;

    // Ops in editor coordinates: delete at the old offsets, insert at the new.
    let author = format!("ai:{}", session.client());
    let mut ops: Vec<Op> = Vec::new();
    if !deleted.is_empty() {
        ops.push(Op {
            seq: 0,
            ts: 0,
            author: author.clone(),
            kind: "delete".into(),
            from: edit.from,
            to: edit.to,
            text: deleted,
        });
    }
    if !edit.insert.is_empty() {
        ops.push(Op {
            seq: 0,
            ts: 0,
            author,
            kind: "insert".into(),
            from: edit.from,
            to: edit.from + utf16_len(&edit.insert),
            text: edit.insert.clone(),
        });
    }
    if !ops.is_empty() {
        // Best-effort like the keyboard path: the text is already on disk.
        let _ = crate::ops::append_ops(&root, &meta.id, &new_body, &ops);
    }

    Ok(applied(
        &file,
        &format!("Updated {file} ({} words).", meta.words),
        json!({ "id": meta.id, "words": meta.words }),
    ))
}

// ------------------------------------------------------------- other writes

fn create_document(session: &mut Session, tool: &ToolDef, args: &Value) -> Result<ToolOutput, String> {
    let root = session.project()?;
    let title = arg_str(args, "title")?;
    if title.trim().is_empty() {
        return Err("empty_title".into());
    }

    if !arg_bool(args, "confirm") {
        // Name the file the agent would get, so the preview is actionable.
        let meta = project::load_meta(&root).ok_or_else(|| "not_found".to_string())?;
        let next = crate::commands::chapters::list_chapters_inner(&root)?
            .iter()
            .filter_map(|c| c.id.split('-').nth(1).and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0)
            + 1;
        let (_, file) = project::chapter_path_for(&meta, next, &title);
        return Ok(ToolOutput::with(
            format!("Preview only — nothing was written. Would create {file}."),
            json!({ "applied": false, "file": file }),
        ));
    }

    checkpoint(&root, tool.name, session.client())?;
    let meta = project::create_chapter(root, title)?;
    Ok(applied(&meta.file, &format!("Created {}.", meta.file), json!({ "id": meta.id })))
}

fn codex_upsert(session: &mut Session, tool: &ToolDef, args: &Value) -> Result<ToolOutput, String> {
    let root = session.project()?;
    let kind = arg_str(args, "kind")?;
    let id = arg_str(args, "id")?;
    let body = arg_str(args, "body")?;
    if !CODEX_KINDS.contains(&kind.as_str()) {
        return Err("bad_args".into());
    }
    // A codex id becomes a file name; keep it to a slug rather than trusting
    // the path guard alone to catch something creative.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad_args".into());
    }

    let file = format!("codex/{kind}/{id}.md");
    let full = project_file(&root, &file)?;
    let old = fs::read_to_string(&full).unwrap_or_default();

    if !arg_bool(args, "confirm") {
        return Ok(previewed(&file, &old, &body));
    }

    checkpoint(&root, tool.name, session.client())?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|_| "io".to_string())?;
    }
    atomic_write(&full, body)?;
    let created = old.is_empty();
    Ok(applied(
        &file,
        &format!("{} {file}.", if created { "Created" } else { "Updated" }),
        json!({ "created": created }),
    ))
}

fn git_commit(session: &mut Session, args: &Value) -> Result<ToolOutput, String> {
    let root = session.project()?;
    let message = arg_str(args, "message")?;
    if message.trim().is_empty() {
        return Err("empty_message".into());
    }

    if !arg_bool(args, "confirm") {
        let diff = crate::git::repo::diff(&root)?;
        return Ok(ToolOutput::with(
            format!("Preview only — nothing was committed. Pending changes:\n\n{diff}"),
            json!({ "applied": false, "diff": diff }),
        ));
    }

    // No separate checkpoint here: the commit itself is the restore point.
    let sha = crate::git::repo::commit_all_waiting(&root, &message, Wait::Upto(BACKGROUND_WAIT))?;
    Ok(ToolOutput::with(
        format!("Committed {}.", &sha[..sha.len().min(7)]),
        json!({ "applied": true, "sha": sha }),
    ))
}

fn delete_document(session: &mut Session, tool: &ToolDef, args: &Value) -> Result<ToolOutput, String> {
    let root = session.project()?;
    let file = arg_str(args, "file")?;
    let full = project_file(&root, &file)?;
    let raw = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let (_, body) = split_frontmatter(&raw);

    if !arg_bool(args, "confirm") {
        return Ok(ToolOutput::with(
            format!(
                "Preview only — nothing was deleted. Would delete {file} ({} words).\n\
                 Deleting a chapter needs both confirm: true and acknowledge_delete: true.",
                project::count_words(&body)
            ),
            json!({ "applied": false, "file": file }),
        ));
    }
    // Spec §7: deleting a document takes a second, explicit acknowledgement.
    if !arg_bool(args, "acknowledge_delete") && !arg_bool(args, "acknowledgeDelete") {
        return Err("acknowledge_required".into());
    }

    let chapter = crate::mcp::tools::resolve_chapter(&root, &file)?;
    checkpoint(&root, tool.name, session.client())?;

    // Record the removal before the file goes, so blame keeps the attribution.
    if !body.is_empty() {
        let op = Op {
            seq: 0,
            ts: 0,
            author: format!("ai:{}", session.client()),
            kind: "delete".into(),
            from: 0,
            to: utf16_len(&body),
            text: body.clone(),
        };
        let _ = crate::ops::append_ops(&root, &chapter.id, "", &[op]);
    }
    fs::remove_file(&full).map_err(|_| "io".to_string())?;
    Ok(applied(&file, &format!("Deleted {file}."), json!({ "id": chapter.id })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::tools::tests::{body_of, commit_count, fixture, SECRET};
    use crate::mcp::tools::{call as tool_call, catalog};
    use crate::mcp::session::Scope;

    fn write_tools() -> Vec<&'static str> {
        catalog().iter().filter(|t| t.scope == Scope::Write).map(|t| t.name).collect()
    }

    /// Minimal valid arguments per write tool, so a refusal test exercises the
    /// gate rather than argument parsing.
    fn sample_args(name: &str, file: &str) -> Value {
        match name {
            "write_document" => json!({ "file": file, "content": "nuevo", "confirm": true }),
            "insert_text" => json!({ "file": file, "at": 0, "text": "x", "confirm": true }),
            "delete_text" => json!({ "file": file, "from": 0, "to": 1, "confirm": true }),
            "replace_text" => json!({ "file": file, "from": 0, "to": 1, "text": "x", "confirm": true }),
            "create_document" => json!({ "title": "Dos", "confirm": true }),
            "codex_upsert" => json!({ "kind": "characters", "id": "ana", "body": "# Ana", "confirm": true }),
            "git_commit" => json!({ "message": "agent", "confirm": true }),
            "delete_document" => json!({ "file": file, "confirm": true, "acknowledge_delete": true }),
            other => panic!("unmapped write tool {other}"),
        }
    }

    #[test]
    fn every_write_tool_is_refused_without_a_grant_and_changes_nothing() {
        let (fx, mut session) = fixture("codex", false);
        let before_body = body_of(&fx.root, &fx.chapter.file);
        let before_commits = commit_count(&fx.root);

        for name in write_tools() {
            let args = sample_args(name, &fx.chapter.file);
            assert_eq!(
                tool_call(&mut session, name, &args).unwrap_err(),
                "write_not_allowed",
                "{name} must refuse without a grant"
            );
        }

        assert_eq!(body_of(&fx.root, &fx.chapter.file), before_body);
        assert_eq!(commit_count(&fx.root), before_commits, "a denial must not commit");
        assert!(fx.root.join(&fx.chapter.file).exists());
        assert!(!fx.root.join("codex/characters/ana.md").exists());
    }

    #[test]
    fn a_granted_write_without_confirm_previews_and_touches_nothing() {
        let (fx, mut session) = fixture("claude-code", true);
        let before = commit_count(&fx.root);

        let out = tool_call(
            &mut session,
            "replace_text",
            &json!({ "file": fx.chapter.file, "from": 0, "to": 2, "text": "El" }),
        )
        .unwrap();

        assert!(out.text.starts_with("Preview only"));
        assert_eq!(out.structured.unwrap()["applied"], false);
        assert_eq!(body_of(&fx.root, &fx.chapter.file), SECRET);
        assert_eq!(commit_count(&fx.root), before);
    }

    #[test]
    fn a_confirmed_write_checkpoints_first_then_records_agent_ops() {
        let (fx, mut session) = fixture("claude-code", true);
        let before = commit_count(&fx.root);

        let out = tool_call(
            &mut session,
            "replace_text",
            &json!({ "file": fx.chapter.file, "from": 0, "to": 2, "text": "LA", "confirm": true }),
        )
        .unwrap();
        assert_eq!(out.structured.unwrap()["applied"], true);

        let body = body_of(&fx.root, &fx.chapter.file);
        assert!(body.starts_with("LA aguja"), "body was {body}");

        let log = crate::git::repo::log(&fx.root, 10).unwrap();
        assert!(log.len() > before);
        assert_eq!(log[0].message, "checkpoint: before mcp replace_text (claude-code)");

        let ops = crate::ops::recent_ops(&fx.root, &fx.chapter.id, 10).unwrap();
        assert!(ops.iter().all(|o| o.author == "ai:claude-code"));
        assert_eq!(ops.iter().map(|o| o.kind.as_str()).collect::<Vec<_>>(), vec!["delete", "insert"]);
        assert_eq!(ops[0].text, "La");
        assert_eq!((ops[1].from, ops[1].to), (0, 2));
    }

    #[test]
    fn an_agent_edit_keeps_the_chapter_synopsis() {
        // An agent edits prose. The synopsis an import kept on the chapter is
        // not prose, and no edit of the body may cost it.
        let (fx, mut session) = fixture("claude-code", true);
        let synopsis = "Ana dice: \"vete\".\n---\nY se va.";
        crate::commands::chapters::set_synopsis(&fx.root, &fx.chapter.file, synopsis).unwrap();
        let kept = |root: &Path| {
            let raw = fs::read_to_string(root.join(&fx.chapter.file)).unwrap();
            split_frontmatter(&raw).0.get("synopsis").cloned()
        };

        for (tool, args) in [
            ("write_document", json!({ "file": fx.chapter.file, "content": "Otra cosa.", "confirm": true })),
            ("insert_text", json!({ "file": fx.chapter.file, "at": 0, "text": "Ya. ", "confirm": true })),
            ("replace_text", json!({ "file": fx.chapter.file, "from": 0, "to": 3, "text": "Hoy", "confirm": true })),
            ("delete_text", json!({ "file": fx.chapter.file, "from": 0, "to": 4, "confirm": true })),
        ] {
            let out = tool_call(&mut session, tool, &args).unwrap();
            assert_eq!(out.structured.unwrap()["applied"], true, "{tool}");
            assert_eq!(kept(&fx.root).as_deref(), Some(synopsis), "{tool} lost the synopsis");
        }
        assert_eq!(body_of(&fx.root, &fx.chapter.file), "Otra cosa.");
    }

    #[test]
    fn a_write_waits_out_a_backup_reading_the_history_instead_of_failing() {
        // This process has no window to freeze, so it waits for a backup's
        // capture to end rather than refusing the agent.
        let (fx, mut session) = fixture("claude-code", true);
        let reading = |root: &Path, millis: u64| {
            let lock = crate::git::lock::RepoLock::acquire(root, Wait::TryOnly).unwrap();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(millis));
                drop(lock);
            })
        };

        // Longer than a commit on the app's main thread would wait.
        let backup = reading(&fx.root, 2500);
        let out = tool_call(
            &mut session,
            "replace_text",
            &json!({ "file": fx.chapter.file, "from": 0, "to": 2, "text": "LA", "confirm": true }),
        )
        .unwrap();
        backup.join().unwrap();
        assert_eq!(out.structured.unwrap()["applied"], true);
        assert_eq!(crate::git::repo::log(&fx.root, 1).unwrap()[0].message, "checkpoint: before mcp replace_text (claude-code)");

        // Its own commit tool, the same way.
        let backup = reading(&fx.root, 300);
        let out = tool_call(&mut session, "git_commit", &json!({ "message": "agent", "confirm": true })).unwrap();
        backup.join().unwrap();
        assert_eq!(out.structured.unwrap()["applied"], true);
        assert_eq!(crate::git::repo::log(&fx.root, 1).unwrap()[0].message, "agent");
    }

    #[test]
    fn offsets_are_utf16_and_a_split_surrogate_is_refused() {
        let (fx, mut session) = fixture("claude-code", true);
        // "Año 🌙 " — the emoji is one char but two UTF-16 units.
        let body = "Año 🌙 luna.";
        tool_call(
            &mut session,
            "write_document",
            &json!({ "file": fx.chapter.file, "content": body, "confirm": true }),
        )
        .unwrap();

        // Units: A=0 ñ=1 o=2 ' '=3 emoji=4..6 ' '=6 l=7 …
        let out = tool_call(
            &mut session,
            "replace_text",
            &json!({ "file": fx.chapter.file, "from": 4, "to": 6, "text": "🌞", "confirm": true }),
        );
        assert!(out.is_ok(), "{out:?}");
        assert_eq!(body_of(&fx.root, &fx.chapter.file), "Año 🌞 luna.");

        let before = commit_count(&fx.root);
        let split = tool_call(
            &mut session,
            "replace_text",
            &json!({ "file": fx.chapter.file, "from": 5, "to": 6, "text": "x", "confirm": true }),
        );
        assert_eq!(split.unwrap_err(), "bad_range");
        assert_eq!(commit_count(&fx.root), before, "a bad range must not commit");
        assert_eq!(body_of(&fx.root, &fx.chapter.file), "Año 🌞 luna.");
    }

    #[test]
    fn deleting_a_document_needs_a_second_acknowledgement() {
        let (fx, mut session) = fixture("claude-code", true);
        let before = commit_count(&fx.root);

        let refused = tool_call(
            &mut session,
            "delete_document",
            &json!({ "file": fx.chapter.file, "confirm": true }),
        );
        assert_eq!(refused.unwrap_err(), "acknowledge_required");
        assert!(fx.root.join(&fx.chapter.file).exists(), "the chapter must survive");
        assert_eq!(commit_count(&fx.root), before);

        let done = tool_call(
            &mut session,
            "delete_document",
            &json!({ "file": fx.chapter.file, "confirm": true, "acknowledge_delete": true }),
        )
        .unwrap();
        assert_eq!(done.structured.unwrap()["applied"], true);
        assert!(!fx.root.join(&fx.chapter.file).exists());

        let ops = crate::ops::recent_ops(&fx.root, &fx.chapter.id, 10).unwrap();
        assert_eq!(ops.last().unwrap().author, "ai:claude-code");
        assert_eq!(ops.last().unwrap().kind, "delete");
    }

    #[test]
    fn codex_upsert_creates_then_updates_and_rejects_a_bad_kind_or_id() {
        let (fx, mut session) = fixture("claude-code", true);

        let created = tool_call(
            &mut session,
            "codex_upsert",
            &json!({ "kind": "characters", "id": "bruno-vela", "body": "# Bruno", "confirm": true }),
        )
        .unwrap();
        assert_eq!(created.structured.unwrap()["created"], true);
        assert_eq!(fs::read_to_string(fx.root.join("codex/characters/bruno-vela.md")).unwrap(), "# Bruno");

        let updated = tool_call(
            &mut session,
            "codex_upsert",
            &json!({ "kind": "characters", "id": "bruno-vela", "body": "# Bruno Vela", "confirm": true }),
        )
        .unwrap();
        assert_eq!(updated.structured.unwrap()["created"], false);

        for bad in [
            json!({ "kind": "weapons", "id": "ana", "body": "x", "confirm": true }),
            json!({ "kind": "characters", "id": "../escape", "body": "x", "confirm": true }),
            json!({ "kind": "characters", "id": "", "body": "x", "confirm": true }),
        ] {
            assert_eq!(tool_call(&mut session, "codex_upsert", &bad).unwrap_err(), "bad_args");
        }
    }

    #[test]
    fn create_and_commit_preview_before_they_act() {
        let (fx, mut session) = fixture("claude-code", true);

        let preview = tool_call(&mut session, "create_document", &json!({ "title": "Dos" })).unwrap();
        assert_eq!(preview.structured.unwrap()["applied"], false);
        assert_eq!(crate::commands::chapters::list_chapters_inner(&fx.root).unwrap().len(), 1);

        let made = tool_call(&mut session, "create_document", &json!({ "title": "Dos", "confirm": true })).unwrap();
        assert_eq!(made.structured.unwrap()["applied"], true);
        assert_eq!(crate::commands::chapters::list_chapters_inner(&fx.root).unwrap().len(), 2);

        let dry = tool_call(&mut session, "git_commit", &json!({ "message": "wip" })).unwrap();
        assert_eq!(dry.structured.unwrap()["applied"], false);
        let done = tool_call(&mut session, "git_commit", &json!({ "message": "wip", "confirm": true })).unwrap();
        assert_eq!(done.structured.unwrap()["applied"], true);
        assert_eq!(crate::git::repo::log(&fx.root, 5).unwrap()[0].message, "wip");
    }

    #[test]
    fn a_missing_file_or_reversed_range_is_refused_without_committing() {
        let (fx, mut session) = fixture("claude-code", true);
        let before = commit_count(&fx.root);

        assert_eq!(
            tool_call(&mut session, "write_document",
                      &json!({ "file": "manuscript/nope.md", "content": "x", "confirm": true })).unwrap_err(),
            "not_found"
        );
        assert_eq!(
            tool_call(&mut session, "write_document",
                      &json!({ "file": "../outside.md", "content": "x", "confirm": true })).unwrap_err(),
            "not_found"
        );
        assert_eq!(
            tool_call(&mut session, "delete_text",
                      &json!({ "file": fx.chapter.file, "from": 5, "to": 2, "confirm": true })).unwrap_err(),
            "bad_range"
        );
        assert_eq!(commit_count(&fx.root), before);
    }

    #[test]
    fn the_tool_log_never_records_manuscript_text() {
        let (fx, mut session) = fixture("claude-code", true);

        // Exercise read and write paths that all handle the secret sentence.
        let _ = tool_call(&mut session, "read_document", &json!({ "file": fx.chapter.file }));
        let _ = tool_call(&mut session, "search", &json!({ "query": SECRET }));
        let _ = tool_call(&mut session, "write_document",
                          &json!({ "file": fx.chapter.file, "content": SECRET, "confirm": true }));
        let _ = tool_call(&mut session, "git_commit", &json!({ "message": SECRET, "confirm": true }));

        // read_from, not read(): the log belongs to this session's scratch dir,
        // so the assertion cannot be polluted by — or pollute — the real one.
        let entries = crate::mcp::log::read_from(&session.log_path(), 200);
        assert!(!entries.is_empty(), "the calls above must have been logged");
        for entry in entries {
            assert!(!entry.detail.contains(SECRET), "log leaked prose: {}", entry.detail);
        }
    }

    #[test]
    fn preview_marks_removed_and_added_lines() {
        let diff = preview("manuscript/ch-01.md", "uno\ndos\ntres", "uno\nDOS\ntres");
        assert!(diff.contains("--- a/manuscript/ch-01.md"));
        assert!(diff.contains("-dos"));
        assert!(diff.contains("+DOS"));
        assert!(diff.contains(" uno"));
        assert!(preview("f", "same", "same").contains("(no change)"));
    }
}
