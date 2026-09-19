//! Project lifecycle: create, open, list. One folder per novel,
//! one Markdown file per chapter (PROMPT §4 layout).

use crate::i18n;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub schema: u32,
    pub title: String,
    pub language: String,
    pub ui_language: String,
    pub default_chapter_pattern: String,
    pub censorship: String,
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterMeta {
    pub id: String,
    pub title: String,
    pub status: String,
    pub words: u32,
    /// Path relative to the project root, e.g. `manuscript/ch-01-the-long-winter.md`
    pub file: String,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub path: String,
    pub meta: ProjectMeta,
    pub chapters: Vec<ChapterMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectArgs {
    pub path: PathBuf,
    pub title: String,
    pub language: String,
}

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "family": std::env::consts::FAMILY,
    })
}

#[tauri::command]
pub fn default_projects_dir() -> Result<PathBuf, String> {
    dirs::document_dir()
        .ok_or_else(|| i18n::t("en", "no_home"))
        .map(|d| d.join("Versorium"))
}

#[tauri::command]
pub fn list_projects(path: PathBuf) -> Result<Vec<Project>, String> {
    let mut out: Vec<Project> = Vec::new();
    fs::create_dir_all(&path).map_err(|_| "io".to_string())?;
    let rd = fs::read_dir(&path).map_err(|_| "io".to_string())?;
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let meta = match load_meta(&p) {
            Some(m) => m,
            None => continue,
        };
        let chapters = crate::commands::chapters::list_chapters_inner(&p).unwrap_or_default();
        out.push(Project {
            path: p.to_string_lossy().into_owned(),
            meta,
            chapters,
        });
    }
    out.sort_by(|a, b| b.path.cmp(&a.path));
    Ok(out)
}

#[tauri::command]
pub fn create_project(args: CreateProjectArgs) -> Result<Project, String> {
    let title = args.title.trim().to_string();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    let root = args.path.join(slugify(&title));
    if root.exists() {
        return Err("project_exists".into());
    }
    for rel in [
        "manuscript",
        "codex/characters",
        "codex/locations",
        "codex/factions",
        "codex/items",
        "plot",
        "research",
        "style",
        "prompts",
        "snapshots",
        ".versorium/ops",
        ".versorium/embeddings",
        ".versorium/cache",
    ] {
        fs::create_dir_all(root.join(rel)).map_err(|_| "io".to_string())?;
    }
    let meta = ProjectMeta {
        schema: 1,
        title: title.clone(),
        language: args.language,
        ui_language: "en".into(),
        default_chapter_pattern: "ch-{n}-{slug}.md".into(),
        censorship: "off".into(),
        remote: None,
    };
    fs::write(
        root.join("versorium.json"),
        serde_json::to_string_pretty(&meta).map_err(|_| "io".to_string())?,
    )
    .map_err(|_| "io".to_string())?;

    let (id, file) = chapter_path_for(&meta, 1, &title);
    fs::write(
        root.join(&file),
        render_chapter(&id, &title, "draft", 0, ""),
    )
    .map_err(|_| "io".to_string())?;
    fs::write(root.join("codex/timeline.yml"), "# Timeline\n").map_err(|_| "io".to_string())?;
    fs::write(
        root.join("plot/outline.md"),
        format!("# Outline\n\n{title}\n"),
    )
    .map_err(|_| "io".to_string())?;
    fs::write(root.join("style/voice.md"), "# Voice\n").map_err(|_| "io".to_string())?;
    fs::write(root.join(".gitignore"), concat!(
        ".versorium/cache/\n.versorium/embeddings/\n.versorium/logs/\n",
        "models/\n*.gguf\n*.key\n*.pem\n.env\n.env.*\n",
        "settings.json\n.DS_Store\n.versorium-save-*.tmp\n"
    )).map_err(|_| "io".to_string())?;

    // M1: every project is a git repo from birth (libgit2, no system git).
    crate::git::repo::init_with_commit(&root).map_err(|_| "io".to_string())?;

    Ok(Project {
        path: root.to_string_lossy().into_owned(),
        meta,
        chapters: vec![ChapterMeta {
            id,
            title,
            status: "draft".into(),
            words: 0,
            file,
            mtime: now_secs(),
        }],
    })
}

#[tauri::command]
pub fn open_project(path: PathBuf) -> Result<Project, String> {
    let meta = load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    let chapters = crate::commands::chapters::list_chapters_inner(&path).map_err(|_| "io".to_string())?;
    Ok(Project {
        path: path.to_string_lossy().into_owned(),
        meta,
        chapters,
    })
}

#[tauri::command]
pub fn create_chapter(path: PathBuf, title: String) -> Result<ChapterMeta, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    let meta = load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    let chapters = crate::commands::chapters::list_chapters_inner(&path).map_err(|_| "io".to_string())?;
    let next = chapters
        .iter()
        .map(|c| c.id.split('-').nth(1).and_then(|n| n.parse::<u32>().ok()).unwrap_or(0))
        .max()
        .unwrap_or(0)
        + 1;
    let (id, file) = chapter_path_for(&meta, next, &title);
    let full = crate::storage::project_file(&path, &file)?;
    if full.exists() {
        return Err("project_exists".into());
    }
    crate::storage::atomic_write(&full, render_chapter(&id, &title, "draft", 0, ""))?;
    Ok(ChapterMeta {
        id,
        title,
        status: "draft".into(),
        words: 0,
        file,
        mtime: now_secs(),
    })
}

// ---------------------------------------------------------------- helpers

pub fn load_meta(root: &Path) -> Option<ProjectMeta> {
    fs::read_to_string(root.join("versorium.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn chapter_path_for(meta: &ProjectMeta, n: u32, title: &str) -> (String, String) {
    let id = format!("ch-{:02}", n);
    let name = meta
        .default_chapter_pattern
        .replace("{n}", &format!("{:02}", n))
        .replace("{slug}", &slugify(title));
    (id, format!("manuscript/{name}"))
}

pub fn render_chapter(id: &str, title: &str, status: &str, words: u32, body: &str) -> String {
    let mut s = String::from("---\n");
    s.push_str(&format!("id: {id}\n"));
    s.push_str(&format!("title: {}\n", yaml_scalar(title)));
    s.push_str(&format!("status: {status}\n"));
    s.push_str("pov: null\n");
    s.push_str(&format!("words: {words}\n"));
    s.push_str("---\n");
    s.push_str(body);
    s
}

/// Split a chapter file into (frontmatter map in canonical order, body).
/// Tolerant: missing or malformed frontmatter yields an empty map.
pub fn split_frontmatter(text: &str) -> (BTreeMap<String, String>, String) {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text).replace("\r\n", "\n");
    let trimmed = normalized.as_str();
    if !trimmed.starts_with("---\n") {
        return (BTreeMap::new(), text.to_string());
    }
    let rest = &trimmed[4..];
    let end = match rest.find("\n---\n") {
        Some(i) => i,
        None => return (BTreeMap::new(), text.to_string()),
    };
    let mut map = BTreeMap::new();
    for line in rest[..end].lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            let val = serde_json::from_str::<String>(v.trim()).unwrap_or_else(|_| v.trim().to_string());
            if !key.is_empty() {
                map.insert(key.to_string(), val);
            }
        }
    }
    let body_start = 4 + end + 5;
    let body = trimmed.get(body_start..).unwrap_or("").to_string();
    (map, body)
}

pub fn count_words(body: &str) -> u32 {
    body.split(|c: char| c.is_whitespace())
        .filter(|t| !t.is_empty())
        .count() as u32
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in s.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "untitled".into() } else { out }
}

fn yaml_scalar(s: &str) -> String {
    serde_json::to_string(s.trim()).unwrap_or_else(|_| "\"\"".into())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_titles() {
        assert_eq!(slugify("The Long Winter"), "the-long-winter");
        assert_eq!(slugify("  ¡Hola, Mundo! "), "hola-mundo");
        assert_eq!(slugify("###"), "untitled");
    }

    #[test]
    fn chapter_pattern_expands() {
        let meta = ProjectMeta {
            schema: 1,
            title: "T".into(),
            language: "en".into(),
            ui_language: "en".into(),
            default_chapter_pattern: "ch-{n}-{slug}.md".into(),
            censorship: "off".into(),
            remote: None,
        };
        assert_eq!(
            chapter_path_for(&meta, 7, "The Door"),
            ("ch-07".to_string(), "manuscript/ch-07-the-door.md".to_string())
        );
    }

    #[test]
    fn frontmatter_roundtrip() {
        let doc = render_chapter("ch-01", "El despertar", "draft", 12, "Caminó.\n");
        let (fm, body) = split_frontmatter(&doc);
        assert_eq!(fm.get("id").unwrap(), "ch-01");
        assert_eq!(fm.get("title").unwrap(), "El despertar");
        assert_eq!(fm.get("status").unwrap(), "draft");
        assert_eq!(fm.get("words").unwrap(), "12");
        assert_eq!(body, "Caminó.\n");
    }

    #[test]
    fn counts_words_locale_agnostic() {
        assert_eq!(count_words("hola  mundo   —  adiós"), 4);
        assert_eq!(count_words(""), 0);
    }

    #[test]
    fn create_project_initializes_git() {
        let dir = tempfile::tempdir().unwrap();
        let p = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Git Novel".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = PathBuf::from(&p.path);
        assert!(root.join(".git").is_dir());
        let st = crate::git::repo::status(&root).unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(st.modified.is_empty() && st.staged.is_empty() && st.untracked.is_empty());
        let log = crate::git::repo::log(&root, 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "m0: project created");
    }

    #[test]
    fn creates_full_project_tree() {
        let dir = tempfile::tempdir().unwrap();
        let title = "Prueba Unit";
        let root = dir.path().join(slugify(title));
        for rel in [
            "manuscript", "codex/characters", "codex/locations", "codex/factions",
            "codex/items", "plot", "research", "style", "prompts", "snapshots",
            ".versorium/ops", ".versorium/embeddings", ".versorium/cache",
        ] {
            fs::create_dir_all(root.join(rel)).unwrap();
        }
        let meta = ProjectMeta {
            schema: 1,
            title: title.into(),
            language: "es".into(),
            ui_language: "en".into(),
            default_chapter_pattern: "ch-{n}-{slug}.md".into(),
            censorship: "off".into(),
            remote: None,
        };
        fs::write(root.join("versorium.json"), serde_json::to_string_pretty(&meta).unwrap()).unwrap();
        let (id, file) = chapter_path_for(&meta, 1, title);
        fs::write(root.join(&file), render_chapter(&id, title, "draft", 0, "")).unwrap();

        assert!(root.join("versorium.json").exists());
        assert!(root.join(&file).exists());
        assert_eq!(load_meta(&root).unwrap().title, title);
    }
}
