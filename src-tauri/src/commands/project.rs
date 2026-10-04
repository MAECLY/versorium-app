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
    /// Standard Manuscript Format puts the surname in every running head, so
    /// the author belongs to the project rather than to the app. Defaulted so a
    /// project created before this field still loads.
    #[serde(default)]
    pub author: String,
    pub language: String,
    pub ui_language: String,
    pub default_chapter_pattern: String,
    pub censorship: String,
    pub remote: Option<String>,
    /// Chapter ids in reading order, when it differs from their numbering.
    ///
    /// Order lives here rather than in the filenames on purpose. Renumbering
    /// files to reorder them would rename every file after the moved one, and a
    /// chapter's path is what git history follows, what a backup archive
    /// contains and what `.versorium/ops/<id>` is keyed by — so a reorder would
    /// quietly orphan every keystroke ever recorded for half the novel.
    ///
    /// An override, not the whole truth: anything missing from this list still
    /// sorts by id, so a chapter dropped into `manuscript/` by hand appears
    /// rather than disappearing.
    #[serde(default)]
    pub chapter_order: Vec<String>,
    /// Put a title page at the front of an export.
    ///
    /// On by default: a manuscript that arrives with no title page makes the
    /// reader work out whose it is from the filename. Per project rather than
    /// per app, because the same writer submits a bare manuscript to an agent
    /// who asked for one and a bound-looking file to everybody else.
    #[serde(default = "yes")]
    pub export_cover: bool,
    /// Close an export with the project's own record and a line of thanks.
    ///
    /// Also on by default, and also refusable: nobody should have to ship an
    /// advert for their writing software inside their novel.
    #[serde(default = "yes")]
    pub export_colophon: bool,
}

/// `true`, as a function, because serde's `default` wants a path.
fn yes() -> bool {
    true
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

/// The languages a novel can be written in here.
///
/// The ones the interface has a name for (`languages` in `locales/*/ui.json`,
/// which a test holds this to), and so the only ones a picker can offer. The
/// value travels into the manuscript's `lang`, every export's language field
/// and the colophon's wording, so a code outside this list would be a promise
/// none of them can keep.
pub const LANGUAGES: [&str; 2] = ["en", "es"];

/// The language a tag names, if it is one a novel can be written in here.
///
/// Sources write tags every way BCP 47 allows and a few it does not: `es-MX`,
/// `ES`, Word's POSIX-style `en_US`. Only the primary subtag decides, because
/// that is all the app acts on, so a region is dropped rather than refused.
/// Something not shaped like a tag at all (`español`, `en-`) is refused, the
/// same shape `contentLanguage` in `src/lib/editor/preferences.ts` asks of a
/// `lang`.
pub fn language_code(raw: &str) -> Option<&'static str> {
    let tag = raw.trim().to_ascii_lowercase().replace('_', "-");
    let mut subtags = tag.split('-');
    let primary = subtags.next().unwrap_or_default();
    let shaped = (2..=3).contains(&primary.len())
        && primary.bytes().all(|b| b.is_ascii_lowercase())
        && subtags.all(|s| (1..=8).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric()));
    if !shaped {
        return None;
    }
    LANGUAGES.into_iter().find(|code| *code == primary)
}

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "family": std::env::consts::FAMILY,
    })
}

/// Called by the frontend after the first mount: reveal the (hidden) window.
#[tauri::command]
pub fn ui_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|_| "io".to_string())?;
    window.set_focus().map_err(|_| "io".to_string())
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
    // Most recently written first. The sidebar is called recent projects and
    // was sorted by path descending, which is reverse-alphabetical dressed up
    // as recency — it put "Zafiro" above the novel somebody edited an hour ago.
    out.sort_by(|a, b| touched(b).cmp(&touched(a)).then_with(|| a.meta.title.cmp(&b.meta.title)));
    Ok(out)
}

/// When a project was last written to: the newest mtime among its chapters.
///
/// The folder's own mtime is no good — it changes when anything inside is
/// added or removed, including a backup archive being written beside it.
fn touched(project: &Project) -> i64 {
    project.chapters.iter().map(|c| c.mtime).max().unwrap_or(0)
}

#[tauri::command]
pub fn create_project(args: CreateProjectArgs) -> Result<Project, String> {
    let title = args.title.trim().to_string();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    // Before the folder exists: a refused language must leave nothing behind.
    let language = language_code(&args.language).ok_or_else(|| "bad_language".to_string())?;
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
        author: String::new(),
        language: language.into(),
        ui_language: "en".into(),
        default_chapter_pattern: "ch-{n}-{slug}.md".into(),
        censorship: "off".into(),
        remote: None,
        chapter_order: Vec::new(),
        export_cover: true,
        export_colophon: true,
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

/// Persist a novel's metadata.
///
/// The one place `versorium.json` is written. It used to be inlined in
/// `commands::formats::set_author`, which is a strange home for the record of
/// what a novel is called.
pub fn write_meta(root: &Path, meta: &ProjectMeta) -> Result<(), String> {
    let json = serde_json::to_string_pretty(meta).map_err(|_| "io".to_string())?;
    crate::storage::atomic_write(&root.join("versorium.json"), json)
}

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
    fn renaming_a_novel_leaves_its_folder_where_everything_points_at_it() {
        // The folder is a git repository, it may already be a GitHub remote,
        // and the backup archives are named after it. A title is what the
        // writer reads; a folder name is an address.
        let dir = tempfile::tempdir().unwrap();
        let created = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "El faro".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&created.path);

        let meta = update_project(root.clone(), Some("La niebla".into()), None, None, None, None).unwrap();
        assert_eq!(meta.title, "La niebla");
        assert!(root.is_dir(), "the folder moved");
        assert_eq!(load_meta(&root).unwrap().title, "La niebla", "the rename did not persist");
        // And the git repository is still the same one.
        assert!(root.join(".git").exists());
    }

    #[test]
    fn a_novel_can_be_renamed_and_attributed_in_one_go_or_separately() {
        let dir = tempfile::tempdir().unwrap();
        let created = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Sin autor".into(),
            language: "en".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&created.path);

        let both = update_project(root.clone(), Some("Con autor".into()), Some("  Ana Ruiz  ".into()), None, None, None)
            .unwrap();
        assert_eq!(both.title, "Con autor");
        assert_eq!(both.author, "Ana Ruiz", "surrounding space is not part of a name");

        // Author alone leaves the title alone.
        let only_author = update_project(root.clone(), None, Some("Otra".into()), None, None, None).unwrap();
        assert_eq!(only_author.title, "Con autor");

        assert_eq!(update_project(root.clone(), None, None, None, None, None).unwrap_err(), "bad_args");
        assert_eq!(update_project(root, Some(" ".into()), None, None, None, None).unwrap_err(), "empty_title");
    }

    #[test]
    fn language_code_accepts_supported_tags_only() {
        for (raw, code) in [("es", "es"), ("en", "en"), (" ES-mx ", "es"), ("en_US", "en"), ("es-419", "es")] {
            assert_eq!(language_code(raw), Some(code), "{raw:?}");
        }
        // A language the app has no words for, nothing at all, and a name where
        // a code belongs are all refused rather than guessed at.
        for raw in ["fr", "", "   ", "español", "spanish", "esp", "-es", "en-", "e"] {
            assert_eq!(language_code(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn the_languages_offered_are_the_ones_the_interface_can_name() {
        // A picker offers what `languages` names. A code here without a name
        // would show up as a raw tag; a name without a code would be offered
        // and then refused.
        for (locale, raw) in [
            ("en", include_str!("../../../locales/en/ui.json")),
            ("es", include_str!("../../../locales/es/ui.json")),
        ] {
            let ui: serde_json::Value = serde_json::from_str(raw).unwrap();
            let mut named: Vec<&str> =
                ui["languages"].as_object().expect("languages").keys().map(String::as_str).collect();
            named.sort_unstable();
            let mut offered = LANGUAGES.to_vec();
            offered.sort_unstable();
            assert_eq!(named, offered, "locales/{locale}/ui.json");
        }
    }

    #[test]
    fn a_novels_language_can_be_changed_and_only_to_one_offered() {
        let dir = tempfile::tempdir().unwrap();
        let created = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "El faro".into(),
            language: "en".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&created.path);
        update_project(root.clone(), None, Some("Ana Ruiz".into()), Some(false), None, None).unwrap();

        // A language alone is a change, not a call with nothing in it.
        let meta = update_project(root.clone(), None, None, None, None, Some("es-ES".into())).unwrap();
        assert_eq!(meta.language, "es", "stored as the code it names");
        let on_disk = load_meta(&root).unwrap();
        assert_eq!(on_disk.language, "es", "the change did not reach versorium.json");
        assert_eq!(on_disk.title, "El faro");
        assert_eq!(on_disk.author, "Ana Ruiz");
        assert!(!on_disk.export_cover, "an unrelated setting was reset");

        // Refused before anything is written: the file is byte for byte the same.
        let before = fs::read(root.join("versorium.json")).unwrap();
        assert_eq!(
            update_project(root.clone(), Some("Otro".into()), None, None, None, Some("fr".into())).unwrap_err(),
            "bad_language"
        );
        assert_eq!(fs::read(root.join("versorium.json")).unwrap(), before, "a refused call wrote anyway");
    }

    #[test]
    fn create_project_refuses_a_language_it_cannot_offer() {
        let dir = tempfile::tempdir().unwrap();
        let refused = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Le phare".into(),
            language: "fr".into(),
        });
        assert_eq!(refused.unwrap_err(), "bad_language");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0, "a folder was left behind");

        // And one it can is stored as its code.
        let created = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "El faro".into(),
            language: "ES_mx".into(),
        })
        .unwrap();
        assert_eq!(created.meta.language, "es");
        assert_eq!(load_meta(std::path::Path::new(&created.path)).unwrap().language, "es");
    }

    #[test]
    fn deleting_refuses_anything_that_is_not_a_versorium_project() {
        // This moves a whole folder to the trash. A path that is not a novel
        // must never reach that call — somebody's Documents folder is one bad
        // argument away.
        let dir = tempfile::tempdir().unwrap();
        let stranger = dir.path().join("not-a-novel");
        std::fs::create_dir_all(&stranger).unwrap();
        std::fs::write(stranger.join("taxes.pdf"), b"important").unwrap();

        assert_eq!(
            delete_project(stranger.clone(), dir.path().to_path_buf()).unwrap_err(),
            "not_found"
        );
        assert!(stranger.join("taxes.pdf").exists(), "trashed a folder that was not a project");
    }

    /// Really moves a folder to this machine's trash, so it is opt-in.
    #[test]
    #[ignore = "moves a folder to the system trash"]
    fn live_deleting_a_novel_sends_it_to_the_trash_rather_than_destroying_it() {
        let dir = tempfile::tempdir().unwrap();
        let created = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Versorium trash test".into(),
            language: "en".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&created.path);
        assert!(root.is_dir());

        let left = delete_project(root.clone(), dir.path().to_path_buf()).unwrap();
        assert!(left.is_empty(), "the novel is gone from the list");
        assert!(!root.exists(), "the folder is gone from where it was");
        eprintln!("check the trash for: {}", root.display());
    }

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
            author: String::new(),
            language: "en".into(),
            ui_language: "en".into(),
            default_chapter_pattern: "ch-{n}-{slug}.md".into(),
            censorship: "off".into(),
            remote: None,
            chapter_order: Vec::new(),
            export_cover: true,
            export_colophon: true,
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
            author: String::new(),
            language: "es".into(),
            ui_language: "en".into(),
            default_chapter_pattern: "ch-{n}-{slug}.md".into(),
            censorship: "off".into(),
            remote: None,
            chapter_order: Vec::new(),
            export_cover: true,
            export_colophon: true,
        };
        fs::write(root.join("versorium.json"), serde_json::to_string_pretty(&meta).unwrap()).unwrap();
        let (id, file) = chapter_path_for(&meta, 1, title);
        fs::write(root.join(&file), render_chapter(&id, title, "draft", 0, "")).unwrap();

        assert!(root.join("versorium.json").exists());
        assert!(root.join(&file).exists());
        assert_eq!(load_meta(&root).unwrap().title, title);
    }


    #[test]
    fn the_recent_list_is_actually_ordered_by_recency() {
        // It used to sort by path descending, which is reverse-alphabetical
        // dressed up as recency: "Zafiro" sat above the novel edited an hour
        // ago.
        let dir = tempfile::tempdir().unwrap();
        for title in ["Alfa", "Zafiro"] {
            create_project(CreateProjectArgs {
                path: dir.path().to_path_buf(),
                title: title.into(),
                language: "es".into(),
            })
            .unwrap();
        }

        // Touch Alfa's chapter so it is the most recently written.
        let alfa = dir.path().join("alfa");
        let chapters = crate::commands::chapters::list_chapters_inner(&alfa).unwrap();
        let file = alfa.join(&chapters[0].file);
        // Set the mtime explicitly rather than rewriting and hoping: two writes
        // in the same second are indistinguishable on a one-second filesystem.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(120);
        fs::File::options().write(true).open(&file).unwrap().set_modified(later).unwrap();

        let listed = list_projects(dir.path().to_path_buf()).unwrap();
        assert_eq!(
            listed.iter().map(|p| p.meta.title.as_str()).collect::<Vec<_>>(),
            ["Alfa", "Zafiro"]
        );
    }
}

/// Rename a novel, set its author, its export matter or its language, in any
/// combination.
///
/// Only `versorium.json` changes. The folder keeps its name: it is a git
/// repository, it may already be a GitHub remote, and the backup archives are
/// named after it. A title is what the writer reads; a folder name is an
/// address, and quietly changing an address breaks whatever pointed at it.
///
/// A language is stored as the code it names (`es-MX` becomes `es`), and one
/// the app cannot offer is refused before anything is written.
#[tauri::command]
pub fn update_project(
    path: PathBuf,
    title: Option<String>,
    author: Option<String>,
    export_cover: Option<bool>,
    export_colophon: Option<bool>,
    language: Option<String>,
) -> Result<ProjectMeta, String> {
    let title = match title {
        Some(t) if t.trim().is_empty() => return Err("empty_title".into()),
        Some(t) => Some(t.trim().to_string()),
        None => None,
    };
    let language = match language {
        Some(raw) => Some(language_code(&raw).ok_or_else(|| "bad_language".to_string())?),
        None => None,
    };
    if title.is_none()
        && author.is_none()
        && export_cover.is_none()
        && export_colophon.is_none()
        && language.is_none()
    {
        return Err("bad_args".into());
    }
    let mut meta = load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    if let Some(title) = title {
        meta.title = title;
    }
    if let Some(language) = language {
        meta.language = language.into();
    }
    if let Some(author) = author {
        meta.author = author.trim().to_string();
    }
    if let Some(cover) = export_cover {
        meta.export_cover = cover;
    }
    if let Some(colophon) = export_colophon {
        meta.export_colophon = colophon;
    }
    write_meta(&path, &meta)?;
    Ok(meta)
}

/// Move a novel to the system trash.
///
/// Not `remove_dir_all`. Git cannot help here — deleting the folder takes the
/// repository and every snapshot in it — so the recovery has to be the one the
/// writer already knows: their own desktop's trash, where the folder sits until
/// they empty it.
///
/// Returns the remaining projects so the caller does not have to re-scan.
#[tauri::command]
pub fn delete_project(path: PathBuf, parent: PathBuf) -> Result<Vec<Project>, String> {
    if load_meta(&path).is_none() {
        // Refusing anything that is not a Versorium project is what stops a bad
        // path from trashing a folder full of something else.
        return Err("not_found".into());
    }
    trash::delete(&path).map_err(|_| "trash_failed".to_string())?;
    list_projects(parent)
}
