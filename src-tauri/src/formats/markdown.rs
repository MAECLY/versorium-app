//! Markdown — the canonical format (spec §9).
//!
//! Everything else is judged against this module: a manuscript that survives
//! `import(export(m))` unchanged is the baseline DOCX, EPUB and PDF are
//! measured by. Import therefore has to accept documents Versorium never wrote
//! — Word's setext headings, CRLF from Windows, a BOM from Notepad — and say
//! out loud whenever it had to guess.

use super::{Imported, ImportedChapter, Manuscript};
use std::path::Path;

/// Warnings are codes, not prose: the UI localizes them like every other
/// string (AGENTS.md: no hardcoded UI strings).
pub const WARN_PROSE_BEFORE_FIRST_CHAPTER: &str = "import_prose_before_first_chapter";
pub const WARN_NO_CHAPTER_HEADINGS: &str = "import_no_chapter_headings";
pub const WARN_TITLE_GUESSED: &str = "import_title_guessed";
pub const WARN_NOT_UTF8: &str = "import_not_utf8";

const UNTITLED: &str = "Untitled";

// ----------------------------------------------------------------- export

/// Double-quoted YAML, the same way chapter frontmatter is written.
fn yaml(value: &str) -> String {
    serde_json::to_string(value.trim()).unwrap_or_else(|_| "\"\"".into())
}

/// The whole manuscript as one document: a frontmatter block, then `#` per
/// chapter and `##` per scene.
///
/// The title goes in frontmatter rather than a leading heading, because a bare
/// leading `#` is indistinguishable from the first chapter on the way back in.
pub fn export(manuscript: &Manuscript) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("title: {}\n", yaml(&manuscript.title)));
    out.push_str(&format!("author: {}\n", yaml(&manuscript.author)));
    out.push_str(&format!("language: {}\n", yaml(&manuscript.language)));
    // Only what was filled in. A key with an empty value survives a round trip
    // as a key with an empty value, and then looks like data.
    for (key, value) in [
        ("sortAs", manuscript.byline.sort_as.trim()),
        ("role", manuscript.byline.role.trim()),
        ("publisher", manuscript.byline.organization.trim()),
        ("rights", manuscript.byline.rights.trim()),
    ] {
        if !value.is_empty() {
            out.push_str(&format!("{key}: {}\n", yaml(value)));
        }
    }
    out.push_str("---\n");

    for chapter in &manuscript.chapters {
        out.push_str(&format!("\n# {}\n", chapter.title.trim()));
        for scene in &chapter.scenes {
            if let Some(heading) = &scene.heading {
                out.push_str(&format!("\n## {}\n", heading.trim()));
            }
            for paragraph in &scene.paragraphs {
                out.push_str(&format!("\n{paragraph}\n"));
            }
        }
    }
    out
}

/// Write the export atomically. Returns the byte count.
pub fn export_to(manuscript: &Manuscript, dest: &Path) -> Result<u64, String> {
    let text = export(manuscript);
    crate::storage::atomic_write(dest, &text)?;
    Ok(text.len() as u64)
}

// ----------------------------------------------------------------- import

fn normalize(text: &str) -> String {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

/// `Title` + `=====` becomes `# Title`, `-----` becomes `## Title`.
///
/// Run before anything else so the rest of the importer only has to know one
/// heading syntax. An underline only counts after a non-blank line, which is
/// also what keeps a `---` thematic break from being read as a heading.
fn atx_only(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let underline = lines.get(i + 1).map(|l| l.trim()).unwrap_or("");
        let underlined = |mark: char| {
            !line.trim().is_empty()
                && atx_heading(line).is_none()
                && !underline.is_empty()
                && underline.chars().all(|c| c == mark)
        };
        if underlined('=') {
            out.push(format!("# {}", line.trim()));
            i += 2;
        } else if underlined('-') {
            out.push(format!("## {}", line.trim()));
            i += 2;
        } else {
            out.push(line.to_string());
            i += 1;
        }
    }
    out.join("\n")
}

/// `(level, text)` for an ATX heading, `None` otherwise.
fn atx_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    // `#hashtag` is prose, not a heading.
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let mut text = rest.trim().to_string();
    // A closing run of hashes only closes the heading when a space precedes it,
    // so a title that genuinely ends in `#` survives.
    if let Some((before, tail)) = text.rsplit_once(' ') {
        if !tail.is_empty() && tail.chars().all(|c| c == '#') {
            text = before.trim_end().to_string();
        }
    }
    Some((hashes, text))
}

/// Drop leading and trailing blank lines, keeping the inside intact — an
/// indented block inside a chapter must not lose its indentation.
fn tidy(lines: &[String]) -> String {
    let first = lines.iter().position(|l| !l.trim().is_empty());
    let last = lines.iter().rposition(|l| !l.trim().is_empty());
    match (first, last) {
        (Some(first), Some(last)) => lines[first..=last].join("\n"),
        _ => String::new(),
    }
}

struct Pending {
    title: String,
    lines: Vec<String>,
}

/// Read one Markdown document, including ones Versorium did not write.
pub fn import(text: &str) -> Result<Imported, String> {
    let normalized = normalize(text);
    let (front, body) = crate::commands::project::split_frontmatter(&normalized);
    let body = atx_only(&body);
    let mut warnings: Vec<String> = Vec::new();

    let mut chapters: Vec<Pending> = Vec::new();
    let mut leading: Vec<String> = Vec::new();
    for line in body.lines() {
        match atx_heading(line) {
            // Only `#` opens a chapter; `##` stays in the body as a scene break.
            Some((1, title)) => chapters.push(Pending { title, lines: Vec::new() }),
            _ => match chapters.last_mut() {
                Some(chapter) => chapter.lines.push(line.to_string()),
                None => leading.push(line.to_string()),
            },
        }
    }

    let orphaned = tidy(&leading);
    if chapters.is_empty() && orphaned.is_empty() {
        return Err("empty_document".into());
    }

    let front_title = front.get("title").map(|t| t.trim()).filter(|t| !t.is_empty());
    let fallback = front_title
        .map(str::to_string)
        .unwrap_or_else(|| UNTITLED.to_string());

    if !orphaned.is_empty() {
        // Prose outside any chapter is still the writer's words; keep it rather
        // than dropping it, and say where it went.
        warnings.push(
            if chapters.is_empty() { WARN_NO_CHAPTER_HEADINGS } else { WARN_PROSE_BEFORE_FIRST_CHAPTER }
                .to_string(),
        );
        chapters.insert(0, Pending { title: fallback.clone(), lines: leading });
    }

    let title = match front_title {
        Some(title) => title.to_string(),
        None => {
            warnings.push(WARN_TITLE_GUESSED.to_string());
            chapters
                .first()
                .map(|c| c.title.clone())
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| UNTITLED.to_string())
        }
    };

    Ok(Imported {
        title,
        chapters: chapters
            .into_iter()
            .map(|chapter| ImportedChapter {
                title: if chapter.title.is_empty() { fallback.clone() } else { chapter.title },
                body: tidy(&chapter.lines),
                // Markdown carries no synopsis field.
                synopsis: None,
            })
            .collect(),
        warnings,
    })
}

/// Read a Markdown file. Invalid UTF-8 is salvaged rather than refused, but the
/// loss is reported.
pub fn import_file(path: &Path) -> Result<Imported, String> {
    let raw = std::fs::read(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "not_found".to_string(),
        _ => "io".to_string(),
    })?;
    match String::from_utf8(raw) {
        Ok(text) => import(&text),
        Err(invalid) => {
            let mut imported = import(&String::from_utf8_lossy(invalid.as_bytes()))?;
            imported.warnings.push(WARN_NOT_UTF8.to_string());
            Ok(imported)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::{scenes_of, Chapter, Scene};

    fn sample() -> Manuscript {
        Manuscript {
            title: "El largo invierno".into(),
            author: "Ana García".into(),
            byline: Default::default(),
            matter: Default::default(),
            language: "es".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "La aguja del norte".into(),
                    scenes: vec![
                        Scene {
                            heading: None,
                            paragraphs: vec![
                                "El invierno fue largo —y la niña esperaba junto a la ventana.".into(),
                                "Nadie vino. 🌙".into(),
                            ],
                        },
                        Scene {
                            heading: Some("Más tarde".into()),
                            paragraphs: vec!["Después del alba, ¿quién llamó?".into()],
                        },
                    ],
                },
                Chapter {
                    id: "ch-02".into(),
                    title: "Segundo".into(),
                    scenes: vec![Scene { heading: None, paragraphs: vec!["Un párrafo.".into()] }],
                },
            ],
        }
    }

    #[test]
    fn round_trip_preserves_every_chapter_and_paragraph() {
        let original = sample();
        let back = import(&export(&original)).unwrap();

        assert_eq!(back.title, original.title);
        assert_eq!(back.warnings, Vec::<String>::new(), "our own export needs no guessing");
        assert_eq!(back.chapters.len(), original.chapters.len());

        for (imported, source) in back.chapters.iter().zip(&original.chapters) {
            assert_eq!(imported.title, source.title);
            // Compare the shape, not the bytes: the body is Markdown again.
            assert_eq!(scenes_of(&imported.body), source.scenes);
        }
    }

    #[test]
    fn export_is_byte_identical_across_calls() {
        let manuscript = sample();
        assert_eq!(export(&manuscript), export(&manuscript));
    }

    #[test]
    fn scene_headings_survive_a_second_round_trip() {
        let once = export(&sample());
        let back = import(&once).unwrap();
        let rebuilt = Manuscript {
            title: back.title.clone(),
            author: "Ana García".into(),
            byline: Default::default(),
            matter: Default::default(),
            language: "es".into(),
            chapters: back
                .chapters
                .iter()
                .map(|c| Chapter {
                    id: String::new(),
                    title: c.title.clone(),
                    scenes: scenes_of(&c.body),
                })
                .collect(),
        };
        // Ids are not carried by Markdown, so compare the text that is.
        assert!(export(&rebuilt).contains("## Más tarde"));
        assert_eq!(export(&rebuilt), once, "a second pass must not drift");
    }

    #[test]
    fn a_document_with_no_frontmatter_takes_its_title_from_the_first_heading() {
        let back = import("# Chapter One\n\nSome prose.\n").unwrap();
        assert_eq!(back.title, "Chapter One");
        assert!(back.warnings.contains(&WARN_TITLE_GUESSED.to_string()));
        // The heading still forms a chapter — borrowing it as the title must
        // not make the chapter disappear.
        assert_eq!(back.chapters.len(), 1);
        assert_eq!(back.chapters[0].body, "Some prose.");
    }

    #[test]
    fn prose_before_the_first_chapter_is_kept_and_reported() {
        let back = import("---\ntitle: \"Libro\"\n---\nA prologue.\n\n# One\n\nBody.\n").unwrap();
        assert!(back.warnings.contains(&WARN_PROSE_BEFORE_FIRST_CHAPTER.to_string()));
        assert_eq!(back.chapters.len(), 2);
        assert_eq!(back.chapters[0].title, "Libro");
        assert_eq!(back.chapters[0].body, "A prologue.");
        assert_eq!(back.chapters[1].title, "One");
    }

    #[test]
    fn a_document_with_no_headings_becomes_one_chapter() {
        let back = import("Just prose.\n\nMore prose.\n").unwrap();
        assert!(back.warnings.contains(&WARN_NO_CHAPTER_HEADINGS.to_string()));
        assert_eq!(back.chapters.len(), 1);
        assert_eq!(back.chapters[0].title, UNTITLED);
        assert_eq!(back.chapters[0].body, "Just prose.\n\nMore prose.");
    }

    #[test]
    fn setext_headings_are_read_as_chapters_and_scenes() {
        let back = import("Chapter One\n===========\n\nProse.\n\nA scene\n-------\n\nMore.\n").unwrap();
        assert_eq!(back.chapters.len(), 1);
        assert_eq!(back.chapters[0].title, "Chapter One");
        // The h2 is normalized to ATX, which is what a chapter file stores.
        assert_eq!(scenes_of(&back.chapters[0].body).len(), 2);
        assert_eq!(scenes_of(&back.chapters[0].body)[1].heading.as_deref(), Some("A scene"));
    }

    #[test]
    fn a_thematic_break_after_a_blank_line_is_not_a_heading() {
        let back = import("# One\n\nProse.\n\n---\n\nMore.\n").unwrap();
        assert_eq!(back.chapters.len(), 1);
        assert!(back.chapters[0].body.contains("---"));
    }

    #[test]
    fn crlf_and_a_bom_are_normalized() {
        let back = import("\u{feff}---\r\ntitle: \"T\"\r\n---\r\n# Uno\r\n\r\nTexto.\r\n").unwrap();
        assert_eq!(back.title, "T");
        assert_eq!(back.chapters[0].title, "Uno");
        assert_eq!(back.chapters[0].body, "Texto.");
        assert!(!back.chapters[0].body.contains('\r'));
    }

    #[test]
    fn a_closing_hash_sequence_is_not_part_of_the_title() {
        assert_eq!(import("# Title ##\n").unwrap().chapters[0].title, "Title");
        // Without the space it belongs to the title.
        assert_eq!(import("# Title##\n").unwrap().chapters[0].title, "Title##");
        // `#hashtag` is prose.
        let back = import("# One\n\n#hashtag\n").unwrap();
        assert_eq!(back.chapters.len(), 1);
        assert_eq!(back.chapters[0].body, "#hashtag");
    }

    #[test]
    fn an_empty_document_is_refused() {
        assert_eq!(import("").unwrap_err(), "empty_document");
        assert_eq!(import("\n\n   \n").unwrap_err(), "empty_document");
        // Frontmatter alone carries no manuscript.
        assert_eq!(import("---\ntitle: \"T\"\n---\n").unwrap_err(), "empty_document");
    }

    #[test]
    fn export_to_writes_the_file_and_reports_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.md");
        let manuscript = sample();
        let written = export_to(&manuscript, &dest).unwrap();
        let on_disk = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(on_disk, export(&manuscript));
        assert_eq!(written as usize, on_disk.len());
    }

    #[test]
    fn import_file_reads_and_reports_a_missing_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.md");
        std::fs::write(&path, export(&sample())).unwrap();
        assert_eq!(import_file(&path).unwrap().title, "El largo invierno");
        assert_eq!(import_file(&dir.path().join("absent.md")).unwrap_err(), "not_found");
    }

    #[test]
    fn invalid_utf8_is_salvaged_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("latin1.md");
        // A lone 0xFF is not valid UTF-8; the prose around it must still arrive.
        let mut bytes = b"# Uno\n\nCaf".to_vec();
        bytes.push(0xFF);
        bytes.extend_from_slice(b" cerrado.\n");
        std::fs::write(&path, bytes).unwrap();

        let imported = import_file(&path).unwrap();
        assert!(imported.warnings.contains(&WARN_NOT_UTF8.to_string()));
        assert!(imported.chapters[0].body.contains("cerrado."));
    }
}
