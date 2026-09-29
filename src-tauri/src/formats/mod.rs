//! Reading a project into the shape every exporter needs, and the shape every
//! importer produces.
//!
//! Formats never touch the disk layout: they take a `Manuscript` and emit
//! bytes, or take bytes and produce an `Imported`. That keeps DOCX, EPUB, PDF
//! and Markdown from each re-deriving what a chapter or a scene is.

pub mod docx;
pub mod epub;
pub mod markdown;
pub mod pdf;
pub mod scrivener;

use crate::commands::project::{load_meta, split_frontmatter};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One scene: `##` headings inside a chapter file (spec §0.1).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    /// `None` for the text before the first `##`.
    pub heading: Option<String>,
    pub paragraphs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub scenes: Vec<Scene>,
}


/// Who a manuscript is by, past the name on the cover.
///
/// Every field here has a slot in at least one export format, and none of them
/// is invented. A field nothing can carry would be a promise the file does not
/// keep, and somebody would find out from a publisher rather than from us.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Byline {
    /// "Le Guin, Ursula K.". EPUB's `file-as`, which is how a shelf sorts.
    pub sort_as: String,
    /// A MARC relator code — `aut`, `edt`, `trl`. EPUB refines `dc:creator`
    /// with it; no other format here has anywhere to put it.
    pub role: String,
    /// `dc:publisher` in EPUB, `Company` in DOCX's app.xml.
    pub organization: String,
    /// The copyright line, verbatim. `dc:rights` in EPUB, nothing elsewhere.
    pub rights: String,
}

/// MARC relator codes this offers. Not the full list — those three are what a
/// manuscript leaving this app is, and a free-text field would produce codes
/// no reader understands.
pub const ROLES: [&str; 3] = ["aut", "edt", "trl"];

impl Byline {
    /// "Surname, Given" when nobody said otherwise.
    ///
    /// Guessed only as a fallback: a name is not reliably two words in that
    /// order, which is why the field is editable in the first place.
    pub fn sort_as_or_guess(&self, author: &str) -> String {
        if !self.sort_as.trim().is_empty() {
            return self.sort_as.trim().to_string();
        }
        let mut words = author.split_whitespace().collect::<Vec<_>>();
        match words.pop() {
            Some(last) if !words.is_empty() => format!("{last}, {}", words.join(" ")),
            _ => author.trim().to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manuscript {
    pub title: String,
    pub author: String,
    /// Empty unless an author profile is in use, and empty writes nothing.
    pub byline: Byline,
    pub language: String,
    pub chapters: Vec<Chapter>,
}

impl Manuscript {
    /// Attach an author profile.
    ///
    /// The project's own author wins when it has one: that is the byline the
    /// writer typed for this novel, and a profile is a default, not an override.
    pub fn with_byline(mut self, name: &str, byline: Byline) -> Self {
        if self.author.trim().is_empty() {
            self.author = name.trim().to_string();
        }
        self.byline = byline;
        self
    }
}

impl Manuscript {
    /// What Standard Manuscript Format puts in the running head. The surname is
    /// the last whitespace-separated word; an author with one name gives that.
    pub fn surname(&self) -> &str {
        self.author.split_whitespace().next_back().unwrap_or("")
    }
}

/// Split a chapter body into scenes. A `##` line opens a new scene; the text
/// before the first one is a scene with no heading. Blank lines separate
/// paragraphs, and a paragraph's internal line breaks are folded into spaces —
/// every target format re-wraps.
pub fn scenes_of(body: &str) -> Vec<Scene> {
    let mut scenes: Vec<Scene> = Vec::new();
    let mut current = Scene { heading: None, paragraphs: Vec::new() };
    let mut para: Vec<&str> = Vec::new();

    let flush = |para: &mut Vec<&str>, scene: &mut Scene| {
        if !para.is_empty() {
            scene.paragraphs.push(para.join(" "));
            para.clear();
        }
    };

    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            flush(&mut para, &mut current);
            if current.heading.is_some() || !current.paragraphs.is_empty() {
                scenes.push(current);
            }
            current = Scene { heading: Some(heading.trim().to_string()), paragraphs: Vec::new() };
        } else if trimmed.is_empty() {
            flush(&mut para, &mut current);
        } else {
            para.push(trimmed);
        }
    }
    flush(&mut para, &mut current);
    if current.heading.is_some() || !current.paragraphs.is_empty() {
        scenes.push(current);
    }
    scenes
}

/// Read a project from disk into the export shape.
pub fn read_manuscript(root: &Path) -> Result<Manuscript, String> {
    let meta = load_meta(root).ok_or_else(|| "not_found".to_string())?;
    let chapters = crate::commands::chapters::list_chapters_inner(root)?;
    let mut out = Vec::with_capacity(chapters.len());
    for chapter in chapters {
        let full = crate::storage::project_file(root, &chapter.file)?;
        let raw = std::fs::read_to_string(&full).map_err(|_| "io".to_string())?;
        let (_, body) = split_frontmatter(&raw);
        out.push(Chapter { id: chapter.id, title: chapter.title, scenes: scenes_of(&body) });
    }
    Ok(Manuscript {
        title: meta.title,
        author: meta.author,
        byline: Byline::default(),
        language: meta.language,
        chapters: out,
    })
}

/// What an importer produces: chapter bodies as Markdown, plus whatever the
/// source could not carry across.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedChapter {
    pub title: String,
    /// Markdown body, frontmatter excluded.
    pub body: String,
    pub synopsis: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub title: String,
    pub chapters: Vec<ImportedChapter>,
    /// Everything the source held that this import dropped, in the user's face
    /// rather than buried — a silent lossy import is worse than a loud one.
    pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_before_the_first_scene_heading_is_still_a_scene() {
        let scenes = scenes_of("Opening line.\n\nSecond paragraph.\n\n## Later\n\nAfter the break.");
        assert_eq!(scenes.len(), 2);
        assert_eq!(scenes[0].heading, None);
        assert_eq!(scenes[0].paragraphs, vec!["Opening line.", "Second paragraph."]);
        assert_eq!(scenes[1].heading.as_deref(), Some("Later"));
        assert_eq!(scenes[1].paragraphs, vec!["After the break."]);
    }

    #[test]
    fn a_wrapped_paragraph_becomes_one_paragraph() {
        // Every target format re-wraps, so a hard-wrapped source must not
        // become one paragraph per line.
        let scenes = scenes_of("Una línea\nque sigue aquí.\n\nOtra.");
        assert_eq!(scenes[0].paragraphs, vec!["Una línea que sigue aquí.", "Otra."]);
    }

    #[test]
    fn an_empty_body_has_no_scenes() {
        assert!(scenes_of("").is_empty());
        assert!(scenes_of("\n\n   \n").is_empty());
    }

    #[test]
    fn a_heading_with_no_text_under_it_survives() {
        let scenes = scenes_of("## Empty scene\n");
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].heading.as_deref(), Some("Empty scene"));
        assert!(scenes[0].paragraphs.is_empty());
    }

    #[test]
    fn the_running_head_uses_the_last_name() {
        let one = |author: &str| Manuscript {
            title: "T".into(),
            author: author.into(),
            byline: Default::default(),
            language: "es".into(),
            chapters: vec![],
        };
        assert_eq!(one("Ursula K. Le Guin").surname(), "Guin");
        assert_eq!(one("Cervantes").surname(), "Cervantes");
        assert_eq!(one("").surname(), "");
    }

    #[test]
    fn a_sort_name_is_used_when_given_and_guessed_only_as_a_fallback() {
        let typed = Byline { sort_as: "  Le Guin, Ursula K.  ".into(), ..Default::default() };
        assert_eq!(typed.sort_as_or_guess("whatever"), "Le Guin, Ursula K.");

        // The guess is "last word, the rest", which is right often enough to be
        // a default and wrong often enough that the field stays editable.
        let empty = Byline::default();
        assert_eq!(empty.sort_as_or_guess("Ursula K. Le Guin"), "Guin, Ursula K. Le");
        assert_eq!(empty.sort_as_or_guess("Cervantes"), "Cervantes");
        assert_eq!(empty.sort_as_or_guess("   "), "");
    }

    #[test]
    fn a_profile_fills_a_missing_byline_and_never_replaces_one() {
        let byline = Byline { organization: "Minotauro".into(), ..Default::default() };
        let blank = Manuscript { author: "  ".into(), ..Default::default() };
        assert_eq!(blank.with_byline("Ana Ruiz", byline.clone()).author, "Ana Ruiz");

        // The name on this novel was typed for this novel. A profile is a
        // default, and a default that overwrites is not one.
        let named = Manuscript { author: "Otro Nombre".into(), ..Default::default() };
        let out = named.with_byline("Ana Ruiz", byline);
        assert_eq!(out.author, "Otro Nombre");
        assert_eq!(out.byline.organization, "Minotauro", "the rest still applies");
    }
}
