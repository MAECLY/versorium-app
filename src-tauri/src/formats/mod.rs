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
    /// The chapter's `synopsis:`, when it has one that can be read.
    ///
    /// Only Scrivener has a place for it (the corkboard card); every other
    /// format is a run of prose with no per-chapter slot.
    pub synopsis: Option<String>,
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

/// The front and back matter an export may carry.
///
/// Both are refusable per project. A title page is what an agent asks for and
/// what a beta reader has no use for; a colophon naming the tool is a courtesy
/// the writer extends, not one the tool takes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Matter {
    pub cover: bool,
    pub colophon: bool,
    /// Words the reader of the finished file will see, supplied by the
    /// frontend.
    ///
    /// Same reason `backup_restore` takes its folder label: Rust has no
    /// dictionary, and the colophon is read by whoever opens the book — so it
    /// is written in the manuscript's language, not the app's.
    pub labels: Labels,
}

impl Default for Matter {
    fn default() -> Self {
        Self { cover: true, colophon: true, labels: Labels::default() }
    }
}

/// A small phrasebook for text that ends up inside an exported file.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Labels(std::collections::BTreeMap<String, String>);

impl Labels {
    /// The key itself when nothing was supplied. A missing translation should
    /// read as a terse English word, never as an empty line in somebody's book.
    pub fn get<'a>(&'a self, key: &'a str) -> &'a str {
        self.0.get(key).map(String::as_str).filter(|s| !s.trim().is_empty()).unwrap_or(key)
    }

    #[cfg(test)]
    pub fn from_pairs(pairs: &[(&str, &str)]) -> Self {
        Self(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
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
    pub matter: Matter,
    pub chapters: Vec<Chapter>,
}

/// One line of the colophon: a label and what it says.
///
/// Built once here so DOCX, EPUB and PDF cannot end up disagreeing about what a
/// project's own record contains.
pub fn colophon_lines(manuscript: &Manuscript) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![("title".into(), manuscript.title.clone())];
    if !manuscript.author.trim().is_empty() {
        out.push(("author".into(), manuscript.author.clone()));
    }
    if !manuscript.byline.organization.trim().is_empty() {
        out.push(("publisher".into(), manuscript.byline.organization.clone()));
    }
    if !manuscript.byline.rights.trim().is_empty() {
        out.push(("rights".into(), manuscript.byline.rights.clone()));
    }
    out.push(("language".into(), manuscript.language.clone()));
    out.push(("chapters".into(), manuscript.chapters.len().to_string()));
    out.push(("words".into(), word_count(manuscript).to_string()));
    out
}

/// Words in the whole manuscript, counted the way the binder counts them so the
/// colophon and the sidebar cannot disagree.
pub fn word_count(manuscript: &Manuscript) -> usize {
    manuscript
        .chapters
        .iter()
        .flat_map(|c| c.scenes.iter())
        .flat_map(|s| s.paragraphs.iter())
        .map(|p| p.split_whitespace().count())
        .sum()
}

/// What the app says about itself at the end of a manuscript.
///
/// Deliberately one sentence and deliberately last. A tool that puts its name
/// on the title page has mistaken whose book it is.
pub fn colophon_credit() -> String {
    format!("Written in Versorium {}", env!("CARGO_PKG_VERSION"))
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
        let (frontmatter, body) = split_frontmatter(&raw);
        out.push(Chapter {
            id: chapter.id,
            title: chapter.title,
            scenes: scenes_of(&body),
            synopsis: frontmatter.get("synopsis").map(String::as_str).and_then(readable_synopsis),
        });
    }
    Ok(Manuscript {
        title: meta.title,
        author: meta.author,
        byline: Byline::default(),
        language: meta.language,
        matter: Matter {
            cover: meta.export_cover,
            colophon: meta.export_colophon,
            labels: Labels::default(),
        },
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
    /// The novel's language as the source declares it, when it is one a novel
    /// can be written in here (`commands::project::LANGUAGES`).
    pub language: Option<String>,
    /// The tag exactly as the source wrote it, whether or not it could be
    /// used, so the import dialog can say what the file claimed rather than
    /// pretend it said nothing.
    pub declared_language: Option<String>,
    pub chapters: Vec<ImportedChapter>,
    /// Everything the source held that this import dropped, in the user's face
    /// rather than buried — a silent lossy import is worse than a loud one.
    pub warnings: Vec<String>,
}

/// The longest declared tag the dialog repeats. A real one is a few
/// characters; a field that holds a paragraph is shown cut short.
const DECLARED_CHARS: usize = 40;

/// What a source says its language is: the code a novel can take, and the
/// tag as written, in that order. Nothing said gives two `None`s, and so does
/// a tag that says there is no language to give.
fn declared(raw: Option<&str>) -> (Option<String>, Option<String>) {
    let tag = raw.map(|r| r.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    if says_no_language(&tag) {
        return (None, None);
    }
    let shown = if tag.chars().count() > DECLARED_CHARS {
        format!("{}…", tag.chars().take(DECLARED_CHARS).collect::<String>())
    } else {
        tag.clone()
    };
    (crate::commands::project::language_code(&tag).map(str::to_string), Some(shown))
}

/// Whether a tag gives no language at all: nothing, one of the codes BCP 47
/// keeps for saying so (`und` undetermined, `mul` several, `zxx` no
/// linguistic content, `mis` uncoded), or private use (`x-…`), which is where
/// Word's `x-none` comes from. Such a value is no answer: it is not a language
/// Versorium cannot use, and a source with another place to look looks there.
pub(crate) fn says_no_language(tag: &str) -> bool {
    let tag = tag.trim().to_ascii_lowercase();
    let primary = tag.split(['-', '_']).next().unwrap_or_default();
    matches!(primary, "" | "und" | "mul" | "zxx" | "mis" | "x")
}

/// A `synopsis:` value worth showing, or `None`.
///
/// The frontmatter reader takes one line per key, so a synopsis written by
/// hand as a YAML block (`synopsis: |` and the lines under it) arrives as its
/// indicator alone: `|` or `>`, a chomping sign or an indent digit, perhaps a
/// comment. Treated as no synopsis, so an export falls back to the chapter's
/// own words instead of a lone `|`; the corkboard draws the same line
/// (`src/lib/binder/cardText.ts`). What this app writes is one double-quoted
/// line and never looks like that.
fn readable_synopsis(raw: &str) -> Option<String> {
    let text = raw.trim();
    let mut words = text.splitn(2, char::is_whitespace);
    let indicator = words.next().unwrap_or_default();
    let rest = words.next().unwrap_or_default().trim_start();
    let block = matches!(indicator.chars().next(), Some('|' | '>'))
        && indicator.len() <= 3
        && indicator.chars().skip(1).all(|c| matches!(c, '+' | '-' | '1'..='9'))
        && (rest.is_empty() || rest.starts_with('#'));
    (!text.is_empty() && !block).then(|| text.to_string())
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

    /// One member of an exported zip, as text.
    fn zip_member(path: &Path, name: &str) -> String {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut out = String::new();
        zip.by_name(name).unwrap().read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn a_paragraph_indented_with_tab_reaches_every_export_as_prose() {
        // What the editor's Tab writes when it is set to indent: CodeMirror's
        // indent unit, two spaces, at the start of the line, once per press
        // (src/lib/editor/preferences.test.ts shows it). Two presses make
        // four, and four spaces after a blank line are an indented code block
        // to CommonMark — in the chapter file, which is what GitHub and any
        // Markdown reader see. The exports never inherit it: all five that
        // `export_with` routes to are built from `scenes_of`, which trims
        // every line, and each is checked below.
        let (once, twice) = ("  ", "    ");
        let body = format!(
            "{twice}Primer párrafo, sangrado dos veces.\n\n{once}Segundo, una vez.\n\n\
             {twice}## La escena\n\n{twice}*Cursiva* sangrada."
        );
        let scenes = scenes_of(&body);
        assert_eq!(scenes.len(), 2);
        assert_eq!(scenes[0].paragraphs, vec!["Primer párrafo, sangrado dos veces.", "Segundo, una vez."]);
        assert_eq!(scenes[1].heading.as_deref(), Some("La escena"), "an indented ## still opens a scene");
        assert_eq!(scenes[1].paragraphs, vec!["*Cursiva* sangrada."]);

        let manuscript = Manuscript {
            title: "T".into(),
            language: "es".into(),
            matter: Matter { cover: false, colophon: false, labels: Labels::default() },
            chapters: vec![Chapter { id: "ch-01".into(), title: "Uno".into(), scenes, synopsis: None }],
            ..Default::default()
        };

        // Markdown is rebuilt flush left: no line is four spaces in.
        let md = markdown::export(&manuscript);
        assert!(md.contains("\nPrimer párrafo, sangrado dos veces.\n"), "{md}");
        assert!(md.lines().all(|line| !line.starts_with("    ")), "{md}");

        // DOCX and EPUB: ordinary paragraphs that start at their first word.
        let dir = tempfile::tempdir().unwrap();
        let docx_file = dir.path().join("m.docx");
        docx::export_to(&manuscript, &docx_file).unwrap();
        let document = zip_member(&docx_file, "word/document.xml");
        assert!(document.contains("<w:t xml:space=\"preserve\">Primer párrafo, sangrado dos veces.</w:t>"));
        assert!(!document.contains("<w:t xml:space=\"preserve\"> "), "no leading space survives");

        let epub_file = dir.path().join("m.epub");
        epub::export_to(&manuscript, &epub_file).unwrap();
        let chapter = zip_member(&epub_file, "OEBPS/ch-01.xhtml");
        assert!(chapter.contains("<p class=\"first\">Primer párrafo, sangrado dos veces.</p>"), "{chapter}");
        assert!(!chapter.contains("<pre") && !chapter.contains("<code"), "{chapter}");

        // PDF: each line is drawn from its first word (á is WinAnsi 0xE1, octal 341).
        let pdf = pdf::render(&manuscript).unwrap();
        let drawn = |needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
        assert!(drawn(b"(Primer p\\341rrafo,"));
        assert!(drawn(b"(Segundo, una vez.)"));
        assert!(drawn(b"(*Cursiva* sangrada.)"));

        // Scrivener: one paragraph per RTF line, each from its first word (á is
        // \u225?), and the indented `##` still breaks the scene, as the
        // centred separator Scrivener's own compile uses.
        let bundle = dir.path().join("m.scriv");
        scrivener::export_to(&manuscript, &bundle).unwrap();
        let documents: Vec<_> =
            std::fs::read_dir(bundle.join("Files").join("Data")).unwrap().flatten().collect();
        assert_eq!(documents.len(), 1, "one document for the one chapter");
        let rtf = std::fs::read_to_string(documents[0].path().join("content.rtf")).unwrap();
        assert!(rtf.contains("\nPrimer p\\u225?rrafo, sangrado dos veces.\\par\n"), "{rtf}");
        assert!(rtf.contains("\nSegundo, una vez.\\par\n"), "{rtf}");
        assert!(rtf.contains("\\par\\qc #\\par\\ql\n*Cursiva* sangrada.\\par\n"), "{rtf}");
        assert!(rtf.lines().all(|line| !line.starts_with(' ')), "{rtf}");
    }

    #[test]
    fn read_manuscript_carries_the_synopsis() {
        let dir = tempfile::tempdir().unwrap();
        let project = crate::commands::project::create_project(crate::commands::project::CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "La sal".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&project.path);
        let second = crate::commands::project::create_chapter(root.clone(), "Dos".into()).unwrap();
        let first = &project.chapters[0].file;
        crate::commands::chapters::set_synopsis(&root, first, "Se va.\nSola.").unwrap();
        // A block written by hand reaches the reader as its indicator alone.
        let raw = std::fs::read_to_string(root.join(&second.file)).unwrap();
        std::fs::write(root.join(&second.file), raw.replacen("---\n", "---\nsynopsis: |\n  A mano.\n", 1)).unwrap();

        let manuscript = read_manuscript(&root).unwrap();
        assert_eq!(manuscript.chapters[0].synopsis.as_deref(), Some("Se va.\nSola."));
        assert_eq!(manuscript.chapters[1].synopsis, None, "a lone `|` is not a synopsis");
    }

    #[test]
    fn a_synopsis_that_is_only_a_block_indicator_is_none() {
        for raw in ["|", ">", "|-", ">+", "|2", "|2-", ">-1", "| # a comment", "|-\t# tab", "", "   "] {
            assert_eq!(readable_synopsis(raw), None, "{raw:?}");
        }
        for raw in ["She leaves.", "> She leaves.", "|| or not", "|- then", "#1 fan", "Ana # Luis", "|#x"] {
            assert_eq!(readable_synopsis(raw).as_deref(), Some(raw), "{raw:?}");
        }
        assert_eq!(readable_synopsis("  Trimmed.  ").as_deref(), Some("Trimmed."));
    }

    #[test]
    fn a_declared_tag_is_kept_as_written_and_named_when_it_can_be_used() {
        assert_eq!(declared(None), (None, None));
        assert_eq!(declared(Some("  \n ")), (None, None));
        assert_eq!(declared(Some(" es-MX ")), (Some("es".into()), Some("es-MX".into())));
        assert_eq!(declared(Some("fr")), (None, Some("fr".into())));
        // A field that holds a paragraph is not repeated whole.
        let long = "y".repeat(200);
        let (code, shown) = declared(Some(&long));
        assert_eq!(code, None);
        assert_eq!(shown.unwrap().chars().count(), DECLARED_CHARS + 1);
    }

    #[test]
    fn a_tag_that_names_no_language_is_no_answer() {
        // BCP 47's codes for "no language" and private use, where Word's
        // `x-none` comes from: not a language Versorium cannot use, nothing.
        for raw in ["x-none", "X-NONE", "und", "zxx", "mul", "mis", "x-klingon", "und-Latn"] {
            assert_eq!(declared(Some(raw)), (None, None), "{raw:?}");
        }
        // A real language is still reported, offered here or not, and a
        // private-use part after one does not hide it.
        assert_eq!(declared(Some("fr-FR")), (None, Some("fr-FR".into())));
        assert_eq!(declared(Some("es-x-none")), (Some("es".into()), Some("es-x-none".into())));
    }

    #[test]
    fn the_running_head_uses_the_last_name() {
        let one = |author: &str| Manuscript {
            title: "T".into(),
            author: author.into(),
            byline: Default::default(),
            matter: Default::default(),
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
