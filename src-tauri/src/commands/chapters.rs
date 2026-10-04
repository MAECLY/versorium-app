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
    sort_chapters(root, &mut out);
    Ok(out)
}

/// Reading order: the project's own list first, then everything it never heard
/// of, by id.
///
/// The fallback is what makes the list safe to store. A chapter added by hand
/// or restored from a backup is not in it, and has to appear somewhere rather
/// than vanish; putting it after the ordered ones is the only placement that
/// does not claim to know where the writer wanted it.
fn sort_chapters(root: &Path, chapters: &mut [ChapterMeta]) {
    let order = crate::commands::project::load_meta(root)
        .map(|m| m.chapter_order)
        .unwrap_or_default();
    chapters.sort_by(|a, b| {
        let rank = |id: &str| order.iter().position(|o| o == id).unwrap_or(usize::MAX);
        rank(&a.id).cmp(&rank(&b.id)).then_with(|| a.id.cmp(&b.id))
    });
}

/// Put the chapters in this order.
///
/// Nothing on disk moves. `ids` may name a prefix of the novel rather than all
/// of it — moving the first chapter down is a two-element change — and an id
/// that is not a chapter of this project is refused rather than stored, because
/// a stored one would silently reorder a chapter that does not exist.
#[tauri::command]
pub fn reorder_chapters(path: PathBuf, ids: Vec<String>) -> Result<Vec<ChapterMeta>, String> {
    let mut meta = crate::commands::project::load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    let existing = list_chapters_inner(&path)?;

    let mut seen: Vec<String> = Vec::new();
    for id in ids {
        if !existing.iter().any(|c| c.id == id) {
            return Err("not_found".into());
        }
        if !seen.contains(&id) {
            seen.push(id);
        }
    }
    // Whatever was not named keeps the order it already had, after the rest.
    for chapter in &existing {
        if !seen.contains(&chapter.id) {
            seen.push(chapter.id.clone());
        }
    }

    meta.chapter_order = seen;
    crate::commands::project::write_meta(&path, &meta)?;
    list_chapters_inner(&path)
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
    let mut owned: Vec<(&str, String)> = Vec::new();
    if let Some(s) = status.as_deref() {
        owned.push(("status", yaml_string(s)));
    }
    owned.push(("words", words.to_string()));
    let mut out = String::from("---\n");
    out.push_str(&rewrite_header(header.unwrap_or_default(), &owned));
    out.push_str("---\n");
    out.push_str(&body);
    atomic_write(&full, out)?;
    parse_chapter_file(&full).ok_or_else(|| "not_found".to_string())
}

/// A frontmatter value on one line: JSON, which YAML reads as a double-quoted
/// string, so a title or a synopsis can hold quotes, backslashes and line
/// breaks without ever ending the frontmatter.
///
/// JSON leaves a few characters raw that YAML 1.1 readers treat as line breaks
/// (U+0085, U+2028, U+2029) or refuse as unprintable (DEL, the C1 controls, a
/// byte-order mark, U+FFFE and U+FFFF). Those are escaped as well, so other
/// tools read the line the way `split_frontmatter` does.
fn yaml_string(value: &str) -> String {
    let json = serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into());
    let mut out = String::with_capacity(json.len());
    for c in json.chars() {
        match c {
            '\u{7f}'..='\u{9f}' | '\u{2028}' | '\u{2029}' | '\u{feff}' | '\u{fffe}' | '\u{ffff}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// The frontmatter with these keys replaced: every other line kept as it was,
/// then each `key: value` appended, in order. Values arrive encoded.
///
/// A replaced key takes the lines that belong to it along: indented or blank
/// lines and `- ` items after it are its YAML block or list, written by hand.
/// Dropping only the key's own line would leave them hanging under whichever
/// key came before.
fn rewrite_header(header: &str, keys: &[(&str, String)]) -> String {
    let replaced = |line: &str| {
        !line.starts_with([' ', '\t'])
            && line.split_once(':').is_some_and(|(key, _)| keys.iter().any(|(k, _)| key.trim_end() == *k))
    };
    let belongs = |line: &str| {
        line.trim().is_empty() || line.starts_with([' ', '\t']) || line == "-" || line.starts_with("- ")
    };
    let mut out = String::new();
    let mut dropping = false;
    for line in header.lines() {
        if dropping && belongs(line) {
            continue;
        }
        dropping = replaced(line);
        if dropping {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    for (key, value) in keys {
        out.push_str(&format!("{key}: {value}\n"));
    }
    out
}

/// Keep a synopsis in the chapter's frontmatter, as `synopsis:`.
///
/// Written once, by an import; nothing in the app edits one yet. Every write
/// to a chapter afterwards keeps the line, because all of them keep keys they
/// do not own. Windows line endings become `\n`, and surrounding space goes:
/// an empty synopsis writes nothing rather than an empty key.
pub fn set_synopsis(root: &Path, file: &str, synopsis: &str) -> Result<Option<ChapterMeta>, String> {
    let text = synopsis.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    rewrite_frontmatter(root, file, &[("synopsis", yaml_string(text))]).map(Some)
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

    /// A project with `n` chapters, `ch-01`..`ch-0n`. `create_project` already
    /// makes the first one, named after the novel.
    fn seeded(dir: &Path, n: u32) -> PathBuf {
        let root = project(dir, "El largo invierno");
        for i in 2..=n {
            crate::commands::project::create_chapter(root.clone(), format!("Capítulo {i}")).unwrap();
        }
        root
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

    /// A synopsis that tries everything a line of YAML can trip on: quotes, a
    /// colon, a backslash, a `---` on a line of its own (which would end the
    /// frontmatter if it were written raw), a tab and a line separator.
    const SYNOPSIS: &str = "Ana dice: \"vete\".\n---\nY se va — sola, \\ sin mirar\tatrás.\u{2028}Fin.";

    fn synopsis_in(root: &Path, file: &str) -> Option<String> {
        let raw = fs::read_to_string(root.join(file)).unwrap();
        split_frontmatter(&raw).0.get("synopsis").cloned()
    }

    fn body_in(root: &Path, file: &str) -> String {
        split_frontmatter(&fs::read_to_string(root.join(file)).unwrap()).1
    }

    #[test]
    fn a_synopsis_survives_every_write_to_its_chapter() {
        let dir = tempfile::tempdir().unwrap();
        let root = seeded(dir.path(), 3);
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();
        set_synopsis(&root, &file, SYNOPSIS).unwrap();
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some(SYNOPSIS), "written");

        save_chapter(root.clone(), file.clone(), "Llovió.\n\n## Luego\n\nEscampó.".into(), None).unwrap();
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some(SYNOPSIS), "a save");
        assert_eq!(body_in(&root, &file), "Llovió.\n\n## Luego\n\nEscampó.");

        save_chapter(root.clone(), file.clone(), "Llovió.".into(), Some("revised".into())).unwrap();
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some(SYNOPSIS), "a save with a status");

        let renamed = update_chapter(root.clone(), file.clone(), Some("La salida".into()), None).unwrap();
        assert_eq!(renamed.title, "La salida");
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some(SYNOPSIS), "a rename");

        update_chapter(root.clone(), file.clone(), None, Some("final".into())).unwrap();
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some(SYNOPSIS), "a status change");

        // A reorder never opens a chapter file at all.
        let before = fs::read(root.join(&file)).unwrap();
        reorder_chapters(root.clone(), vec!["ch-03".into(), "ch-01".into()]).unwrap();
        assert_eq!(fs::read(root.join(&file)).unwrap(), before, "a reorder touched the chapter");

        // And the chapter still reads as itself.
        let chapter = list_chapters_inner(&root).unwrap().into_iter().find(|c| c.file == file).unwrap();
        assert_eq!((chapter.title.as_str(), chapter.status.as_str(), chapter.words), ("La salida", "final", 1));
        assert_eq!(body_in(&root, &file), "Llovió.");
    }

    #[test]
    fn a_synopsis_is_one_line_of_json_and_an_empty_one_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Una línea");
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();

        assert!(set_synopsis(&root, &file, "  \r\n ").unwrap().is_none());
        assert!(synopsis_in(&root, &file).is_none(), "an empty key was written");

        set_synopsis(&root, &file, "  Primera.\r\nSegunda.\r  ").unwrap();
        let raw = fs::read_to_string(root.join(&file)).unwrap();
        let line = raw.lines().find(|l| l.starts_with("synopsis:")).expect("a synopsis line");
        assert_eq!(line, "synopsis: \"Primera.\\nSegunda.\"", "Windows endings and the margins go");
        // The separators YAML 1.1 breaks a line on are escaped, not left raw.
        assert_eq!(yaml_string("a\u{2028}b\u{85}c"), "\"a\\u2028b\\u0085c\"");
    }

    #[test]
    fn replacing_a_key_drops_its_block_continuation() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Bloques");
        let file = list_chapters_inner(&root).unwrap()[0].file.clone();
        // Written by hand, as YAML allows: a folded title, a literal block, a list.
        fs::write(
            root.join(&file),
            "---\nid: ch-01\ntitle: >\n  Un título\n  plegado\nsynopsis: |\n  Primera línea\n\n  Tercera línea\n\
             tags:\n- noche\n- lluvia\npov: \"Ana\"\nwords: 2\n---\nDos palabras",
        )
        .unwrap();

        set_synopsis(&root, &file, "Nueva.").unwrap();
        let raw = fs::read_to_string(root.join(&file)).unwrap();
        assert!(!raw.contains("Primera línea") && !raw.contains("Tercera línea"), "{raw}");
        assert!(raw.contains("tags:\n- noche\n- lluvia\npov: \"Ana\"\n"), "another key's list went: {raw}");
        assert_eq!(synopsis_in(&root, &file).as_deref(), Some("Nueva."));

        update_chapter(root.clone(), file.clone(), Some("Otro".into()), None).unwrap();
        let raw = fs::read_to_string(root.join(&file)).unwrap();
        assert!(!raw.contains("Un título") && !raw.contains("plegado"), "{raw}");
        assert_eq!(split_frontmatter(&raw).0.get("title").map(String::as_str), Some("Otro"));

        // A list under a replaced key goes with it too.
        let listed = raw.replacen("synopsis: \"Nueva.\"\n", "synopsis:\n- uno\n- dos\n", 1);
        fs::write(root.join(&file), listed).unwrap();
        set_synopsis(&root, &file, "Otra.").unwrap();
        let raw = fs::read_to_string(root.join(&file)).unwrap();
        assert!(!raw.contains("- uno") && !raw.contains("- dos"), "{raw}");
        assert!(raw.contains("- noche"), "{raw}");
        assert!(raw.ends_with("---\nDos palabras"), "the body moved: {raw}");
    }

    #[test]
    fn reordering_moves_nothing_on_disk() {
        // The whole reason order is a list and not a numbering: git follows
        // paths, and `.versorium/ops/<id>` is keyed by the id the name encodes.
        let dir = tempfile::tempdir().unwrap();
        let root = seeded(dir.path(), 3);
        let before: Vec<String> = list_chapters_inner(&root).unwrap().iter().map(|c| c.file.clone()).collect();

        let after = reorder_chapters(root.clone(), vec!["ch-03".into(), "ch-01".into()]).unwrap();
        assert_eq!(
            after.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["ch-03", "ch-01", "ch-02"],
            "named ids come first, the rest keep their order"
        );
        let files: Vec<String> = after.iter().map(|c| c.file.clone()).collect();
        assert_eq!(
            files.iter().collect::<std::collections::HashSet<_>>(),
            before.iter().collect::<std::collections::HashSet<_>>(),
            "no file was renamed"
        );
        for file in &before {
            assert!(root.join(file).exists(), "{file} moved");
        }
    }

    #[test]
    fn a_chapter_nobody_ordered_still_appears() {
        // A chapter restored from a backup, or written by hand into the folder,
        // is not in the list. Vanishing would be the worst possible answer.
        let dir = tempfile::tempdir().unwrap();
        let root = seeded(dir.path(), 2);
        reorder_chapters(root.clone(), vec!["ch-02".into(), "ch-01".into()]).unwrap();

        fs::write(
            root.join("manuscript/ch-09-hallado.md"),
            render_chapter("ch-09", "Hallado", "draft", 0, "Apareció.\n"),
        )
        .unwrap();
        let listed = list_chapters_inner(&root).unwrap();
        assert_eq!(
            listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["ch-02", "ch-01", "ch-09"]
        );
    }

    #[test]
    fn an_id_that_is_not_a_chapter_here_is_refused_rather_than_stored() {
        let dir = tempfile::tempdir().unwrap();
        let root = seeded(dir.path(), 2);
        assert_eq!(
            reorder_chapters(root.clone(), vec!["ch-99".into()]).unwrap_err(),
            "not_found"
        );
        // And the order that was there is untouched.
        assert!(crate::commands::project::load_meta(&root).unwrap().chapter_order.is_empty());
    }

    #[test]
    fn the_same_id_twice_is_one_position() {
        let dir = tempfile::tempdir().unwrap();
        let root = seeded(dir.path(), 3);
        let after =
            reorder_chapters(root, vec!["ch-02".into(), "ch-02".into(), "ch-01".into()]).unwrap();
        assert_eq!(
            after.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["ch-02", "ch-01", "ch-03"]
        );
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
    let mut keys: Vec<(&str, String)> = Vec::new();
    if let Some(t) = title.as_deref() {
        keys.push(("title", yaml_string(t)));
    }
    if let Some(s) = status.as_deref() {
        keys.push(("status", yaml_string(s)));
    }
    rewrite_frontmatter(&path, &file, &keys)
}

/// What a chapter's status may be. The editor shows these; nothing could set
/// them until now, even though `save_chapter` has always written the field.
pub const STATUSES: [&str; 3] = ["draft", "revised", "final"];

/// Replace keys in a chapter's frontmatter and leave its body exactly as it is.
fn rewrite_frontmatter(root: &Path, file: &str, keys: &[(&str, String)]) -> Result<ChapterMeta, String> {
    let full = project_file(root, file)?;
    let text = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(&text).replace("\r\n", "\n");
    let (header, body) = match normalized.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---\n")) {
        Some((header, body)) => (header.to_string(), body.to_string()),
        // A chapter with no frontmatter still has a body worth keeping.
        None => (String::new(), normalized.clone()),
    };

    let mut out = String::from("---\n");
    out.push_str(&rewrite_header(&header, keys));
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
