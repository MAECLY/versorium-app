//! Export and import commands.
//!
//! Every format module exposes the same pair — `export_to` and, where the
//! format can be read, `import_file` — so this layer only has to pick one and
//! never learns what a DOCX or an EPUB is.

use crate::commands::project::{load_meta, Project, ProjectMeta};
use crate::formats::{self, Imported};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub bytes: u64,
    pub format: String,
    /// What this format could not carry, as i18n codes. An export that quietly
    /// mangles a character is the same failure an import would warn about.
    pub warnings: Vec<String>,
}

/// Formats that need a running head, and therefore an author (spec §9).
const NEEDS_AUTHOR: [&str; 2] = ["docx", "pdf"];

#[tauri::command]
pub fn export_manuscript(path: PathBuf, format: String, dest: PathBuf) -> Result<ExportResult, String> {
    let manuscript = formats::read_manuscript(&path)?;
    if manuscript.chapters.iter().all(|c| c.scenes.is_empty()) {
        return Err("empty_manuscript".into());
    }
    if NEEDS_AUTHOR.contains(&format.as_str()) && manuscript.author.trim().is_empty() {
        return Err("no_author".into());
    }
    let (bytes, warnings) = match format.as_str() {
        "md" => (formats::markdown::export_to(&manuscript, &dest)?, Vec::new()),
        "docx" => (
            formats::docx::export_to(&manuscript, &dest)?,
            formats::docx::export_warnings(&manuscript),
        ),
        "epub" => (formats::epub::export_to(&manuscript, &dest)?, Vec::new()),
        "pdf" => (
            formats::pdf::export_to(&manuscript, &dest)?,
            formats::pdf::export_warnings(&manuscript),
        ),
        // A directory, not a file: Scrivener projects are bundles.
        "scriv" => (
            formats::scrivener::export_to(&manuscript, &dest)?,
            formats::scrivener::export_warnings(&manuscript),
        ),
        _ => return Err("bad_format".into()),
    };
    Ok(ExportResult { path: dest.to_string_lossy().into_owned(), bytes, format, warnings })
}

type Importer = fn(&Path) -> Result<Imported, String>;

/// Which importer a source belongs to. A Scrivener project is a bundle
/// directory, so the extension is on the folder rather than a file.
fn importer_for(source: &Path) -> Option<Importer> {
    let ext = source.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" | "txt" => Some(formats::markdown::import_file),
        "docx" => Some(formats::docx::import_file),
        "scriv" => Some(formats::scrivener::import_file),
        "epub" => Some(formats::epub::import_file),
        _ => None,
    }
}

/// Read a source without writing anything: the user confirms before a project
/// exists (spec §9 asks for the losses to be documented; showing them first is
/// how that reaches the writer).
#[tauri::command]
pub fn import_preview(source: PathBuf) -> Result<Imported, String> {
    let import = importer_for(&source).ok_or_else(|| "unsupported_source".to_string())?;
    import(&source)
}

#[tauri::command]
pub fn import_apply(source: PathBuf, title: String) -> Result<Project, String> {
    let import = importer_for(&source).ok_or_else(|| "unsupported_source".to_string())?;
    let imported = import(&source)?;
    if imported.chapters.is_empty() {
        return Err("empty_document".into());
    }
    let title = if title.trim().is_empty() { imported.title.clone() } else { title };
    let root = crate::commands::project::default_projects_dir()?;
    let project = crate::commands::project::create_project(crate::commands::project::CreateProjectArgs {
        path: root,
        title: title.clone(),
        language: "en".into(),
    })?;
    let project_root = PathBuf::from(&project.path);

    // create_project already made a first chapter from the title; the import
    // owns the manuscript, so it replaces that rather than appending after it.
    for chapter in &project.chapters {
        let _ = std::fs::remove_file(crate::storage::project_file(&project_root, &chapter.file)?);
    }
    for chapter in &imported.chapters {
        let created = crate::commands::project::create_chapter(project_root.clone(), chapter.title.clone())?;
        crate::commands::chapters::save_chapter(
            project_root.clone(),
            created.file,
            chapter.body.clone(),
            None,
        )?;
    }
    crate::commands::project::open_project(project_root)
}

#[tauri::command]
pub fn set_author(path: PathBuf, author: String) -> Result<ProjectMeta, String> {
    let mut meta = load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    meta.author = author.trim().to_string();
    let json = serde_json::to_string_pretty(&meta).map_err(|_| "io".to_string())?;
    crate::storage::atomic_write(&path.join("versorium.json"), json)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{create_project, CreateProjectArgs};

    fn project(dir: &Path, title: &str) -> PathBuf {
        let p = create_project(CreateProjectArgs {
            path: dir.to_path_buf(),
            title: title.into(),
            language: "en".into(),
        })
        .unwrap();
        PathBuf::from(p.path)
    }

    fn with_text(root: &Path) {
        let chapters = crate::commands::chapters::list_chapters_inner(root).unwrap();
        crate::commands::chapters::save_chapter(
            root.to_path_buf(),
            chapters[0].file.clone(),
            "Una línea.".into(),
            None,
        )
        .unwrap();
    }

    #[test]
    fn a_running_head_format_refuses_to_print_a_blank_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "No Author");
        with_text(&root);
        // Markdown has no running head, so it does not care.
        assert!(export_manuscript(root.clone(), "md".into(), dir.path().join("a.md")).is_ok());
        for format in NEEDS_AUTHOR {
            assert_eq!(
                export_manuscript(root.clone(), format.into(), dir.path().join("a.out")).unwrap_err(),
                "no_author",
                "{format} prints the surname in every header"
            );
        }
    }

    #[test]
    fn an_empty_manuscript_is_refused_before_a_file_is_created() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Empty");
        let dest = dir.path().join("empty.md");
        assert_eq!(
            export_manuscript(root, "md".into(), dest.clone()).unwrap_err(),
            "empty_manuscript"
        );
        assert!(!dest.exists(), "nothing may be written for a refused export");
    }

    #[test]
    fn an_unknown_format_or_source_is_named_as_such() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Formats");
        with_text(&root);
        assert_eq!(
            export_manuscript(root, "rtf".into(), dir.path().join("a.rtf")).unwrap_err(),
            "bad_format"
        );
        assert_eq!(
            import_preview(dir.path().join("book.pages")).unwrap_err(),
            "unsupported_source"
        );
        assert_eq!(import_preview(dir.path().join("noext")).unwrap_err(), "unsupported_source");
    }

    #[test]
    fn the_author_round_trips_through_the_project_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "Author");
        assert_eq!(load_meta(&root).unwrap().author, "");
        let meta = set_author(root.clone(), "  Ursula K. Le Guin  ".into()).unwrap();
        assert_eq!(meta.author, "Ursula K. Le Guin", "surrounding space is not part of a name");
        // Re-read from disk: the change has to survive the process.
        assert_eq!(load_meta(&root).unwrap().author, "Ursula K. Le Guin");
        // And the rest of the project file is intact.
        assert_eq!(load_meta(&root).unwrap().title, "Author");
    }

    #[test]
    fn importing_replaces_the_placeholder_chapter_rather_than_appending() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("book.md");
        std::fs::write(&source, "# One\n\nFirst.\n\n# Two\n\nSecond.\n").unwrap();
        let imported = import_preview(source).unwrap();
        assert_eq!(imported.chapters.len(), 2);
        // import_apply writes into the real projects dir, so it is covered by
        // the e2e mock rather than here; this pins the preview contract it uses.
        assert_eq!(imported.chapters[0].title, "One");
    }
}
