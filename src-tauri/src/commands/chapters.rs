//! Chapter files: list, read, save (frontmatter owned by Rust, body by editor).

use crate::commands::project::{count_words, split_frontmatter, ChapterMeta};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const FM_KEYS: [&str; 5] = ["id", "title", "status", "pov", "words"];

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
    let text = fs::read_to_string(args.path.join(&args.file))
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
    let full = path.join(&file);
    let text = fs::read_to_string(&full).map_err(|_| "not_found".to_string())?;
    let (mut fm, _) = split_frontmatter(&text);
    if let Some(s) = status {
        fm.insert("status".into(), s);
    }
    let words = count_words(&body);
    fm.insert("words".into(), words.to_string());

    let mut out = String::from("---\n");
    for k in FM_KEYS {
        if let Some(v) = fm.get(k) {
            out.push_str(&format!("{k}: {v}\n"));
        }
    }
    out.push_str("---\n");
    out.push_str(&body);
    fs::write(&full, out).map_err(|_| "io".to_string())?;
    parse_chapter_file(&full).ok_or_else(|| "not_found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::render_chapter;

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
}
