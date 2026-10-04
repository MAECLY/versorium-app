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
pub fn export_manuscript(
    state: tauri::State<crate::commands::settings::SettingsStore>,
    path: PathBuf,
    format: String,
    dest: PathBuf,
    labels: Option<formats::Labels>,
) -> Result<ExportResult, String> {
    export_with(&state.get().active_author().clone(), path, format, dest, labels)
}

/// The command body without Tauri's `State`, which cannot be built in a test.
fn export_with(
    profile: &crate::commands::settings::AuthorProfile,
    path: PathBuf,
    format: String,
    dest: PathBuf,
    labels: Option<formats::Labels>,
) -> Result<ExportResult, String> {
    // The project's own author still wins; the profile fills in what a project
    // file has never had a place for, and supplies a name when it has none.
    let mut manuscript =
        formats::read_manuscript(&path)?.with_byline(&profile.name, profile.byline());
    // Colophon wording arrives from the frontend, the only side with a
    // dictionary. It is read by whoever opens the book, so it follows the
    // manuscript's language rather than the app's.
    if let Some(labels) = labels {
        manuscript.matter.labels = labels;
    }
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

/// Make a project from a source the writer has previewed.
///
/// `language` is the one the import dialog settled on: what the source said,
/// or what the writer chose when it said nothing or said something this app
/// cannot use.
#[tauri::command]
pub fn import_apply(source: PathBuf, title: String, language: String) -> Result<Project, String> {
    import_into(&crate::commands::project::default_projects_dir()?, &source, title, &language)
}

/// The command body, with the folder the project goes into as an argument
/// rather than the writer's real Documents, so a test can run the whole apply.
fn import_into(dir: &Path, source: &Path, title: String, language: &str) -> Result<Project, String> {
    // Before the source is even read: a language the novel cannot take leaves
    // no folder behind and says so, rather than failing on something else.
    let language = crate::commands::project::language_code(language).ok_or_else(|| "bad_language".to_string())?;
    let import = importer_for(source).ok_or_else(|| "unsupported_source".to_string())?;
    let imported = import(source)?;
    if imported.chapters.is_empty() {
        return Err("empty_document".into());
    }
    let title = if title.trim().is_empty() { imported.title.clone() } else { title };
    let project = crate::commands::project::create_project(crate::commands::project::CreateProjectArgs {
        path: dir.to_path_buf(),
        title: title.clone(),
        language: language.into(),
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
            created.file.clone(),
            chapter.body.clone(),
            None,
        )?;
        // Scrivener's card text. Kept on the chapter, where the corkboard reads
        // it and a Scrivener export writes it back.
        if let Some(synopsis) = chapter.synopsis.as_deref() {
            crate::commands::chapters::set_synopsis(&project_root, &created.file, synopsis)?;
        }
    }
    crate::commands::project::open_project(project_root)
}

#[tauri::command]
pub fn set_author(path: PathBuf, author: String) -> Result<ProjectMeta, String> {
    let mut meta = load_meta(&path).ok_or_else(|| "not_found".to_string())?;
    meta.author = author.trim().to_string();
    crate::commands::project::write_meta(&path, &meta)?;
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
        assert!(export_with(&Default::default(), root.clone(), "md".into(), dir.path().join("a.md"), None).is_ok());
        for format in NEEDS_AUTHOR {
            assert_eq!(
                export_with(&Default::default(), root.clone(), format.into(), dir.path().join("a.out"), None).unwrap_err(),
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
            export_with(&Default::default(), root, "md".into(), dest.clone(), None).unwrap_err(),
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
            export_with(&Default::default(), root, "rtf".into(), dir.path().join("a.rtf"), None).unwrap_err(),
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
        let imported = import_preview(source.clone()).unwrap();
        assert_eq!(imported.chapters.len(), 2);
        assert_eq!(imported.chapters[0].title, "One");

        let novels = dir.path().join("novels");
        let project = import_into(&novels, &source, "Book".into(), "en").unwrap();
        let titles: Vec<&str> = project.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, ["One", "Two"], "the placeholder chapter is gone");
    }

    /// A Markdown source whose frontmatter says Spanish.
    fn spanish_source(dir: &Path) -> PathBuf {
        let source = dir.join("libro.md");
        std::fs::write(&source, "---\ntitle: \"El libro\"\nlanguage: es\n---\n# Uno\n\nPrimero.\n").unwrap();
        source
    }

    #[test]
    fn an_import_takes_the_language_it_was_given() {
        let dir = tempfile::tempdir().unwrap();
        let source = spanish_source(dir.path());

        let novels = dir.path().join("novels");
        let project = import_into(&novels, &source, "Uno".into(), "es").unwrap();
        assert_eq!(project.meta.language, "es");
        assert_eq!(load_meta(Path::new(&project.path)).unwrap().language, "es", "versorium.json says otherwise");

        // What the writer chose wins over what the file says.
        let project = import_into(&novels, &source, "Dos".into(), "en-GB").unwrap();
        assert_eq!(load_meta(Path::new(&project.path)).unwrap().language, "en");

        // And a language no novel can take is refused before anything exists,
        // and before the source is read: a missing file is not what is said.
        let empty = dir.path().join("empty");
        assert_eq!(import_into(&empty, &source, "Tres".into(), "xx").unwrap_err(), "bad_language");
        assert_eq!(import_into(&empty, &dir.path().join("gone.md"), "Cuatro".into(), "xx").unwrap_err(), "bad_language");
        assert!(!empty.exists() || std::fs::read_dir(&empty).unwrap().next().is_none(), "a folder was made");
    }

    /// A Scrivener bundle written by this app's own exporter, whose first
    /// chapter carries `synopsis` and whose second carries none.
    fn scrivener_source(dir: &Path, synopsis: &str) -> PathBuf {
        use crate::formats::{Chapter, Manuscript, Scene};
        let chapter = |id: &str, title: &str, text: &str, synopsis: Option<&str>| Chapter {
            id: id.into(),
            title: title.into(),
            scenes: vec![Scene { heading: None, paragraphs: vec![text.into()] }],
            synopsis: synopsis.map(str::to_string),
        };
        let book = Manuscript {
            title: "La sal".into(),
            language: "es".into(),
            chapters: vec![
                chapter("ch-01", "La salida", "Llovió tres días.", Some(synopsis)),
                chapter("ch-02", "El norte", "El camino torcía al norte. Y siguió.", None),
            ],
            ..Default::default()
        };
        let bundle = dir.join("La sal.scriv");
        crate::formats::scrivener::export_to(&book, &bundle).unwrap();
        bundle
    }

    const SYNOPSIS: &str = "Ana dice: \"vete\".\n---\nY se va — sola.";

    #[test]
    fn a_scrivener_synopsis_lands_in_its_chapter_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = scrivener_source(dir.path(), SYNOPSIS);
        let project = import_into(&dir.path().join("novels"), &bundle, String::new(), "es").unwrap();
        let root = PathBuf::from(&project.path);

        let raw = std::fs::read_to_string(root.join(&project.chapters[0].file)).unwrap();
        let (frontmatter, body) = crate::commands::project::split_frontmatter(&raw);
        assert_eq!(frontmatter.get("synopsis").map(String::as_str), Some(SYNOPSIS), "{raw}");
        assert_eq!(frontmatter.get("title").map(String::as_str), Some("La salida"));
        assert_eq!(body, "Llovió tres días.", "the synopsis leaked into the prose: {raw}");
    }

    #[test]
    fn a_chapter_without_a_synopsis_gets_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = scrivener_source(dir.path(), SYNOPSIS);
        // The exporter wrote the second chapter a first-sentence card; take it
        // away, as a Scrivener card left empty would be.
        let data = bundle.join("Files").join("Data");
        for folder in std::fs::read_dir(&data).unwrap().flatten() {
            let card = folder.path().join("synopsis.txt");
            if std::fs::read_to_string(&card).is_ok_and(|text| text.starts_with("El camino")) {
                std::fs::remove_file(card).unwrap();
            }
        }
        let project = import_into(&dir.path().join("novels"), &bundle, String::new(), "es").unwrap();
        let raw = std::fs::read_to_string(PathBuf::from(&project.path).join(&project.chapters[1].file)).unwrap();
        assert!(!raw.contains("synopsis"), "{raw}");
    }

    #[test]
    fn a_synopsis_round_trips_scrivener_to_versorium_to_scrivener() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = scrivener_source(dir.path(), SYNOPSIS);
        let project = import_into(&dir.path().join("novels"), &bundle, String::new(), "es").unwrap();

        let back = scrivener_export(&PathBuf::from(&project.path), &dir.path().join("again"));
        assert_eq!(cards(&back), cards(&bundle), "the cards changed on the way through");
        assert_eq!(cards(&back)[0], SYNOPSIS);
    }

    /// Export a project as `<into>/La sal.scriv`, and return the bundle.
    fn scrivener_export(root: &Path, into: &Path) -> PathBuf {
        std::fs::create_dir_all(into).unwrap();
        let bundle = into.join("La sal.scriv");
        export_with(&Default::default(), root.to_path_buf(), "scriv".into(), bundle.clone(), None).unwrap();
        bundle
    }

    /// Each document's corkboard card, in binder order.
    fn cards(bundle: &Path) -> Vec<String> {
        let mut folders: Vec<PathBuf> =
            std::fs::read_dir(bundle.join("Files").join("Data")).unwrap().flatten().map(|e| e.path()).collect();
        folders.sort();
        folders.iter().map(|f| std::fs::read_to_string(f.join("synopsis.txt")).unwrap()).collect()
    }

    #[test]
    fn a_chapter_without_a_synopsis_comes_back_from_scrivener_without_one() {
        // Versorium → Scrivener → Versorium. The export gives Scrivener's card
        // the chapter's first sentence; read back as a synopsis, it would be a
        // summary nobody wrote, and every later export would repeat it.
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "La sal");
        let file = crate::commands::chapters::list_chapters_inner(&root).unwrap()[0].file.clone();
        crate::commands::chapters::save_chapter(root.clone(), file, "Llovió tres días. Luego escampó.".into(), None)
            .unwrap();
        let bundle = scrivener_export(&root, &dir.path().join("out"));
        assert_eq!(cards(&bundle), ["Llovió tres días."], "Scrivener's card is still the first sentence");

        let back = import_into(&dir.path().join("novels"), &bundle, String::new(), "es").unwrap();
        let back_root = PathBuf::from(&back.path);
        let back_file = back.chapters[0].file.clone();
        let raw = std::fs::read_to_string(back_root.join(&back_file)).unwrap();
        assert!(!raw.contains("synopsis"), "{raw}");

        // So the next card follows the opening the writer has now.
        crate::commands::chapters::save_chapter(back_root.clone(), back_file, "Escampó al fin. Salieron.".into(), None)
            .unwrap();
        assert_eq!(cards(&scrivener_export(&back_root, &dir.path().join("again"))), ["Escampó al fin."]);
    }

    #[test]
    fn a_profile_supplies_the_author_a_project_never_got() {
        use crate::commands::settings::AuthorProfile;
        let dir = tempfile::tempdir().unwrap();
        let root = project(dir.path(), "La Casa");
        with_text(&root);
        // Exporting to PDF is refused without an author, so a profile that did
        // not reach the export would make this fail.
        let profile = AuthorProfile { name: "Ana Ruiz".into(), ..Default::default() };
        let dest = dir.path().join("a.pdf");
        export_with(&profile, root, "pdf".into(), dest.clone(), None).unwrap();

        let pdf = std::fs::read(&dest).unwrap();
        assert!(String::from_utf8_lossy(&pdf).contains("/Author (Ana Ruiz)"));
    }
}
