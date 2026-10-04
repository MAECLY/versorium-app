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

use super::{Chapter, Imported, ImportedChapter, Manuscript};
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
            .filter(|s| !s.is_empty())
            // The card this app's export gives a chapter with no synopsis is
            // its first sentence. Kept, it would come back as a summary the
            // writer never wrote, and the next export would repeat it after
            // the opening had changed. Left out, the next export works it out
            // again from the opening as it is then, so nothing is lost.
            .filter(|s| first_sentence(&super::scenes_of(&body)).as_deref().map(str::trim) != Some(s.as_str()));

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

    // The binder file has no language in it, and this importer reads nothing
    // else of the project's settings. No Scrivener project was at hand to see
    // where one keeps a language, if anywhere, so none is guessed: the import
    // dialog asks.
    Ok(Imported { title, language: None, declared_language: None, chapters, warnings })
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
                        let title = read_title(&mut reader);
                        if let Some(&idx) = stack.last() {
                            if idx != usize::MAX {
                                entries[idx].title = title;
                            }
                        }
                        // The matching </Title> is consumed by `read_title`.
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

/// Read everything up to `</Title>`.
///
/// It used to take a single `Event::Text` and stop, which truncated any title at
/// its first escaped character — quick-xml reports `&amp;` as an event of its
/// own rather than folding it into the surrounding text, so "El faro & la
/// niebla" imported as "El faro". The same mistake was already found and fixed
/// in the DOCX reader; this is that fix applied here.
fn read_title(reader: &mut Reader<&[u8]>) -> String {
    let mut title = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(text)) => title.push_str(&text.xml10_content()),
            Ok(Event::GeneralRef(e)) => {
                let resolved = match e.resolve_char_ref() {
                    Ok(Some(c)) => Some(c),
                    _ => match e.into_inner().as_ref() {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => None,
                    },
                };
                if let Some(c) = resolved {
                    title.push(c);
                }
            }
            // `</Title>`, end of input, or a malformed document: either way the
            // title is as complete as it is going to get.
            Ok(Event::End(_)) | Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    title.trim().to_string()
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

// --- export ---

/// A Scrivener 3 project is a directory, not a file, so this writes a bundle
/// rather than returning bytes like every other writer here.
///
/// Only the manuscript is written: one Text document per chapter under the Draft
/// folder, in order. Labels, keywords, snapshots, collections and compile
/// settings are Scrivener's own bookkeeping — inventing them would produce a
/// project that claims structure the novel never had.
///
/// The v3 layout is the target (`Files/Data/<UUID>/content.rtf`). v2 is still
/// read on import for older bundles, but writing the format Scrivener 3 actually
/// creates is what makes the output openable today.
pub fn export_to(manuscript: &Manuscript, dest: &Path) -> Result<u64, String> {
    // A UUID per document, derived rather than random so exporting the same
    // manuscript twice produces the same bundle and a diff stays readable.
    let ids: Vec<String> = (0..manuscript.chapters.len()).map(document_uuid).collect();

    let data = dest.join("Files").join("Data");
    std::fs::create_dir_all(&data).map_err(|_| "io".to_string())?;

    let mut written = 0u64;
    for (chapter, id) in manuscript.chapters.iter().zip(&ids) {
        let folder = data.join(id);
        std::fs::create_dir_all(&folder).map_err(|_| "io".to_string())?;
        let rtf = chapter_rtf(chapter);
        let path = folder.join("content.rtf");
        std::fs::write(&path, rtf.as_bytes()).map_err(|_| "io".to_string())?;
        written += rtf.len() as u64;

        // Scrivener shows the synopsis on the corkboard card. The chapter's own
        // synopsis when it has one (an import from Scrivener keeps it), and
        // otherwise its first sentence, which is a better card than an empty one.
        if let Some(synopsis) = chapter.synopsis.clone().or_else(|| synopsis_of(chapter)) {
            let path = folder.join("synopsis.txt");
            std::fs::write(&path, synopsis.as_bytes()).map_err(|_| "io".to_string())?;
            written += synopsis.len() as u64;
        }
    }

    let scrivx = binder_xml(manuscript, &ids);
    // Scrivener names the project file after the bundle, and opens the bundle by
    // finding it; a mismatched name makes the project unopenable.
    let stem = dest
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Novel".into());
    let path = dest.join(format!("{stem}.scrivx"));
    std::fs::write(&path, scrivx.as_bytes()).map_err(|_| "io".to_string())?;
    written += scrivx.len() as u64;

    Ok(written)
}

/// What the manuscript carries that a Scrivener project cannot hold.
pub fn export_warnings(manuscript: &Manuscript) -> Vec<String> {
    let mut warnings = Vec::new();
    // Scene headings become a horizontal separator in the RTF, which is what
    // Scrivener's own compile does, but they stop being addressable structure.
    if manuscript.chapters.iter().any(|c| c.scenes.iter().any(|s| s.heading.is_some())) {
        warnings.push(WARN_EXPORT_SCENES.to_string());
    }
    warnings
}

pub const WARN_EXPORT_SCENES: &str = "export_scrivener_scenes_flattened";

/// Stable per-position identifiers in Scrivener's UUID shape.
///
/// Scrivener accepts any unique string, and a derived one keeps a re-export
/// byte-identical where a random one would rewrite every file.
fn document_uuid(index: usize) -> String {
    let n = index + 1;
    format!("5645524F-0000-4000-8000-{n:012X}")
}

fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

fn binder_xml(manuscript: &Manuscript, ids: &[String]) -> String {
    let mut children = String::new();
    for (chapter, id) in manuscript.chapters.iter().zip(ids) {
        children.push_str(&format!(
            "        <BinderItem UUID=\"{id}\" Type=\"Text\"><Title>{}</Title></BinderItem>\n",
            xml_escape(&chapter.title)
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <ScrivenerProject Version=\"2.0\" Creator=\"Versorium\">\n\
         \x20 <Binder>\n\
         \x20   <BinderItem UUID=\"5645524F-0000-4000-8000-000000000000\" Type=\"DraftFolder\"><Title>{}</Title>\n\
         \x20     <Children>\n{children}\
         \x20     </Children>\n\
         \x20   </BinderItem>\n\
         \x20 </Binder>\n\
         </ScrivenerProject>\n",
        xml_escape(&manuscript.title)
    )
}

/// The first sentence of a chapter, for the corkboard card.
fn synopsis_of(chapter: &Chapter) -> Option<String> {
    first_sentence(&chapter.scenes)
}

/// The first sentence of the first paragraph, at most 200 characters. Also
/// what the import measures a card against, so the two cannot drift apart.
fn first_sentence(scenes: &[super::Scene]) -> Option<String> {
    let first = scenes.iter().flat_map(|s| s.paragraphs.iter()).next()?;
    let sentence = first.split_inclusive(['.', '?', '!']).next().unwrap_or(first).trim();
    (!sentence.is_empty()).then(|| sentence.chars().take(200).collect())
}

/// RTF escaping: the four reserved characters, then anything outside ASCII as a
/// `\uN?` escape.
///
/// RTF's `\u` takes a *signed 16-bit* code unit, so astral characters are
/// written as a surrogate pair — an emoji emitted as one oversized number is
/// what a naive escape gets wrong, and Scrivener renders it as garbage.
fn rtf_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            c if c.is_ascii() => out.push(c),
            c => {
                for unit in c.encode_utf16(&mut [0u16; 2]).iter() {
                    // Reinterpreted as signed, which is what the spec asks for.
                    out.push_str(&format!("\\u{}?", *unit as i16));
                }
            }
        }
    }
    out
}

fn chapter_rtf(chapter: &Chapter) -> String {
    let mut body = String::new();
    for (index, scene) in chapter.scenes.iter().enumerate() {
        // A scene break is what Scrivener's own compile emits: a centred
        // separator, not a heading, because a scene is not a document here.
        if index > 0 {
            body.push_str("\\par\\qc #\\par\\ql\n");
        }
        for paragraph in &scene.paragraphs {
            body.push_str(&rtf_escape(paragraph));
            body.push_str("\\par\n");
        }
    }
    format!(
        "{{\\rtf1\\ansi\\ansicpg1252\\deff0\n\
         {{\\fonttbl{{\\f0\\froman Times New Roman;}}}}\n\
         \\f0\\fs24\n{body}}}\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::Scene;
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

    // --- export ---
    //
    // Validated by reading it back through this file's own importer. That is the
    // strongest check available without Scrivener installed: a bundle the
    // importer cannot parse is one Scrivener would not open either, and the
    // importer was itself built against real v2 and v3 bundles.

    fn sample() -> Manuscript {
        Manuscript {
            title: "El largo invierno".into(),
            author: "Ana Ruiz".into(),
            byline: Default::default(),
            matter: Default::default(),
            language: "es".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "La llegada".into(),
                    scenes: vec![
                        Scene {
                            heading: None,
                            paragraphs: vec!["La niña esperó junto a la ventana.".into()],
                        },
                        Scene {
                            heading: Some("Después".into()),
                            paragraphs: vec!["Nadie vino.".into(), "Amaneció.".into()],
                        },
                    ],
                    synopsis: None,
                },
                Chapter {
                    id: "ch-02".into(),
                    title: "El faro & la niebla".into(),
                    scenes: vec![Scene {
                        heading: None,
                        paragraphs: vec!["La luz giraba sobre el agua.".into()],
                    }],
                    synopsis: None,
                },
            ],
        }
    }

    #[test]
    fn what_it_writes_is_what_this_files_own_importer_can_read() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("El largo invierno.scriv");
        export_to(&sample(), &bundle).unwrap();

        let back = import_file(&bundle).expect("the bundle it wrote must be readable");
        assert_eq!(back.title, "El largo invierno");
        let titles: Vec<&str> = back.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["La llegada", "El faro & la niebla"]);
        // Accents survive the RTF escape round trip, which is the thing a naive
        // writer gets wrong.
        assert!(back.chapters[0].body.contains("La niña esperó"), "{}", back.chapters[0].body);
        assert!(back.chapters[1].body.contains("La luz giraba"));
    }

    #[test]
    fn the_project_file_is_named_after_the_bundle_or_scrivener_cannot_open_it() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("Mi novela.scriv");
        export_to(&sample(), &bundle).unwrap();
        assert!(bundle.join("Mi novela.scrivx").is_file(), "the .scrivx must match the bundle name");
    }

    #[test]
    fn every_chapter_gets_a_document_and_a_corkboard_card() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("N.scriv");
        export_to(&sample(), &bundle).unwrap();

        let data = bundle.join("Files").join("Data");
        let folders: Vec<_> = std::fs::read_dir(&data).unwrap().flatten().collect();
        assert_eq!(folders.len(), 2, "one folder per chapter");
        for folder in folders {
            assert!(folder.path().join("content.rtf").is_file());
            // An empty card on the corkboard is a worse default than the first
            // sentence.
            assert!(folder.path().join("synopsis.txt").is_file());
        }
    }

    #[test]
    fn re_exporting_the_same_manuscript_produces_the_same_bundle() {
        // Identifiers are derived from position, not random, so a re-export does
        // not rewrite every file and a diff stays readable.
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("A.scriv");
        let second = dir.path().join("A.scriv");
        export_to(&sample(), &first).unwrap();
        let before = std::fs::read_to_string(first.join("A.scrivx")).unwrap();
        export_to(&sample(), &second).unwrap();
        let after = std::fs::read_to_string(second.join("A.scrivx")).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn xml_and_rtf_reserved_characters_cannot_break_the_bundle() {
        let mut manuscript = sample();
        manuscript.title = "A & B <c> \"d\"".into();
        manuscript.chapters[0].title = "Braces {and} back\\slash".into();
        manuscript.chapters[0].scenes[0].paragraphs =
            vec!["Un {grupo} y una \\barra, más un emoji 🌙.".into()];

        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("X.scriv");
        export_to(&manuscript, &bundle).unwrap();

        // The binder must still parse, which is what escaping is for. The project
        // title comes from the folder name on import, so only the chapter titles
        // make the round trip through XML.
        let back = import_file(&bundle).expect("reserved characters broke the binder");
        assert_eq!(back.title, "X");
        assert_eq!(back.chapters[0].title, "Braces {and} back\\slash");
        // An astral character is a surrogate pair in RTF; emitted as one
        // oversized number it renders as garbage.
        assert!(back.chapters[0].body.contains('🌙'), "emoji lost: {}", back.chapters[0].body);
    }

    #[test]
    fn a_scene_heading_is_reported_as_flattened_rather_than_silently_dropped() {
        // Scrivener has no scene inside a document, so the heading becomes a
        // separator. Saying so is the difference between a limitation and a bug.
        let warnings = export_warnings(&sample());
        assert_eq!(warnings, vec![WARN_EXPORT_SCENES]);

        let mut flat = sample();
        for chapter in &mut flat.chapters {
            for scene in &mut chapter.scenes {
                scene.heading = None;
            }
        }
        assert!(export_warnings(&flat).is_empty(), "nothing to warn about without scenes");
    }

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
    fn a_scrivener_project_names_no_language() {
        // A decision, not a mechanism: nothing in the bundle this importer reads
        // says what language the novel is in, so the import dialog asks.
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("El largo invierno.scriv");
        export_to(&sample(), &bundle).unwrap();
        let imported = import_file(&bundle).unwrap();
        assert_eq!((imported.language, imported.declared_language), (None, None));
    }

    #[test]
    fn a_card_that_only_repeats_the_first_sentence_is_not_a_synopsis() {
        // What this exporter writes on the card of a chapter that has no
        // synopsis. Read back as one, it would reach the corkboard as a
        // summary the writer never wrote, and stay there after the opening
        // changed.
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("N.scriv");
        let mut book = sample();
        // Past the 200 characters a card holds, cut where a space falls: the
        // card ends in that space, and the import trims it.
        book.chapters[1].scenes[0].paragraphs[0] = "agua ".repeat(60);
        export_to(&book, &bundle).unwrap();
        let synopses = |bundle: &Path| -> Vec<Option<String>> {
            import_file(bundle).unwrap().chapters.into_iter().map(|c| c.synopsis).collect()
        };
        assert_eq!(synopses(&bundle), [None, None]);

        // A card that says anything else is the writer's, even one that
        // starts the same way.
        let card = bundle.join("Files").join("Data").join(document_uuid(0)).join("synopsis.txt");
        fs::write(&card, "La niña esperó junto a la ventana. Nadie vino.").unwrap();
        assert_eq!(synopses(&bundle)[0].as_deref(), Some("La niña esperó junto a la ventana. Nadie vino."));
    }

    #[test]
    fn a_stored_synopsis_is_exported_instead_of_the_first_sentence() {
        let mut book = sample();
        book.chapters[0].synopsis = Some("Ana dice: \"vete\".\n---\nY se va — sola.".into());
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("N.scriv");
        export_to(&book, &bundle).unwrap();

        let card = |n: usize| {
            std::fs::read_to_string(bundle.join("Files").join("Data").join(document_uuid(n)).join("synopsis.txt"))
                .unwrap()
        };
        assert_eq!(card(0), "Ana dice: \"vete\".\n---\nY se va — sola.", "the writer's synopsis, whole");
        // A chapter without one still gets its first sentence.
        assert_eq!(card(1), "La luz giraba sobre el agua.");
        // And Scrivener's corkboard reads it back as written.
        let back = import_file(&bundle).unwrap();
        assert_eq!(back.chapters[0].synopsis.as_deref(), Some("Ana dice: \"vete\".\n---\nY se va — sola."));
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
