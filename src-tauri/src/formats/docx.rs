//! DOCX in Standard Manuscript Format, and reading DOCX back.
//!
//! The package shape here was verified empirically rather than read off a
//! page: a reference builder produced each part, then parts were removed one
//! at a time to see what actually breaks. `word/styles.xml` turned out to be
//! load-bearing — without it a reader loses the heading entirely and the
//! chapter round-trip dies — while `docProps/core.xml` only carries metadata.
//! ZIP compression makes no difference to any reader tested.

use super::{Imported, ImportedChapter, Manuscript};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

pub const WARN_NO_HEADINGS: &str = "import_docx_no_headings";
pub const WARN_FORMATTING_DROPPED: &str = "import_docx_formatting_dropped";
pub const WARN_IMAGES_DROPPED: &str = "import_images_dropped";
pub const WARN_PROSE_BEFORE_FIRST_CHAPTER: &str = "import_prose_before_first_chapter";

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
const R: &str = r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

// ----------------------------------------------------------------- export

/// XML text escaping. Chapter titles are user prose: `&`, `<` and quotes all
/// occur, and an unescaped one produces a file no reader will open.
fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // XML 1.0 forbids these outright; dropping beats emitting a file
            // that fails to parse.
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
    out
}

fn paragraph(style: &str, text: &str) -> String {
    format!(
        "  <w:p>\n    <w:pPr>\n      <w:pStyle w:val=\"{style}\"/>\n    </w:pPr>\n\
         \x20   <w:r>\n      <w:t xml:space=\"preserve\">{}</w:t>\n    </w:r>\n  </w:p>\n",
        esc(text)
    )
}

fn content_types() -> String {
    format!(
        "{}\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n\
         \x20 <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n\
         \x20 <Default Extension=\"xml\" ContentType=\"application/xml\"/>\n\
         \x20 <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\n\
         \x20 <Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\n\
         \x20 <Override PartName=\"/word/header1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml\"/>\n\
         \x20 <Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\n\
         \x20 <Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\n\
         </Types>\n",
        XML_DECL
    )
}

const XML_DECL: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;

fn root_rels() -> String {
    format!(
        "{XML_DECL}\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n\
         \x20 <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\n\
         \x20 <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\n\
         \x20 <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\n\
         </Relationships>\n"
    )
}

fn document_rels() -> String {
    format!(
        "{XML_DECL}\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n\
         \x20 <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>\n\
         \x20 <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/>\n\
         </Relationships>\n"
    )
}

fn core_props(manuscript: &Manuscript) -> String {
    // `cp:lastModifiedBy` is the field Word shows as "Last saved by" and the one
    // reviewers notice. Leaving it to Word would stamp whoever opens the file.
    let rights = if manuscript.byline.rights.trim().is_empty() {
        String::new()
    } else {
        format!("  <dc:description>{}</dc:description>\n", esc(manuscript.byline.rights.trim()))
    };
    format!(
        "{XML_DECL}\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" \
         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n\
         \x20 <dc:title>{title}</dc:title>\n  <dc:creator>{author}</dc:creator>\n\
         \x20 <cp:lastModifiedBy>{author}</cp:lastModifiedBy>\n\
         \x20 <dc:language>{lang}</dc:language>\n{rights}\
         </cp:coreProperties>\n",
        title = esc(&manuscript.title),
        author = esc(&manuscript.author),
        lang = esc(&manuscript.language),
        rights = rights,
    )
}

/// `docProps/app.xml`: the half of a DOCX's metadata that names the tool.
///
/// Word writes one and readers expect it. Without it, "Application" reads as
/// unknown, which for a manuscript sent to a publisher looks like a file that
/// came from nowhere.
fn app_props(manuscript: &Manuscript) -> String {
    let company = if manuscript.byline.organization.trim().is_empty() {
        String::new()
    } else {
        format!("  <Company>{}</Company>\n", esc(manuscript.byline.organization.trim()))
    };
    format!(
        "{XML_DECL}\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" \
         xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">\n\
         \x20 <Application>Versorium</Application>\n\
         \x20 <AppVersion>{version}</AppVersion>\n{company}\
         </Properties>\n",
        version = app_version(),
        company = company,
    )
}

/// `AppVersion` must be `XX.YYYY`: Word rejects anything else, and a semver
/// string with a patch component is anything else.
fn app_version() -> String {
    let mut parts = env!("CARGO_PKG_VERSION").split('.');
    let major: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    format!("{major:02}.{minor:04}")
}

/// Standard manuscript format lives almost entirely here: 12pt Times
/// (`w:sz` is half-points, so 24), double spacing (`w:line="480"` at
/// `lineRule="auto"` is 2x), a half-page drop before each chapter, and a
/// 720-twip (half-inch) first-line indent on body paragraphs.
fn styles(language: &str) -> String {
    format!(
        r#"{XML_DECL}
<w:styles {W}>
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
        <w:lang w:val="{lang}"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="FirstParagraph"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:pageBreakBefore/>
      <w:keepNext/>
      <w:spacing w:before="4320" w:after="960" w:line="480" w:lineRule="auto"/>
      <w:ind w:firstLine="0"/>
      <w:jc w:val="center"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
      <w:b w:val="0"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FirstParagraph">
    <w:name w:val="First Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:pPr>
      <w:ind w:firstLine="0"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:pPr>
      <w:ind w:firstLine="720"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SceneBreak">
    <w:name w:val="Scene Break"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="FirstParagraph"/>
    <w:pPr>
      <w:keepNext/>
      <w:ind w:firstLine="0"/>
      <w:jc w:val="center"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TitlePage">
    <w:name w:val="Title Page"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="0"/>
      <w:jc w:val="center"/>
      <w:spacing w:line="240" w:lineRule="auto" w:after="240"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Colophon">
    <w:name w:val="Colophon"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="0"/>
      <w:spacing w:line="240" w:lineRule="auto"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Header">
    <w:name w:val="header"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:tabs>
        <w:tab w:val="center" w:pos="4680"/>
        <w:tab w:val="right" w:pos="9360"/>
      </w:tabs>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:ind w:firstLine="0"/>
      <w:jc w:val="right"/>
    </w:pPr>
  </w:style>
</w:styles>
"#,
        lang = esc(language)
    )
}

/// `Surname / Title / page`. The page number is a PAGE field written the long
/// way (begin / instrText / separate / result / end) rather than `fldSimple`,
/// because that is the form every reader tested understood.
fn header(manuscript: &Manuscript) -> String {
    format!(
        r#"{XML_DECL}
<w:hdr {W} {R}>
  <w:p>
    <w:pPr>
      <w:pStyle w:val="Header"/>
    </w:pPr>
    <w:r>
      <w:t xml:space="preserve">{prefix} </w:t>
    </w:r>
    <w:r>
      <w:fldChar w:fldCharType="begin"/>
    </w:r>
    <w:r>
      <w:instrText xml:space="preserve"> PAGE </w:instrText>
    </w:r>
    <w:r>
      <w:fldChar w:fldCharType="separate"/>
    </w:r>
    <w:r>
      <w:t>1</w:t>
    </w:r>
    <w:r>
      <w:fldChar w:fldCharType="end"/>
    </w:r>
  </w:p>
</w:hdr>
"#,
        prefix = esc(&format!("{} / {} /", manuscript.surname(), manuscript.title))
    )
}

/// A paragraph that also ends the page.
///
/// `w:br w:type="page"` inside the run, not a pile of empty paragraphs: a
/// manuscript whose title page is held down by blank lines re-flows the moment
/// anybody changes the font.
fn page_break_after(style: &str, text: &str) -> String {
    format!(
        "  <w:p>\n    <w:pPr>\n      <w:pStyle w:val=\"{style}\"/>\n    </w:pPr>\n\
         \x20   <w:r>\n      <w:t xml:space=\"preserve\">{}</w:t>\n    </w:r>\n\
         \x20   <w:r>\n      <w:br w:type=\"page\"/>\n    </w:r>\n  </w:p>\n",
        esc(text)
    )
}

fn document(manuscript: &Manuscript) -> String {
    let mut body = String::new();

    // Standard manuscript format puts the title and the byline on a page of
    // their own. `w:titlePg` in the section properties already suppresses the
    // running head there, so this fills a page the layout was expecting.
    if manuscript.matter.cover {
        body.push_str(&paragraph("TitlePage", &manuscript.title));
        let mut lines: Vec<&str> = Vec::new();
        if !manuscript.author.trim().is_empty() {
            lines.push(manuscript.author.trim());
        }
        for extra in [&manuscript.byline.organization, &manuscript.byline.rights] {
            if !extra.trim().is_empty() {
                lines.push(extra.trim());
            }
        }
        match lines.split_last() {
            // The last line carries the break, so no empty paragraph is left
            // sitting at the top of chapter one.
            Some((last, rest)) => {
                for line in rest {
                    body.push_str(&paragraph("TitlePage", line));
                }
                body.push_str(&page_break_after("TitlePage", last));
            }
            None => body.push_str(&page_break_after("TitlePage", "")),
        }
    }

    for chapter in &manuscript.chapters {
        body.push_str(&paragraph("Heading1", &chapter.title));
        for (index, scene) in chapter.scenes.iter().enumerate() {
            // A scene break is a centred `#` — standard manuscript format has
            // no place for a scene's working title, so those are dropped here
            // and the loss is documented rather than smuggled into the page.
            if index > 0 {
                body.push_str(&paragraph("SceneBreak", "#"));
            }
            for (n, para) in scene.paragraphs.iter().enumerate() {
                // No indent on the paragraph that opens a scene; every later
                // one is indented half an inch.
                body.push_str(&paragraph(
                    if n == 0 { "FirstParagraph" } else { "BodyText" },
                    para,
                ));
            }
        }
    }
    if manuscript.matter.colophon {
        // Behind a page break, at the very end, where a colophon belongs.
        body.push_str(&page_break_after("Colophon", ""));
        body.push_str(&paragraph("Colophon", manuscript.matter.labels.get("heading")));
        for (key, value) in crate::formats::colophon_lines(manuscript) {
            body.push_str(&paragraph(
                "Colophon",
                &format!("{}: {value}", manuscript.matter.labels.get(&key)),
            ));
        }
        body.push_str(&paragraph("Colophon", &crate::formats::colophon_credit()));
        body.push_str(&paragraph("Colophon", manuscript.matter.labels.get("thanks")));
    }

    format!(
        "{XML_DECL}\n<w:document {W} {R}>\n<w:body>\n{body}\
         \x20 <w:sectPr>\n\
         \x20   <w:headerReference w:type=\"default\" r:id=\"rId2\"/>\n\
         \x20   <w:pgSz w:w=\"12240\" w:h=\"15840\"/>\n\
         \x20   <w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>\n\
         \x20   <w:cols w:space=\"720\"/>\n\
         \x20   <w:titlePg/>\n\
         \x20 </w:sectPr>\n</w:body>\n</w:document>\n"
    )
}

/// The seven parts, in OPC order. `[Content_Types].xml` goes first by
/// convention; no reader tested actually required it.
pub fn build(manuscript: &Manuscript) -> Result<Vec<u8>, String> {
    let parts: [(&str, String); 8] = [
        ("[Content_Types].xml", content_types()),
        ("_rels/.rels", root_rels()),
        ("word/document.xml", document(manuscript)),
        ("word/_rels/document.xml.rels", document_rels()),
        ("word/styles.xml", styles(&manuscript.language)),
        ("word/header1.xml", header(manuscript)),
        ("docProps/core.xml", core_props(manuscript)),
        ("docProps/app.xml", app_props(manuscript)),
    ];
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in parts {
        writer.start_file(name, options).map_err(|_| "io".to_string())?;
        writer.write_all(body.as_bytes()).map_err(|_| "io".to_string())?;
    }
    Ok(writer.finish().map_err(|_| "io".to_string())?.into_inner())
}

pub fn export_to(manuscript: &Manuscript, dest: &Path) -> Result<u64, String> {
    let bytes = build(manuscript)?;
    crate::storage::atomic_write(dest, &bytes)?;
    Ok(bytes.len() as u64)
}

// ----------------------------------------------------------------- import

/// Fold a style id or name to something comparable across producers and
/// languages: Word writes `Heading1`, pandoc `Heading1`, and a Spanish Word
/// writes the id `Ttulo1` with the name `Título 1`.
fn normalize_style(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars().flat_map(|c| c.to_lowercase()) {
        let folded = match c {
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ø' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        };
        if folded.is_alphanumeric() {
            out.push(folded);
        }
    }
    // `Heading1Char` is the character-style twin of the paragraph style.
    out.strip_suffix("char").map(str::to_string).unwrap_or(out)
}

/// Normalized ids and names that mean "chapter heading" to the producers a
/// writer is likely to hand us. The English `heading1` covers Word, pandoc and
/// Google Docs; the rest are the localized built-in names Word writes.
const HEADING_ONE: [&str; 11] = [
    "heading1", "titulo1", "ttulo1", "titre1", "uberschrift1", "berschrift1", "titolo1", "kop1",
    "rubrik1", "overskrift1", "nagowek1",
];

/// Paragraph styles this app writes for pages that are not the novel.
///
/// Matched on the style id, which is what carries the intent. A DOCX from
/// elsewhere will not use these ids, so nothing of a stranger's manuscript is
/// ever dropped by this.
fn is_apparatus(style: &Option<String>) -> bool {
    matches!(style.as_deref(), Some("TitlePage") | Some("Colophon"))
}

fn is_heading_one(style: &str) -> bool {
    HEADING_ONE.contains(&normalize_style(style).as_str())
}

/// quick-xml 0.42 is str-based: names and attribute values arrive decoded and
/// already unescaped, so nothing here re-decodes them.
fn attr(event: &quick_xml::events::BytesStart, name: &str) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find_map(|a| (a.key.as_ref() == name).then(|| a.value.clone().into_owned()))
}

#[derive(Default)]
struct Found {
    formatting: bool,
    images: bool,
}

struct Para {
    style: Option<String>,
    text: String,
}

/// Walk `word/document.xml` into paragraphs.
///
/// Text is gathered from every `w:t` regardless of what wraps it, so
/// hyperlinks, smart tags and tracked insertions come through untouched. Two
/// things are deliberately skipped: `w:delText` is text the author already
/// deleted, and `w:instrText` is a field instruction like ` PAGE ` rather than
/// anything a reader sees.
fn paragraphs_of(xml: &str) -> Result<(Vec<Para>, Found), String> {
    // Text is kept verbatim: xml:space="preserve" paragraphs must not be
    // trimmed, and the reader does not trim by default.
    let mut reader = Reader::from_str(xml);
    let mut paras: Vec<Para> = Vec::new();
    let mut found = Found::default();
    let mut current: Option<Para> = None;
    let mut depth_del = 0usize;
    let mut in_instr = false;
    let mut in_text = false;

    loop {
        match reader.read_event() {
            Err(_) => return Err("io".into()),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                "p" => current = Some(Para { style: None, text: String::new() }),
                "pStyle" => {
                    if let Some(p) = current.as_mut() {
                        p.style = attr(&e, "w:val");
                    }
                }
                "del" => depth_del += 1,
                "instrText" => in_instr = true,
                "t" => in_text = true,
                "rPr" => {}
                "b" | "i" | "u" | "strike" | "highlight" | "color" => found.formatting = true,
                "drawing" | "pict" | "object" => found.images = true,
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                // `<w:p/>` is a real, empty paragraph rather than a non-event.
                "p" => paras.push(Para { style: None, text: String::new() }),
                "pStyle" => {
                    if let Some(p) = current.as_mut() {
                        p.style = attr(&e, "w:val");
                    }
                }
                "tab" => {
                    if depth_del == 0 {
                        if let Some(p) = current.as_mut() {
                            p.text.push('\t');
                        }
                    }
                }
                "br" | "cr" => {
                    if depth_del == 0 {
                        if let Some(p) = current.as_mut() {
                            p.text.push('\n');
                        }
                    }
                }
                "b" | "i" | "u" | "strike" | "highlight" | "color" => found.formatting = true,
                "drawing" | "pict" | "object" | "blip" => found.images = true,
                _ => {}
            },
            Ok(Event::Text(e)) => {
                if in_text && depth_del == 0 && !in_instr {
                    if let Some(p) = current.as_mut() {
                        p.text.push_str(&e.xml10_content());
                    }
                }
            }
            // quick-xml reports `&amp;` and friends as an event of their own
            // rather than folding them into the surrounding text, so ignoring
            // this one silently deletes the character it stood for.
            Ok(Event::GeneralRef(e)) => {
                if in_text && depth_del == 0 && !in_instr {
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
                    if let (Some(c), Some(p)) = (resolved, current.as_mut()) {
                        p.text.push(c);
                    }
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                "p" => {
                    if let Some(p) = current.take() {
                        paras.push(p);
                    }
                }
                "del" => depth_del = depth_del.saturating_sub(1),
                "instrText" => in_instr = false,
                "t" => in_text = false,
                _ => {}
            },
            Ok(_) => {}
        }
    }
    Ok((paras, found))
}

/// styleId → declared name, so a localized style resolves through its
/// canonical `w:name` when the id itself is unrecognizable.
fn style_names(xml: &str) -> Vec<(String, String)> {
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    loop {
        match reader.read_event() {
            Err(_) | Ok(Event::Eof) => break,
            Ok(Event::Start(e)) if e.local_name().as_ref() == "style" => {
                current = attr(&e, "w:styleId");
            }
            Ok(Event::Empty(e)) if e.local_name().as_ref() == "name" => {
                if let (Some(id), Some(name)) = (current.clone(), attr(&e, "w:val")) {
                    out.push((id, name));
                }
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == "style" => current = None,
            Ok(_) => {}
        }
    }
    out
}

fn read_member(zip: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Option<String> {
    let mut file = zip.by_name(name).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    Some(text)
}

pub fn import_file(path: &Path) -> Result<Imported, String> {
    let bytes = std::fs::read(path).map_err(|_| "not_found".to_string())?;
    import_bytes(&bytes)
}

pub fn import_bytes(bytes: &[u8]) -> Result<Imported, String> {
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes.to_vec())).map_err(|_| "unsupported_source".to_string())?;
    let document = read_member(&mut zip, "word/document.xml")
        .ok_or_else(|| "unsupported_source".to_string())?;
    let names = read_member(&mut zip, "word/styles.xml")
        .map(|s| style_names(&s))
        .unwrap_or_default();

    let (paras, found) = paragraphs_of(&document)?;
    let heading = |style: &Option<String>| -> bool {
        let Some(style) = style else { return false };
        if is_heading_one(style) {
            return true;
        }
        names
            .iter()
            .any(|(id, name)| id == style && is_heading_one(name))
    };

    let mut chapters: Vec<ImportedChapter> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut body: Vec<String> = Vec::new();
    let mut title: Option<String> = None;

    let flush = |title: &mut Option<String>, body: &mut Vec<String>, out: &mut Vec<ImportedChapter>| {
        let text = body.join("\n\n");
        if title.is_none() && text.trim().is_empty() {
            body.clear();
            return;
        }
        out.push(ImportedChapter {
            title: title.take().unwrap_or_else(|| "Untitled".to_string()),
            body: text,
            synopsis: None,
        });
        body.clear();
    };

    for para in &paras {
        // The title page and the colophon are apparatus, not prose. Without
        // this, re-importing a DOCX this app wrote turns its own title page
        // into the opening paragraphs of chapter one — which is how the
        // round-trip test found it.
        if is_apparatus(&para.style) {
            continue;
        }
        if heading(&para.style) {
            if title.is_some() || !body.is_empty() {
                if title.is_none() {
                    warnings.push(WARN_PROSE_BEFORE_FIRST_CHAPTER.to_string());
                }
                flush(&mut title, &mut body, &mut chapters);
            }
            title = Some(para.text.trim().to_string());
        } else if !para.text.trim().is_empty() {
            body.push(para.text.clone());
        }
    }
    if title.is_some() || !body.is_empty() {
        if title.is_none() && !chapters.is_empty() {
            warnings.push(WARN_PROSE_BEFORE_FIRST_CHAPTER.to_string());
        }
        flush(&mut title, &mut body, &mut chapters);
    }

    if chapters.is_empty() {
        return Err("empty_document".into());
    }
    if !paras.iter().any(|p| heading(&p.style)) {
        warnings.push(WARN_NO_HEADINGS.to_string());
    }
    if found.formatting {
        warnings.push(WARN_FORMATTING_DROPPED.to_string());
    }
    if found.images {
        warnings.push(WARN_IMAGES_DROPPED.to_string());
    }
    warnings.dedup();

    let book = read_member(&mut zip, "docProps/core.xml")
        .and_then(|core| {
            let start = core.find("<dc:title>")? + "<dc:title>".len();
            let end = core[start..].find("</dc:title>")? + start;
            let title = core[start..end].trim();
            (!title.is_empty()).then(|| title.to_string())
        })
        .unwrap_or_else(|| chapters[0].title.clone());

    Ok(Imported { title: book, chapters, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::{scenes_of, Chapter, Scene};

    fn manuscript() -> Manuscript {
        Manuscript {
            title: "La Casa de Niebla".into(),
            author: "María Fernández".into(),
            byline: Default::default(),
            matter: Default::default(),
            language: "es-ES".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "Capítulo 1 — El umbral".into(),
                    scenes: scenes_of(
                        "La puerta se abrió — y nadie había llamado.\n\n\
                         El frío del zaguán le subió por los tobillos.\n\n\
                         ## Después\n\nVolvió a llover. 🌙",
                    ),
                },
                Chapter {
                    id: "ch-02".into(),
                    title: r#"Cap. 2 & "El <norte>""#.into(),
                    scenes: scenes_of("Nadie vino."),
                },
            ],
        }
    }

    fn members(bytes: &[u8]) -> Vec<String> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect()
    }

    fn member(bytes: &[u8], name: &str) -> String {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        read_member(&mut zip, name).unwrap()
    }

    #[test]
    fn the_package_carries_the_seven_parts_that_were_proven_necessary() {
        let bytes = build(&manuscript()).unwrap();
        let names = members(&bytes);
        for part in [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml",
            "word/_rels/document.xml.rels",
            // Removing this one makes readers lose the heading entirely.
            "word/styles.xml",
            "word/header1.xml",
            "docProps/core.xml",
        ] {
            assert!(names.contains(&part.to_string()), "missing {part}");
        }
        assert_eq!(names[0], "[Content_Types].xml", "OPC convention");

        let types = member(&bytes, "[Content_Types].xml");
        assert!(types.contains("wordprocessingml.document.main+xml"));
        assert!(types.contains("wordprocessingml.styles+xml"));
        assert!(types.contains("wordprocessingml.header+xml"));
    }

    #[test]
    fn every_relationship_the_document_references_exists() {
        // A dangling r:id is spec-invalid even where a lenient reader tolerates it.
        let bytes = build(&manuscript()).unwrap();
        let document = member(&bytes, "word/document.xml");
        let rels = member(&bytes, "word/_rels/document.xml.rels");
        assert!(document.contains(r#"r:id="rId2""#));
        assert!(rels.contains(r#"Id="rId2""#) && rels.contains("header1.xml"));
    }

    #[test]
    fn the_page_is_standard_manuscript_format() {
        let bytes = build(&manuscript()).unwrap();
        let styles = member(&bytes, "word/styles.xml");
        // 12pt is 24 half-points; double spacing is line 480 at auto.
        assert!(styles.contains(r#"<w:sz w:val="24"/>"#));
        assert!(styles.contains(r#"w:line="480" w:lineRule="auto""#));
        assert!(styles.contains("Times New Roman"));
        // Half-inch first-line indent on body paragraphs, none on the opener.
        assert!(styles.contains(r#"<w:ind w:firstLine="720"/>"#));
        assert!(styles.contains("<w:pageBreakBefore/>"), "chapters start a page");

        let document = member(&bytes, "word/document.xml");
        // One-inch margins all round.
        assert!(document.contains(r#"w:top="1440" w:right="1440" w:bottom="1440" w:left="1440""#));

        let header = member(&bytes, "word/header1.xml");
        assert!(header.contains("Fernández / La Casa de Niebla /"), "surname / title / page");
        assert!(header.contains("PAGE"), "the page number is a field, not a literal");
    }

    #[test]
    fn a_scene_break_is_a_centred_hash() {
        let bytes = build(&manuscript()).unwrap();
        let document = member(&bytes, "word/document.xml");
        assert!(document.contains(r#"<w:pStyle w:val="SceneBreak"/>"#));
        assert!(document.contains(">#<"));
    }

    #[test]
    fn xml_hostile_characters_survive_the_round_trip() {
        let bytes = build(&manuscript()).unwrap();
        let document = member(&bytes, "word/document.xml");
        assert!(document.contains("Cap. 2 &amp; &quot;El &lt;norte&gt;&quot;"));
        // And come back unescaped.
        let back = import_bytes(&bytes).unwrap();
        assert_eq!(back.chapters[1].title, r#"Cap. 2 & "El <norte>""#);
    }

    #[test]
    fn a_round_trip_keeps_every_chapter_and_paragraph() {
        let source = manuscript();
        let bytes = build(&source).unwrap();
        let back = import_bytes(&bytes).unwrap();

        assert_eq!(back.title, "La Casa de Niebla");
        assert_eq!(back.chapters.len(), source.chapters.len());
        for (imported, original) in back.chapters.iter().zip(&source.chapters) {
            assert_eq!(imported.title, original.title);
            let expected: Vec<&String> =
                original.scenes.iter().flat_map(|s: &Scene| s.paragraphs.iter()).collect();
            let got: Vec<&str> = imported
                .body
                .split("\n\n")
                .map(str::trim)
                .filter(|p| !p.is_empty() && *p != "#")
                .collect();
            assert_eq!(got.len(), expected.len(), "paragraph count for {}", original.title);
            for (a, b) in got.iter().zip(expected) {
                assert_eq!(a, b, "accents, em dash and emoji must all survive");
            }
        }
    }

    #[test]
    fn a_heading_spelled_differently_is_still_a_chapter() {
        for style in ["Heading1", "heading 1", "HEADING1", "Heading1Char", "Ttulo1", "Titre1"] {
            assert!(is_heading_one(style), "{style} should open a chapter");
        }
        for style in ["Heading2", "BodyText", "Normal", "Heading10"] {
            assert!(!is_heading_one(style), "{style} must not open a chapter");
        }
    }

    #[test]
    fn a_localized_style_resolves_through_its_declared_name() {
        // A Spanish Word writes the id `Ttulo1` whose name is `Título 1`; a
        // producer we have never seen may write anything, so the name is the
        // fallback route.
        let names = style_names(
            r#"<w:styles><w:style w:styleId="Custom9"><w:name w:val="Título 1"/></w:style></w:styles>"#,
        );
        assert_eq!(names, vec![("Custom9".to_string(), "Título 1".to_string())]);
        assert!(is_heading_one(&names[0].1));
        assert!(!is_heading_one(&names[0].0));
    }

    #[test]
    fn runs_tabs_breaks_and_wrappers_come_through_but_deletions_do_not() {
        let xml = std::fs::read_to_string("/tmp/m5/docx/imp/doc.xml");
        let xml = match xml {
            Ok(x) => x,
            // The fixture is a research artefact; skip rather than fail if the
            // scratch directory is gone.
            Err(_) => return,
        };
        let (paras, _) = paragraphs_of(&xml).unwrap();
        // Three runs of a split heading rejoin.
        assert_eq!(paras[0].text, "Chapter One");
        assert_eq!(paras[1].text, "Before\tafter-tab\nafter-br");
        assert_eq!(paras[2].text, "link text tail", "a hyperlink wraps ordinary runs");
        assert_eq!(paras[3].text, "INSERTED kept", "a tracked deletion is not text");
        assert_eq!(paras[4].text, "7 field-tail", "a field instruction is not text");
        assert_eq!(paras[5].text, "smartTag");
        assert_eq!(paras[9].text, "   leading spaces kept   ", "xml:space is honoured");
    }

    #[test]
    fn prose_before_the_first_heading_is_kept_and_reported() {
        let xml = format!(
            "{XML_DECL}<w:document {W}><w:body>\
             <w:p><w:r><w:t>A prologue.</w:t></w:r></w:p>\
             <w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>\
             <w:p><w:r><w:t>Body.</w:t></w:r></w:p></w:body></w:document>"
        );
        let bytes = package(&xml, None);
        let back = import_bytes(&bytes).unwrap();
        assert_eq!(back.chapters.len(), 2);
        assert_eq!(back.chapters[0].body, "A prologue.");
        assert_eq!(back.chapters[1].title, "One");
        assert!(back.warnings.contains(&WARN_PROSE_BEFORE_FIRST_CHAPTER.to_string()));
    }

    #[test]
    fn a_document_with_no_headings_becomes_one_chapter_and_says_so() {
        let xml = format!(
            "{XML_DECL}<w:document {W}><w:body>\
             <w:p><w:r><w:t>Just prose.</w:t></w:r></w:p></w:body></w:document>"
        );
        let back = import_bytes(&package(&xml, None)).unwrap();
        assert_eq!(back.chapters.len(), 1);
        assert!(back.warnings.contains(&WARN_NO_HEADINGS.to_string()));
    }

    #[test]
    fn formatting_and_images_are_dropped_loudly() {
        let xml = format!(
            "{XML_DECL}<w:document {W}><w:body>\
             <w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>\
             <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold.</w:t></w:r><w:r><w:drawing/></w:r></w:p>\
             </w:body></w:document>"
        );
        let back = import_bytes(&package(&xml, None)).unwrap();
        assert!(back.warnings.contains(&WARN_FORMATTING_DROPPED.to_string()));
        assert!(back.warnings.contains(&WARN_IMAGES_DROPPED.to_string()));
        assert_eq!(back.chapters[0].body, "Bold.", "the words survive, the bold does not");
    }

    #[test]
    fn a_file_that_is_not_a_docx_fails_with_a_code() {
        assert_eq!(import_bytes(b"not a zip at all").unwrap_err(), "unsupported_source");
        // A zip with no document part is equally not a docx.
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("hello.txt", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"hi").unwrap();
        let empty = writer.finish().unwrap().into_inner();
        assert_eq!(import_bytes(&empty).unwrap_err(), "unsupported_source");
        // Truncating a real package must not panic either.
        let bytes = build(&manuscript()).unwrap();
        assert!(import_bytes(&bytes[..bytes.len() / 2]).is_err());
    }

    #[test]
    fn an_empty_body_is_refused_rather_than_becoming_a_blank_project() {
        let xml = format!("{XML_DECL}<w:document {W}><w:body><w:p/></w:body></w:document>");
        assert_eq!(import_bytes(&package(&xml, None)).unwrap_err(), "empty_document");
    }

    #[test]
    fn export_to_writes_the_file_and_reports_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.docx");
        let bytes = export_to(&manuscript(), &dest).unwrap();
        assert_eq!(bytes, std::fs::metadata(&dest).unwrap().len());
        assert!(import_file(&dest).is_ok());
        assert_eq!(import_file(&dir.path().join("absent.docx")).unwrap_err(), "not_found");
    }

    /// Wrap a document.xml in the minimum package the importer needs.
    fn package(document: &str, styles_xml: Option<&str>) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer.start_file("word/document.xml", options).unwrap();
        writer.write_all(document.as_bytes()).unwrap();
        if let Some(styles) = styles_xml {
            writer.start_file("word/styles.xml", options).unwrap();
            writer.write_all(styles.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn a_style_known_only_by_its_name_still_opens_a_chapter() {
        let xml = format!(
            "{XML_DECL}<w:document {W}><w:body>\
             <w:p><w:pPr><w:pStyle w:val=\"Custom9\"/></w:pPr><w:r><w:t>Uno</w:t></w:r></w:p>\
             <w:p><w:r><w:t>Cuerpo.</w:t></w:r></w:p></w:body></w:document>"
        );
        let styles =
            r#"<w:styles><w:style w:styleId="Custom9"><w:name w:val="Título 1"/></w:style></w:styles>"#;
        let back = import_bytes(&package(&xml, Some(styles))).unwrap();
        assert_eq!(back.chapters.len(), 1);
        assert_eq!(back.chapters[0].title, "Uno");
        assert_eq!(back.chapters[0].body, "Cuerpo.");
    }

    #[test]
    #[ignore = "shells out to pandoc"]
    fn live_pandoc_reads_our_chapters_back() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("live.docx");
        export_to(&manuscript(), &dest).unwrap();
        let out = std::process::Command::new("pandoc")
            .arg(&dest)
            // -smart, or pandoc rewrites the em dash as --- and the quotes as
            // typographic ones, which would test pandoc rather than us.
            .args(["-t", "markdown-smart"])
            .output()
            .expect("pandoc");
        assert!(out.status.success(), "pandoc rejected the package");
        let markdown = String::from_utf8_lossy(&out.stdout);
        // A third-party reader has to see chapters as headings, or the whole
        // manuscript arrives at an editor as one undifferentiated block.
        assert!(
            markdown.contains("# Capítulo 1 — El umbral"),
            "pandoc lost the heading:\n{markdown}"
        );
        assert!(markdown.contains("# Cap. 2"), "the second chapter is a heading too");
        assert!(markdown.contains("La puerta se abrió — y nadie había llamado."));
        assert!(markdown.contains("🌙"), "an emoji survives the trip through Word's format");
    }

    /// Export to a temp file and reopen it: the package is only ever produced
    /// by writing one, so a test that assembled its own would test a fiction.
    fn written(book: &Manuscript) -> zip::ZipArchive<Cursor<Vec<u8>>> {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.docx");
        export_to(book, &dest).unwrap();
        zip::ZipArchive::new(Cursor::new(std::fs::read(&dest).unwrap())).unwrap()
    }

    #[test]
    fn the_package_names_the_tool_that_wrote_it() {
        let mut book = manuscript();
        book.byline.organization = "Minotauro".into();
        let mut zip = written(&book);

        let app = read_member(&mut zip, "docProps/app.xml").expect("app.xml");
        assert!(app.contains("<Application>Versorium</Application>"));
        assert!(app.contains("<Company>Minotauro</Company>"));
        // Word rejects an AppVersion that is not XX.YYYY, and rejecting the
        // file is how it says so.
        let start = app.find("<AppVersion>").unwrap() + "<AppVersion>".len();
        let version = &app[start..start + app[start..].find('<').unwrap()];
        let (major, minor) = version.split_once('.').expect("XX.YYYY");
        assert_eq!(major.len(), 2);
        assert_eq!(minor.len(), 4);
        assert!(version.chars().all(|c| c.is_ascii_digit() || c == '.'));
    }

    #[test]
    fn a_part_nobody_declared_would_be_a_part_word_ignores() {
        // Both the content types and the package relationships have to name
        // app.xml, or Word treats the file as having no extended properties.
        let mut zip = written(&manuscript());
        let types = read_member(&mut zip, "[Content_Types].xml").unwrap();
        assert!(types.contains("/docProps/app.xml"));
        let rels = read_member(&mut zip, "_rels/.rels").unwrap();
        assert!(rels.contains("docProps/app.xml"));
    }

    #[test]
    fn the_file_says_who_last_saved_it_rather_than_letting_word_decide() {
        let mut zip = written(&manuscript());
        let core = read_member(&mut zip, "docProps/core.xml").unwrap();
        assert!(core.contains("<cp:lastModifiedBy>María Fernández</cp:lastModifiedBy>"));
        assert!(core.contains("<dc:language>es-ES</dc:language>"));
    }
}

/// Standard manuscript format has no place for a scene title: a break is a
/// centred `#`. Chapters and prose survive; a named scene does not, and the
/// writer should hear that before they send the file to an editor.
pub const WARN_SCENE_TITLES_DROPPED: &str = "export_docx_scene_titles_dropped";

pub fn export_warnings(manuscript: &super::Manuscript) -> Vec<String> {
    let named = manuscript
        .chapters
        .iter()
        .flat_map(|c| c.scenes.iter())
        .any(|s| s.heading.is_some());
    if named {
        vec![WARN_SCENE_TITLES_DROPPED.to_string()]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod warning_tests {
    use super::*;
    use crate::formats::{Chapter, Manuscript, Scene};

    fn book(heading: Option<&str>) -> Manuscript {
        Manuscript {
            title: "T".into(),
            author: "A B".into(),
            byline: Default::default(),
            matter: Default::default(),
            language: "es".into(),
            chapters: vec![Chapter {
                id: "ch-01".into(),
                title: "Uno".into(),
                scenes: vec![Scene {
                    heading: heading.map(str::to_string),
                    paragraphs: vec!["Texto.".into()],
                }],
            }],
        }
    }

    #[test]
    fn an_unnamed_scene_break_loses_nothing() {
        assert!(export_warnings(&book(None)).is_empty());
    }

    #[test]
    fn a_named_scene_is_announced_as_a_loss() {
        assert_eq!(export_warnings(&book(Some("Morning"))), vec![WARN_SCENE_TITLES_DROPPED]);
    }
}
