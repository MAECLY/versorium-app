//! Scrivener import: the binder, its texts and their synopses (spec §9).
//!
//! A `.scriv` project is a bundle *directory*, not a file. The binder lives in
//! a `.scrivx` XML file at its root; the prose lives in RTF files keyed by the
//! binder item's identifier, which moved between Scrivener 2 and 3 — both
//! layouts are probed.
//!
//! Scrivener holds far more than a manuscript (labels, status, notes,
//! research, snapshots). Everything this import leaves behind is reported, so
//! the writer learns it from the preview rather than from a gap months later.

use super::{Imported, ImportedChapter};
use quick_xml::events::Event;
use quick_xml::XmlVersion;
use quick_xml::Reader;
use std::path::{Path, PathBuf};

pub const WARN_LABELS: &str = "import_scrivener_labels_dropped";
pub const WARN_NOTES: &str = "import_scrivener_notes_dropped";
pub const WARN_IMAGES: &str = "import_images_dropped";
pub const WARN_FORMATTING: &str = "import_docx_formatting_dropped";

/// Binder item types that hold prose. Everything else is a container or an
/// attachment; `TrashFolder` is skipped outright, because importing what the
/// writer threw away is never what they meant.
const TEXT_TYPE: &str = "Text";
const TRASH_TYPE: &str = "TrashFolder";

#[derive(Debug, Clone, PartialEq)]
struct BinderEntry {
    id: String,
    title: String,
    kind: String,
}

impl BinderEntry {
    fn is_text(&self) -> bool {
        self.kind == TEXT_TYPE
    }

    /// Attachments the binder points at but this import cannot carry.
    fn is_attachment(&self) -> bool {
        matches!(self.kind.as_str(), "Image" | "PDF" | "WebArchive" | "Movie" | "Sound")
    }
}

pub fn import_file(path: &Path) -> Result<Imported, String> {
    if !path.is_dir() {
        // A .scriv is a bundle directory; a lone file is a different format.
        return Err("unsupported_source".into());
    }
    let scrivx = find_scrivx(path)?;
    let raw = std::fs::read_to_string(&scrivx).map_err(|_| "io".to_string())?;
    let entries = parse_binder(&raw)?;

    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled")
        .to_string();

    let mut chapters = Vec::new();
    let mut saw_notes = false;
    let mut saw_formatting = false;
    let mut saw_attachment = entries.iter().any(BinderEntry::is_attachment);

    for entry in &entries {
        let Some(text_path) = locate(path, &entry.id, Text::Content) else {
            // A folder with no text of its own contributes nothing but order.
            continue;
        };
        let bytes = std::fs::read(&text_path).map_err(|_| "io".to_string())?;
        if rtf_has_formatting(&bytes) {
            saw_formatting = true;
        }
        let body = to_markdown(&rtf_to_text(&bytes));
        if body.is_empty() && !entry.is_text() {
            continue;
        }
        if locate(path, &entry.id, Text::Notes).is_some() {
            saw_notes = true;
        }
        if locate(path, &entry.id, Text::Attachment).is_some() {
            saw_attachment = true;
        }
        let synopsis = locate(path, &entry.id, Text::Synopsis)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        chapters.push(ImportedChapter {
            title: if entry.title.is_empty() { "Untitled".into() } else { entry.title.clone() },
            body,
            synopsis,
        });
    }

    // Only report a loss the project actually has: a warning about something
    // absent is noise that teaches the reader to ignore the list.
    let mut warnings = Vec::new();
    if entries.iter().any(|e| !e.title.is_empty()) && has_labels(&raw) {
        warnings.push(WARN_LABELS.to_string());
    }
    if saw_notes {
        warnings.push(WARN_NOTES.to_string());
    }
    if saw_attachment {
        warnings.push(WARN_IMAGES.to_string());
    }
    if saw_formatting {
        warnings.push(WARN_FORMATTING.to_string());
    }

    Ok(Imported { title, chapters, warnings })
}

fn find_scrivx(bundle: &Path) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(bundle).map_err(|_| "io".to_string())?;
    entries
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("scrivx"))
        .ok_or_else(|| "unsupported_source".to_string())
}

/// Labels and status are project settings referenced per item; their presence
/// in the binder is what makes the loss real.
fn has_labels(scrivx: &str) -> bool {
    scrivx.contains("<LabelID>") || scrivx.contains("<StatusID>")
}

enum Text {
    Content,
    Synopsis,
    Notes,
    Attachment,
}

/// Scrivener 3 keys files by UUID under `Files/Data/<UUID>/`; Scrivener 2 keys
/// them by integer ID under `Files/Docs/`. Probe both rather than sniffing a
/// version, so a hybrid or hand-moved project still reads.
fn locate(bundle: &Path, id: &str, what: Text) -> Option<PathBuf> {
    let (v3, v2): (&str, String) = match what {
        Text::Content => ("content.rtf", format!("{id}.rtf")),
        Text::Synopsis => ("synopsis.txt", format!("{id}_synopsis.txt")),
        Text::Notes => ("notes.rtf", format!("{id}_notes.rtf")),
        Text::Attachment => ("content.pdf", format!("{id}.pdf")),
    };
    let candidates = [
        bundle.join("Files").join("Data").join(id).join(v3),
        bundle.join("Files").join("Docs").join(&v2),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// Walk the binder in document order. Nested items flatten, because a
/// manuscript is a sequence of chapters however the writer filed them.
fn parse_binder(xml: &str) -> Result<Vec<BinderEntry>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut entries: Vec<BinderEntry> = Vec::new();
    let mut in_binder = false;
    let mut depth = 0usize;
    // Depth of the enclosing Trash item, if we are inside one.
    let mut trash_depth: Option<usize> = None;
    // Depth of the BinderItem whose <Title> we are waiting for.
    let mut awaiting_title: Option<usize> = None;
    let mut stack: Vec<usize> = Vec::new();

    loop {
        match reader.read_event() {
            Err(_) => return Err("unsupported_source".into()),
            Ok(Event::Eof) => break,
            Ok(Event::Start(tag)) => {
                let name = tag.name().local_name().as_ref().to_string();
                depth += 1;
                match name.as_str() {
                    "Binder" => in_binder = true,
                    "BinderItem" if in_binder => {
                        let kind = attr(&tag, "Type").unwrap_or_default();
                        if kind == TRASH_TYPE && trash_depth.is_none() {
                            trash_depth = Some(depth);
                        }
                        // Scrivener 3 keys by UUID, Scrivener 2 by ID.
                        let id = attr(&tag, "UUID").or_else(|| attr(&tag, "ID")).unwrap_or_default();
                        if trash_depth.is_none() && !id.is_empty() {
                            entries.push(BinderEntry { id, title: String::new(), kind });
                            stack.push(entries.len() - 1);
                            awaiting_title = Some(depth);
                        } else {
                            stack.push(usize::MAX);
                        }
                    }
                    "Title" if awaiting_title == Some(depth - 1) => {
                        if let Ok(Event::Text(text)) = reader.read_event() {
                            if let Some(&idx) = stack.last() {
                                if idx != usize::MAX {
                                    entries[idx].title = text.xml10_content().trim().to_string();
                                }
                            }
                        }
                        // The matching </Title> is consumed by the loop below.
                        depth -= 1;
                        awaiting_title = None;
                        continue;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(tag)) => {
                let name = tag.name().local_name().as_ref().to_string();
                if name == "BinderItem" && in_binder {
                    stack.pop();
                }
                if name == "Binder" {
                    in_binder = false;
                }
                if trash_depth == Some(depth) {
                    trash_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            Ok(_) => {}
        }
    }
    Ok(entries)
}

fn attr(tag: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    tag.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok())
        .map(|v| v.into_owned())
}

/// Bold and italic runs are the formatting a manuscript actually carries; their
/// presence is what makes the "formatting dropped" warning true.
fn rtf_has_formatting(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    ["\\b ", "\\b\\", "\\i ", "\\i\\", "\\ul"].iter().any(|m| text.contains(m))
}

/// Paragraphs separated by blank lines. Scrivener has no scene concept that
/// maps onto `##`, so none is invented.
fn to_markdown(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Windows-1252 differs from Latin-1 only in 0x80–0x9F; everything else maps
/// straight onto its Unicode scalar.
const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

fn decode_byte(b: u8) -> char {
    match b {
        0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

/// Destinations whose *content* is not prose and must be dropped whole.
const SKIP_DEST: [&str; 22] = [
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "footnote",
    "themedata", "colorschememapping", "datastore", "generator", "expandedcolortbl", "listtable",
    "listoverridetable", "rsidtbl", "latentstyles", "wgrffmtfilter", "pgdsctbl", "filetbl",
    "revtbl",
];

/// Minimum-viable RTF to plain text: enough control words to read a manuscript,
/// not a parser. Ported from a reference implementation whose output was
/// checked against macOS `textutil` on the same files.
fn rtf_to_text(bytes: &[u8]) -> String {
    // Decode as single bytes first: `\'hh` escapes address the document's
    // codepage, so the text cannot be treated as UTF-8 up front.
    let chars: Vec<char> = bytes.iter().map(|b| *b as char).collect();
    let n = chars.len();
    let mut out = String::new();
    let mut i = 0usize;
    let mut depth: i32 = 0;
    let mut skip_to: Option<i32> = None;
    let mut ucskip: usize = 1;
    let mut pending_uc: usize = 0;
    let mut high_surrogate: Option<u32> = None;

    while i < n {
        let c = chars[i];
        if c == '{' {
            depth += 1;
            i += 1;
            continue;
        }
        if c == '}' {
            if let Some(limit) = skip_to {
                if depth <= limit {
                    skip_to = None;
                }
            }
            depth -= 1;
            i += 1;
            continue;
        }
        if c == '\\' {
            // Control word: letters, an optional signed argument, one optional space.
            let mut j = i + 1;
            while j < n && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            if j > i + 1 {
                let word: String = chars[i + 1..j].iter().collect();
                let mut k = j;
                if k < n && (chars[k] == '-' || chars[k].is_ascii_digit()) {
                    if chars[k] == '-' {
                        k += 1;
                    }
                    while k < n && chars[k].is_ascii_digit() {
                        k += 1;
                    }
                }
                let arg: Option<i64> = if k > j { chars[j..k].iter().collect::<String>().parse().ok() } else { None };
                if k < n && chars[k] == ' ' {
                    k += 1;
                }
                i = k;
                if skip_to.is_some() {
                    continue;
                }
                match word.as_str() {
                    "u" => {
                        if let Some(raw) = arg {
                            // RTF writes codepoints above 32767 as a negative i16.
                            let cp = if raw < 0 { (raw + 65536) as u32 } else { raw as u32 };
                            match cp {
                                0xD800..=0xDBFF => high_surrogate = Some(cp),
                                0xDC00..=0xDFFF => {
                                    if let Some(hi) = high_surrogate.take() {
                                        let joined = 0x10000 + ((hi - 0xD800) << 10) + (cp - 0xDC00);
                                        if let Some(ch) = char::from_u32(joined) {
                                            out.push(ch);
                                        }
                                    }
                                }
                                _ => {
                                    if let Some(ch) = char::from_u32(cp) {
                                        out.push(ch);
                                    }
                                }
                            }
                            // The ASCII fallback that follows a \u must not be read as text.
                            pending_uc = ucskip;
                        }
                    }
                    "uc" => ucskip = arg.unwrap_or(1).max(0) as usize,
                    "par" | "line" => out.push('\n'),
                    "tab" => out.push('\t'),
                    "emdash" => out.push('\u{2014}'),
                    "endash" => out.push('\u{2013}'),
                    "lquote" => out.push('\u{2018}'),
                    "rquote" => out.push('\u{2019}'),
                    "ldblquote" => out.push('\u{201C}'),
                    "rdblquote" => out.push('\u{201D}'),
                    "bullet" => out.push('\u{2022}'),
                    other if SKIP_DEST.contains(&other) => skip_to = Some(depth),
                    _ => {}
                }
                continue;
            }
            // Control symbol.
            let next = if i + 1 < n { chars[i + 1] } else { '\0' };
            match next {
                '\'' => {
                    let hex: String = chars.get(i + 2..i + 4).map(|s| s.iter().collect()).unwrap_or_default();
                    i = (i + 4).min(n);
                    if skip_to.is_none() {
                        if pending_uc > 0 {
                            pending_uc -= 1;
                        } else if let Ok(b) = u8::from_str_radix(&hex, 16) {
                            out.push(decode_byte(b));
                        }
                    }
                }
                '*' => {
                    // `\*\destination` — the whole group is unknown-and-ignorable.
                    i += 2;
                    skip_to = Some(depth);
                }
                '\\' | '{' | '}' => {
                    i += 2;
                    if skip_to.is_none() {
                        out.push(next);
                    }
                }
                '\n' | '\r' => {
                    i += 2;
                    if skip_to.is_none() {
                        out.push('\n');
                    }
                }
                _ => i += 2,
            }
            continue;
        }
        i += 1;
        // Raw line breaks are layout in the source file, not text.
        if c == '\r' || c == '\n' {
            continue;
        }
        if skip_to.is_some() {
            continue;
        }
        if pending_uc > 0 {
            pending_uc -= 1;
            continue;
        }
        out.push(c);
    }

    tidy(&out)
}

fn tidy(text: &str) -> String {
    let mut lines: Vec<String> = text.split('\n').map(|l| l.trim_end().to_string()).collect();
    // Collapse runs of blank lines so paragraphs do not drift apart.
    lines.dedup_by(|a, b| a.is_empty() && b.is_empty());
    lines.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn bundle(dir: &Path, name: &str, scrivx: &str) -> PathBuf {
        let root = dir.join(format!("{name}.scriv"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(format!("{name}.scrivx")), scrivx).unwrap();
        root
    }

    fn v3_doc(root: &Path, uuid: &str, rtf: &str) {
        let dir = root.join("Files").join("Data").join(uuid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("content.rtf"), rtf).unwrap();
    }

    fn v2_doc(root: &Path, id: &str, rtf: &str) {
        let dir = root.join("Files").join("Docs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{id}.rtf")), rtf).unwrap();
    }

    fn rtf(body: &str) -> String {
        format!("{{\\rtf1\\ansi\\ansicpg1252\\deff0{{\\fonttbl{{\\f0 Times;}}}}\\pard {body}}}")
    }

    const V3_BINDER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Version="2.0">
  <Binder>
    <BinderItem UUID="AAA" Type="DraftFolder"><Title>Manuscript</Title>
      <Children>
        <BinderItem UUID="C1" Type="Text"><Title>Chapter One</Title></BinderItem>
        <BinderItem UUID="C2" Type="Text"><Title>Chapter Two</Title></BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="TRASH" Type="TrashFolder"><Title>Trash</Title>
      <Children>
        <BinderItem UUID="DEL" Type="Text"><Title>Deleted draft</Title></BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>"#;

    #[test]
    fn the_binder_order_survives_and_nesting_flattens() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Novel", V3_BINDER);
        v3_doc(&root, "C1", &rtf("First chapter.\\par"));
        v3_doc(&root, "C2", &rtf("Second chapter.\\par"));

        let imported = import_file(&root).unwrap();
        assert_eq!(imported.title, "Novel");
        let titles: Vec<&str> = imported.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["Chapter One", "Chapter Two"]);
        assert_eq!(imported.chapters[0].body, "First chapter.");
    }

    #[test]
    fn what_the_writer_threw_away_is_not_imported() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Novel", V3_BINDER);
        v3_doc(&root, "C1", &rtf("Kept.\\par"));
        // The trashed document has text on disk, and still must not appear.
        v3_doc(&root, "DEL", &rtf("Thrown away.\\par"));

        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters.len(), 1);
        assert!(!imported.chapters.iter().any(|c| c.body.contains("Thrown away")));
    }

    #[test]
    fn a_scrivener_2_project_reads_from_its_own_layout() {
        let dir = tempfile::tempdir().unwrap();
        let scrivx = r#"<ScrivenerProject Version="1.0"><Binder>
          <BinderItem ID="0" Type="DraftFolder"><Title>Draft</Title><Children>
            <BinderItem ID="3" Type="Text"><Title>Introduction</Title></BinderItem>
          </Children></BinderItem></Binder></ScrivenerProject>"#;
        let root = bundle(dir.path(), "Old", scrivx);
        v2_doc(&root, "3", &rtf("Legacy prose.\\par"));
        fs::write(root.join("Files").join("Docs").join("3_synopsis.txt"), "A beginning.").unwrap();

        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters.len(), 1);
        assert_eq!(imported.chapters[0].title, "Introduction");
        assert_eq!(imported.chapters[0].body, "Legacy prose.");
        assert_eq!(imported.chapters[0].synopsis.as_deref(), Some("A beginning."));
    }

    #[test]
    fn a_synopsis_lands_on_its_own_chapter() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Novel", V3_BINDER);
        v3_doc(&root, "C1", &rtf("One.\\par"));
        v3_doc(&root, "C2", &rtf("Two.\\par"));
        fs::write(
            root.join("Files").join("Data").join("C2").join("synopsis.txt"),
            "  She leaves.  ",
        )
        .unwrap();

        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters[0].synopsis, None);
        assert_eq!(imported.chapters[1].synopsis.as_deref(), Some("She leaves."));
    }

    #[test]
    fn spanish_text_survives_both_escape_forms() {
        // \'e9 is the cp1252 byte; \u237? is the unicode escape with its
        // ASCII fallback, which must not leak into the text.
        let text = rtf_to_text(rtf("Despu\\'e9s \\u237?ntimo a\\'f1o \\u8212?fin\\par").as_bytes());
        assert_eq!(text, "Después íntimo año —fin");
    }

    #[test]
    fn an_ignorable_destination_is_dropped_whole() {
        let src = "{\\rtf1\\ansi{\\*\\generator Riched20 10.0;}{\\info{\\title Secreto}}Visible\\par}";
        let text = rtf_to_text(src.as_bytes());
        assert_eq!(text, "Visible");
        assert!(!text.contains("Riched20"), "generator leaked");
        assert!(!text.contains("Secreto"), "info leaked");
    }

    #[test]
    fn braces_tabs_and_escapes_read_as_written() {
        let text = rtf_to_text(rtf("tab:\\tab fin\\line segunda\\par \\{llaves\\} y \\\\barra\\par").as_bytes());
        assert_eq!(text, "tab:\tfin\nsegunda\n{llaves} y \\barra");
    }

    #[test]
    fn a_surrogate_pair_becomes_one_character() {
        // RTF writes an astral codepoint as two negative-i16 escapes.
        let text = rtf_to_text(rtf("emoji: \\u-10179?\\u-8703?\\par").as_bytes());
        assert!(text.starts_with("emoji: "));
        // \u-10179 \u-8703 is the surrogate pair for U+1F601, as the
        // reference extractor also produces.
        assert_eq!(text.chars().last().unwrap(), '\u{1F601}');
    }

    #[test]
    fn paragraphs_become_markdown_blocks() {
        let text = rtf_to_text(rtf("Uno.\\par Dos.\\par\\par Tres.\\par").as_bytes());
        assert_eq!(to_markdown(&text), "Uno.\n\nDos.\n\nTres.");
    }

    #[test]
    fn losses_are_reported_only_when_the_project_has_them() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Plain", V3_BINDER);
        v3_doc(&root, "C1", &rtf("Plain prose.\\par"));
        let plain = import_file(&root).unwrap();
        assert!(plain.warnings.is_empty(), "nothing was lost: {:?}", plain.warnings);

        // Now give the project a note and a bold run, and only those appear.
        fs::write(root.join("Files").join("Data").join("C1").join("notes.rtf"), rtf("Note.")).unwrap();
        v3_doc(&root, "C2", &rtf("A \\b bold\\b0  word.\\par"));
        let lossy = import_file(&root).unwrap();
        assert!(lossy.warnings.contains(&WARN_NOTES.to_string()));
        assert!(lossy.warnings.contains(&WARN_FORMATTING.to_string()));
        assert!(!lossy.warnings.contains(&WARN_IMAGES.to_string()));
    }

    #[test]
    fn an_attachment_in_the_binder_is_reported_as_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let scrivx = r#"<ScrivenerProject><Binder>
          <BinderItem UUID="C1" Type="Text"><Title>One</Title></BinderItem>
          <BinderItem UUID="IMG" Type="Image"><Title>Cover</Title></BinderItem>
        </Binder></ScrivenerProject>"#;
        let root = bundle(dir.path(), "WithArt", scrivx);
        v3_doc(&root, "C1", &rtf("Prose.\\par"));
        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters.len(), 1, "an image is not a chapter");
        assert!(imported.warnings.contains(&WARN_IMAGES.to_string()));
    }

    #[test]
    fn labels_are_reported_when_the_binder_uses_them() {
        let dir = tempfile::tempdir().unwrap();
        let scrivx = r#"<ScrivenerProject><Binder>
          <BinderItem UUID="C1" Type="Text"><Title>One</Title>
            <MetaData><LabelID>3</LabelID></MetaData></BinderItem>
        </Binder></ScrivenerProject>"#;
        let root = bundle(dir.path(), "Labelled", scrivx);
        v3_doc(&root, "C1", &rtf("Prose.\\par"));
        assert!(import_file(&root).unwrap().warnings.contains(&WARN_LABELS.to_string()));
    }

    #[test]
    fn a_folder_with_its_own_text_still_counts() {
        let dir = tempfile::tempdir().unwrap();
        let scrivx = r#"<ScrivenerProject><Binder>
          <BinderItem UUID="F1" Type="Folder"><Title>Part One</Title><Children>
            <BinderItem UUID="C1" Type="Text"><Title>One</Title></BinderItem>
          </Children></BinderItem>
        </Binder></ScrivenerProject>"#;
        let root = bundle(dir.path(), "Parts", scrivx);
        v3_doc(&root, "F1", &rtf("Folder prose.\\par"));
        v3_doc(&root, "C1", &rtf("Chapter prose.\\par"));
        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters.len(), 2);
        assert_eq!(imported.chapters[0].title, "Part One");
    }

    #[test]
    fn a_folder_without_text_contributes_no_chapter() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Novel", V3_BINDER);
        v3_doc(&root, "C1", &rtf("Only chapter.\\par"));
        let imported = import_file(&root).unwrap();
        assert_eq!(imported.chapters.len(), 1, "the empty DraftFolder is not a chapter");
    }

    #[test]
    fn a_source_that_is_not_a_scrivener_project_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        // A plain directory with no .scrivx.
        let empty = dir.path().join("NotAProject.scriv");
        fs::create_dir_all(&empty).unwrap();
        assert_eq!(import_file(&empty).unwrap_err(), "unsupported_source");

        // A file rather than a bundle directory.
        let file = dir.path().join("book.scriv");
        fs::write(&file, "not a bundle").unwrap();
        assert_eq!(import_file(&file).unwrap_err(), "unsupported_source");

        // A .scrivx that is not XML at all.
        let broken = bundle(dir.path(), "Broken", "this is not xml <<<");
        assert!(import_file(&broken).is_err());
    }

    #[test]
    fn a_truncated_rtf_yields_text_rather_than_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let root = bundle(dir.path(), "Novel", V3_BINDER);
        // Unbalanced braces and a control word cut off mid-escape.
        v3_doc(&root, "C1", "{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}Half a sentence\\'e");
        let imported = import_file(&root).unwrap();
        assert!(imported.chapters[0].body.contains("Half a sentence"));
    }

    #[test]
    fn the_reference_fixtures_read_the_same_way() {
        // The reference extractor's output was checked against macOS textutil;
        // these are the same bytes, so a regression here is a real one.
        let Ok(edge) = fs::read("/tmp/m5/scriv/edge.rtf") else { return };
        let text = rtf_to_text(&edge);
        assert!(text.contains("Hola —mundo"));
        assert!(text.contains("tab:\tfin"));
        assert!(text.contains("Después de bookmark"));
        assert!(text.contains("{llaves} y \\barra"));
        assert!(!text.contains("Riched20"), "generator destination leaked");
        assert!(!text.contains("Secreto"), "info destination leaked");
    }
}
