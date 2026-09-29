//! Chapter files: list, read, save (frontmatter owned by Rust, body by editor).

use crate::commands::project::{count_words, split_frontmatter, ChapterMeta};
use crate::storage::{atomic_write, project_file};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

pub fn list_chapters_inner(root: &Path) -> Result<Vec<ChapterMeta>, String> {
    let dir = root.join("manuscript");
    let rd = fs::read_dir(&dir).map_err(|_| "io".to_string())?;
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("ch-") || !name.ends_with(".md") {
            continue;
        }
        if let Some(cm) = parse_chapter_file(&p) {
            out.push(cm);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn parse_chapter_file(path: &Path) -> Option<ChapterMeta> {
    let text = fs::read_to_string(path).ok()?;
    let (fm, body) = split_frontmatter(&text);
    let name = path.file_name()?.to_string_lossy();
    let rel = name.strip_suffix(".md")?;
    let mtime = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Some(ChapterMeta {
        id: fm.get("id").cloned().unwrap_or_else(|| rel.to_string()),
        title: fm.get("title").cloned().unwrap_or_else(|| rel.to_string()),
        status: fm.get("status").cloned().unwrap_or_else(|| "draft".into()),
        words: count_words(&body),
        file: format!("manuscript/{rel}.md"),
        mtime,
    })
}

#[tauri::command]
pub fn list_chapters(path: PathBuf) -> Result<Vec<ChapterMeta>, String> {
    list_chapters_inner(&path)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRef {
    pub path: PathBuf,
    pub file: String,
}

#[tauri::command]
pub fn read_chapter(args: ChapterRef) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(project_file(&args.path, &args.file)?)
        .map_err(|_| "not_found".to_string())?;
    let (fm, body) = split_frontmatter(&text);
    Ok(serde_json::json!({ "frontmatter": fm, "body": body }))
}

#[tauri::command]
pub fn save_chapter(
    path: PathBuf,
    file: String,
    body: String,
    status: Option<String>,
) -> Result<ChapterMeta, String> {
    let full = project_file(&path, &file)?;
    let text = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let words = count_words(&body);
    // Keep author-supplied YAML (including unknown keys and multiline values).
    // Only fields owned by this command are replaced.
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(&text).replace("\r\n", "\n");
    let header = normalized.strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n").map(|(fm, _)| fm));
    let mut out = String::from("---\n");
    for line in header.unwrap_or_default().lines() {
        if line.starts_with("words:") || (status.is_some() && line.starts_with("status:")) {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if let Some(s) = status {
        out.push_str(&format!("status: {}\n", serde_json::to_string(&s).map_err(|_| "io")?));
    }
    out.push_str(&format!("words: {words}\n"));
    out.push_str("---\n");
    out.push_str(&body);
    atomic_write(&full, out)?;
    parse_chapter_file(&full).ok_or_else(|| "not_found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::render_chapter;

    fn project(dir: &Path, title: &str) -> PathBuf {
        let p = crate::commands::project::create_project(crate::commands::project::CreateProjectArgs {
            path: dir.to_path_buf(),
            title: title.into(),
            language: "es".into(),
        })
        .unwrap();
        PathBuf::from(p.path)
    }

    #[test]
    fn retitling_leaves_the_file_and_its_history_exactly_where_they_were() {
        // The whole reason a retitle is frontmatter-only: the filename carries
        // the chapter's position, git follows paths, and `.versorium/ops/<id>`
        // is keyed by the id that name encodes.
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "El faro");
        let before = list_chapters_inner(&root).unwrap();
        let file = before[0].file.clone();
        let id = before[0].id.clone();

        let after = update_chapter(root.clone(), file.clone(), Some("La llegada".into()), None).unwrap();
        assert_eq!(after.title, "La llegada");
        assert_eq!(after.file, file, "the file moved");
        assert_eq!(after.id, id, "the id moved, which would orphan the ops log");
        assert!(root.join(&file).is_file());
    }

    #[test]
    fn the_status_can_finally_be_changed() {
        // Rust has always written this field and the UI has always shown it;
        // nothing could ever set it.
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Estados");
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();

        for status in STATUSES {
            let meta = update_chapter(root.clone(), file.clone(), None, Some(status.into())).unwrap();
            assert_eq!(meta.status, status);
        }
        assert_eq!(
            update_chapter(root.clone(), file, None, Some("brilliant".into())).unwrap_err(),
            "bad_args",
            "an unknown status must not reach the file"
        );
    }

    #[test]
    fn an_edit_that_changes_nothing_is_refused_rather_than_rewriting_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Nada");
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();
        assert_eq!(update_chapter(root.clone(), file.clone(), None, None).unwrap_err(), "bad_args");
        // An empty title would leave a chapter nobody can identify in the binder.
        assert_eq!(
            update_chapter(root, file, Some("   ".into()), None).unwrap_err(),
            "empty_title"
        );
    }

    #[test]
    fn retitling_keeps_the_body_and_any_key_the_writer_added_themselves() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Conserva");
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();
        let full = root.join(&file);

        // A key this app knows nothing about, and real prose.
        let raw = fs::read_to_string(&full).unwrap();
        let raw = raw.replacen("---\n", "---\npov: \"Ana\"\n", 1);
        fs::write(&full, format!("{raw}La niña esperó junto a la ventana.")).unwrap();

        update_chapter(root.clone(), file.clone(), Some("Otro".into()), None).unwrap();
        let after = fs::read_to_string(&full).unwrap();
        assert!(after.contains("pov: \"Ana\""), "dropped a key the writer added: {after}");
        assert!(after.contains("La niña esperó"), "lost the prose: {after}");
        assert!(after.contains("title: \"Otro\""));
    }

    #[test]
    fn deleting_a_chapter_snapshots_it_first_so_it_can_come_back() {
        // A confirmation dialog is not a safety net. The project's own git
        // history is.
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Borrado");
        crate::commands::project::create_chapter(root.clone(), "Segundo".into()).unwrap();
        let chapters = list_chapters_inner(&root).unwrap();
        assert_eq!(chapters.len(), 2);
        let doomed = chapters[1].file.clone();

        let left = delete_chapter(root.clone(), doomed.clone()).unwrap();
        assert_eq!(left.len(), 1, "the chapter is gone from the binder");
        assert!(!root.join(&doomed).exists(), "the file is gone from disk");

        // And recoverable: the commit before the delete has it.
        let log = crate::git::repo::log(&root, 10).unwrap();
        assert!(
            log.iter().any(|c| c.message.contains("before deleting")),
            "no snapshot was taken: {:?}",
            log.iter().map(|c| &c.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn the_ops_history_of_a_deleted_chapter_is_kept() {
        // Restoring text from git without the record of how it was written
        // would return the words and lose the provenance — including which of
        // them an AI wrote.
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Historial");
        let chapters = list_chapters_inner(&root).unwrap();
        let file = chapters[0].file.clone();
        let id = chapters[0].id.clone();
        crate::ops::append_ops(&root, &id, "hola", &[crate::ops::Op {
            seq: 0, ts: 0, author: "human".into(), kind: "insert".into(),
            from: 0, to: 4, text: "hola".into(),
        }])
        .unwrap();

        crate::commands::project::create_chapter(root.clone(), "Otro".into()).unwrap();
        delete_chapter(root.clone(), file).unwrap();
        assert!(
            root.join(".versorium").join("ops").join(&id).exists(),
            "the keystroke history went with the file"
        );
    }

    #[test]
    fn deleting_something_that_is_not_there_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Ausente");
        assert_eq!(
            delete_chapter(root, "manuscript/ch-99-nope.md".into()).unwrap_err(),
            "not_found"
        );
    }

    fn tmp_project() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("manuscript")).unwrap();
        fs::write(
            root.join("manuscript/ch-01-hello.md"),
            render_chapter("ch-01", "Hello", "draft", 0, "One two three.\n"),
        )
        .unwrap();
        (dir, root)
    }

    #[test]
    fn lists_and_reads() {
        let (_dir, root) = tmp_project();
        let chapters = list_chapters_inner(&root).unwrap();
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].id, "ch-01");
        assert_eq!(chapters[0].words, 3);

        let v = read_chapter(ChapterRef {
            path: root.clone(),
            file: "manuscript/ch-01-hello.md".into(),
        })
        .unwrap();
        assert_eq!(v["body"], "One two three.\n");
    }

    #[test]
    fn save_updates_word_count() {
        let (_dir, root) = tmp_project();
        let cm = save_chapter(root.clone(), "manuscript/ch-01-hello.md".into(), "a b c d e".into(), None).unwrap();
        assert_eq!(cm.words, 5);
        let raw = fs::read_to_string(root.join("manuscript/ch-01-hello.md")).unwrap();
        assert!(raw.contains("words: 5"));
    }

    #[test]
    fn save_preserves_custom_yaml_and_quoted_title() {
        let (_dir, root) = tmp_project();
        let file = "manuscript/ch-01-hello.md";
        fs::write(root.join(file), "---\r\nid: ch-01\r\ntitle: \"A: \\\"quote\\\"\"\r\ntags: [night, rain]\r\nsummary: |\r\n  Keep this line\r\nwords: 1\r\n---\r\nold").unwrap();
        let saved = save_chapter(root.clone(), file.into(), "new body".into(), None).unwrap();
        assert_eq!(saved.title, "A: \"quote\"");
        let raw = fs::read_to_string(root.join(file)).unwrap();
        assert!(raw.contains("tags: [night, rain]\nsummary: |\n  Keep this line\n"));
        assert!(raw.ends_with("---\nnew body"));
        assert!(save_chapter(root, "../outside.md".into(), "bad".into(), None).is_err());
    }
}

/// Retitle a chapter, or change its status, or both.
///
/// Only the frontmatter moves. The filename stays exactly as it is, and that is
/// deliberate: the name carries the chapter's position, git follows paths, and
/// `.versorium/ops/<id>` and `snapshots/<id>` are keyed by the id the name
/// encodes. Renaming the file to match a new title would orphan every keystroke
/// ever recorded for that chapter.
#[tauri::command]
pub fn update_chapter(
    path: PathBuf,
    file: String,
    title: Option<String>,
    status: Option<String>,
) -> Result<ChapterMeta, String> {
    let title = match title {
        Some(t) if t.trim().is_empty() => return Err("empty_title".into()),
        Some(t) => Some(t.trim().to_string()),
        None => None,
    };
    if let Some(status) = status.as_deref() {
        if !STATUSES.contains(&status) {
            return Err("bad_args".into());
        }
    }
    if title.is_none() && status.is_none() {
        return Err("bad_args".into());
    }
    retitle_in(&path, &file, title, status)
}

/// What a chapter's status may be. The editor shows these; nothing could set
/// them until now, even though `save_chapter` has always written the field.
pub const STATUSES: [&str; 3] = ["draft", "revised", "final"];

fn retitle_in(
    root: &Path,
    file: &str,
    title: Option<String>,
    status: Option<String>,
) -> Result<ChapterMeta, String> {
    let full = project_file(root, file)?;
    let text = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(&text).replace("\r\n", "\n");
    let (header, body) = match normalized.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---\n")) {
        Some((header, body)) => (header.to_string(), body.to_string()),
        // A chapter with no frontmatter still has a body worth keeping.
        None => (String::new(), normalized.clone()),
    };

    let mut out = String::from("---\n");
    for line in header.lines() {
        let replaced = (title.is_some() && line.starts_with("title:"))
            || (status.is_some() && line.starts_with("status:"));
        if replaced {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if let Some(t) = title.as_ref() {
        out.push_str(&format!("title: {}\n", serde_json::to_string(t).map_err(|_| "io")?));
    }
    if let Some(s) = status.as_ref() {
        out.push_str(&format!("status: {}\n", serde_json::to_string(s).map_err(|_| "io")?));
    }
    out.push_str("---\n");
    out.push_str(&body);

    atomic_write(&full, out)?;
    parse_chapter_file(&full).ok_or_else(|| "not_found".to_string())
}

/// Delete a chapter.
///
/// A git snapshot is taken first, so this is recoverable from the project's own
/// history — which is a stronger guarantee than a confirmation dialog, and the
/// reason this does not need a trash folder of its own.
///
/// The `.versorium/ops` and `snapshots` trees for the chapter are deliberately
/// left in place: they are the record of how the chapter was written, they cost
/// kilobytes, and destroying them would make a restore from git return the text
/// without its history.
#[tauri::command]
pub fn delete_chapter(path: PathBuf, file: String) -> Result<Vec<ChapterMeta>, String> {
    let full = crate::storage::project_file(&path, &file)?;
    if !full.is_file() {
        return Err("not_found".into());
    }
    // Before the write, never after: if the snapshot fails there is nothing to
    // recover from and the delete must not happen.
    if let Err(e) = crate::git::repo::commit_all(&path, &format!("checkpoint: before deleting {file}")) {
        if e != "nothing_to_commit" {
            return Err(e);
        }
    }
    fs::remove_file(&full).map_err(|_| "io".to_string())?;
    list_chapters_inner(&path)
}
