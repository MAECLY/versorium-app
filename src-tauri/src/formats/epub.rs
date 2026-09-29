//! EPUB 3 export.
//!
//! Hand-built rather than crate-generated, because the format's hard parts are
//! packaging rules a crate would hide: the `mimetype` entry must be the FIRST
//! member and STORED uncompressed, and epubcheck rejects the file otherwise.
//! Spec §9 makes passing epubcheck the acceptance bar, so the structure here
//! mirrors a package that was validated against epubcheck 5.2.1.

use super::{Chapter, Imported, ImportedChapter, Manuscript, Scene};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Escape for XML text and attribute values. Prose is full of `&` and quotes,
/// and one unescaped ampersand makes the whole document unparseable.
fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// `YYYY-MM-DDTHH:MM:SSZ` — epubcheck rejects fractional seconds and any
/// offset other than `Z`.
fn utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_secs(secs);
    let day = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        day / 3600,
        (day % 3600) / 60,
        day % 60
    )
}

/// Days-to-civil, the same algorithm the ops log uses for its pack names.
pub fn civil_from_secs(secs: i64) -> (i64, u32, u32) {
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A stable identifier derived from the book itself, so exporting the same
/// manuscript twice does not invent a new "edition" each time. Shaped as a
/// name-based UUID (version 5, RFC 4122 variant).
fn stable_uuid(manuscript: &Manuscript) -> String {
    let mut hash = Sha256::new();
    hash.update(manuscript.title.as_bytes());
    hash.update([0]);
    hash.update(manuscript.author.as_bytes());
    let digest = hash.finalize();
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn chapter_href(index: usize) -> String {
    format!("ch-{:02}.xhtml", index + 1)
}

/// A scene with a heading becomes an `<h2>`; one without is a break, rendered
/// as the centred `#` the DOCX and PDF exports also use, so the same manuscript
/// reads the same way in all three.
fn scene_html(scene: &Scene, first: bool) -> String {
    let mut out = String::new();
    match &scene.heading {
        Some(heading) => out.push_str(&format!("      <h2>{}</h2>\n", esc(heading))),
        None if !first => out.push_str("      <p class=\"scene-break\">#</p>\n"),
        None => {}
    }
    for (i, paragraph) in scene.paragraphs.iter().enumerate() {
        let class = if i == 0 { " class=\"first\"" } else { "" };
        out.push_str(&format!("      <p{}>{}</p>\n", class, esc(paragraph)));
    }
    out
}

fn chapter_xhtml(chapter: &Chapter, language: &str) -> String {
    let body: String = chapter
        .scenes
        .iter()
        .enumerate()
        .map(|(i, scene)| scene_html(scene, i == 0))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">
  <head>
    <meta charset="utf-8"/>
    <title>{title}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <section epub:type="chapter" role="doc-chapter">
      <h1>{title}</h1>
{body}    </section>
  </body>
</html>
"#,
        lang = esc(language),
        title = esc(&chapter.title),
        body = body
    )
}

fn nav_xhtml(chapters: &[(usize, &Chapter)], language: &str) -> String {
    let items: String = chapters
        .iter()
        .map(|(index, chapter)| {
            format!(
                "        <li><a href=\"{}\">{}</a></li>\n",
                chapter_href(*index),
                esc(&chapter.title)
            )
        })
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">
  <head>
    <meta charset="utf-8"/>
    <title>{toc}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>{toc}</h1>
      <ol>
{items}      </ol>
    </nav>
  </body>
</html>
"#,
        lang = esc(language),
        toc = "Contents",
        items = items
    )
}

/// An element only when there is something to put in it.
///
/// An empty `<dc:publisher/>` is worse than none: a reader shows a blank
/// publisher rather than falling back to nothing.
fn optional_element(name: &str, value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return String::new();
    }
    format!("    <{name}>{}</{name}>\n", esc(value))
}

fn package_opf(manuscript: &Manuscript, chapters: &[(usize, &Chapter)], modified: &str) -> String {
    let manifest: String = chapters
        .iter()
        .map(|(index, _)| {
            format!(
                "    <item id=\"ch{n}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>\n",
                n = index + 1,
                href = chapter_href(*index)
            )
        })
        .collect();
    let spine: String = chapters
        .iter()
        .map(|(index, _)| format!("    <itemref idref=\"ch{}\"/>\n", index + 1))
        .collect();
    // `file-as` and `role` are refinements of `dc:creator`, so they are only
    // legal when there is a creator to refine: epubcheck rejects a `refines=`
    // pointing at nothing.
    let creator = if manuscript.author.trim().is_empty() {
        String::new()
    } else {
        let byline = &manuscript.byline;
        let mut out = format!(
            "    <dc:creator id=\"creator\">{}</dc:creator>\n",
            esc(&manuscript.author)
        );
        out.push_str(&format!(
            "    <meta refines=\"#creator\" property=\"file-as\">{}</meta>\n",
            esc(&byline.sort_as_or_guess(&manuscript.author))
        ));
        if crate::formats::ROLES.contains(&byline.role.as_str()) {
            out.push_str(&format!(
                "    <meta refines=\"#creator\" property=\"role\" scheme=\"marc:relators\">{}</meta>\n",
                esc(&byline.role)
            ));
        }
        out
    };
    let publisher = optional_element("dc:publisher", &manuscript.byline.organization);
    let rights = optional_element("dc:rights", &manuscript.byline.rights);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="{lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">{id}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>{lang}</dc:language>
{creator}{publisher}{rights}    <meta property="dcterms:modified">{modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
{manifest}  </manifest>
  <spine>
{spine}  </spine>
</package>
"#,
        lang = esc(&manuscript.language),
        id = stable_uuid(manuscript),
        title = esc(&manuscript.title),
        creator = creator,
        publisher = publisher,
        rights = rights,
        modified = modified,
        manifest = manifest,
        spine = spine
    )
}

const CONTAINER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"#;

const STYLE: &str = r#"body { margin: 0 5%; line-height: 1.4; }
h1 { text-align: center; margin: 2em 0 1em; }
h2 { text-align: center; font-size: 1em; font-weight: normal; margin: 1.5em 0 0.5em; }
p { text-indent: 1.5em; margin: 0; }
p.first { text-indent: 0; }
p.scene-break { text-align: center; text-indent: 0; margin: 1em 0; }
"#;

pub fn export_to(manuscript: &Manuscript, dest: &Path) -> Result<u64, String> {
    // A chapter with nothing in it would be a spine item pointing at a page
    // with no content; skip it rather than ship a dead entry.
    let chapters: Vec<(usize, &Chapter)> = manuscript
        .chapters
        .iter()
        .enumerate()
        .filter(|(_, chapter)| !chapter.scenes.is_empty())
        .collect();
    if chapters.is_empty() {
        return Err("empty_manuscript".into());
    }

    let mut buffer = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        // First and uncompressed, so the magic bytes sit at a fixed offset.
        zip.start_file("mimetype", stored).map_err(|_| "io".to_string())?;
        zip.write_all(b"application/epub+zip").map_err(|_| "io".to_string())?;

        let modified = utc_now();
        let mut put = |name: &str, body: &str| -> Result<(), String> {
            zip.start_file(name, deflated).map_err(|_| "io".to_string())?;
            zip.write_all(body.as_bytes()).map_err(|_| "io".to_string())
        };
        put("META-INF/container.xml", CONTAINER)?;
        put("OEBPS/package.opf", &package_opf(manuscript, &chapters, &modified))?;
        put("OEBPS/nav.xhtml", &nav_xhtml(&chapters, &manuscript.language))?;
        put("OEBPS/style.css", STYLE)?;
        for (index, chapter) in &chapters {
            put(
                &format!("OEBPS/{}", chapter_href(*index)),
                &chapter_xhtml(chapter, &manuscript.language),
            )?;
        }
        zip.finish().map_err(|_| "io".to_string())?;
    }
    let bytes = buffer.len() as u64;
    crate::storage::atomic_write(dest, buffer)?;
    Ok(bytes)
}

// --- import ---

/// Text an EPUB carries that a Versorium project does not.
pub const WARN_IMAGES: &str = "import_images_dropped";
pub const WARN_STYLES: &str = "import_epub_styles_dropped";

pub fn import_file(path: &Path) -> Result<Imported, String> {
    let bytes = std::fs::read(path).map_err(|_| "not_found".to_string())?;
    import_bytes(&bytes)
}

/// Read an EPUB into chapters.
///
/// The **spine** decides order, not the file names inside the zip and not the
/// table of contents: the spine is the reading order the publisher declared, and
/// alphabetical filenames put chapter 10 before chapter 2.
pub fn import_bytes(bytes: &[u8]) -> Result<Imported, String> {
    use std::io::{Cursor, Read};
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec()))
        .map_err(|_| "unsupported_source".to_string())?;

    let read = |zip: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str| -> Option<String> {
        let mut file = zip.by_name(name).ok()?;
        let mut text = String::new();
        file.read_to_string(&mut text).ok()?;
        Some(text)
    };

    // The only file whose path an EPUB guarantees; everything else is found
    // through it.
    let container = read(&mut zip, "META-INF/container.xml")
        .ok_or_else(|| "unsupported_source".to_string())?;
    let opf_path = attr_of(&container, "rootfile", "full-path")
        .ok_or_else(|| "unsupported_source".to_string())?;
    let opf = read(&mut zip, &opf_path).ok_or_else(|| "unsupported_source".to_string())?;

    // Hrefs in the OPF are relative to the OPF's own directory, not to the zip
    // root. Getting this wrong is why some readers fail on nested layouts.
    let base = opf_path.rsplit_once('/').map(|(dir, _)| format!("{dir}/")).unwrap_or_default();

    let title = opf_text(&opf, "dc:title")
        .or_else(|| opf_text(&opf, "title"))
        .unwrap_or_default();
    let manifest = manifest_of(&opf);
    let spine = spine_of(&opf);

    let mut chapters: Vec<ImportedChapter> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    if manifest.values().any(|href| is_image(href)) {
        warnings.push(WARN_IMAGES.to_string());
    }
    if manifest.values().any(|href| href.ends_with(".css")) {
        warnings.push(WARN_STYLES.to_string());
    }

    for id in &spine {
        let Some(href) = manifest.get(id) else { continue };
        // A nav document is the table of contents, not a chapter.
        if href.contains("nav") && spine.len() > 1 && chapters.is_empty() && spine.first() == Some(id) {
            if let Some(html) = read(&mut zip, &format!("{base}{href}")) {
                if html.contains("epub:type=\"toc\"") || html.contains("epub:type='toc'") {
                    continue;
                }
            }
        }
        let Some(html) = read(&mut zip, &format!("{base}{href}")) else { continue };
        let (heading, body) = html_to_chapter(&html);
        if body.trim().is_empty() {
            continue;
        }
        let number = chapters.len() + 1;
        chapters.push(ImportedChapter {
            title: heading.unwrap_or_else(|| format!("{number}")),
            body,
            // EPUB has no synopsis field; the corkboard derives its own.
            synopsis: None,
        });
    }

    if chapters.is_empty() {
        return Err("empty_manuscript".into());
    }
    Ok(Imported { title, chapters, warnings })
}

fn is_image(href: &str) -> bool {
    let lower = href.to_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].iter().any(|e| lower.ends_with(e))
}

/// One attribute of the first element with this name. Hand-rolled because the
/// only shapes needed are `<rootfile full-path="...">` and the manifest.
fn attr_of(xml: &str, element: &str, name: &str) -> Option<String> {
    let needle = format!("<{element}");
    let start = find_element(xml, &needle)?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    let key = format!("{name}=");
    let at = tag.find(&key)? + key.len();
    let quote = tag[at..].chars().next()?;
    let value = &tag[at + 1..];
    let close = value.find(quote)?;
    Some(unescape(&value[..close]))
}

/// The offset of `<name`, where the next character actually ends the name.
///
/// Without this, `<rootfiles>` matches a search for `<rootfile` — and since
/// every EPUB wraps the singular in the plural, that is the first hit in every
/// real book.
fn find_element(xml: &str, needle: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(at) = xml[from..].find(needle) {
        let start = from + at;
        let after = xml[start + needle.len()..].chars().next();
        if matches!(after, Some(c) if c.is_whitespace() || c == '>' || c == '/') {
            return Some(start);
        }
        from = start + needle.len();
    }
    None
}

fn opf_text(xml: &str, element: &str) -> Option<String> {
    let open = format!("<{element}");
    let start = xml.find(&open)?;
    let rest = &xml[start..];
    let content_start = rest.find('>')? + 1;
    let close = format!("</{element}>");
    let content_end = rest.find(&close)?;
    if content_end < content_start {
        return None;
    }
    let text = unescape(rest[content_start..content_end].trim());
    (!text.is_empty()).then_some(text)
}

/// `id` to `href` for every manifest item.
fn manifest_of(opf: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for chunk in opf.split("<item ").skip(1) {
        let Some(end) = chunk.find('>') else { continue };
        let tag = &chunk[..end];
        if let (Some(id), Some(href)) = (tag_attr(tag, "id"), tag_attr(tag, "href")) {
            out.insert(id, href);
        }
    }
    out
}

/// Spine idrefs, in order. This is the reading order.
fn spine_of(opf: &str) -> Vec<String> {
    let Some(start) = opf.find("<spine") else { return Vec::new() };
    let section = &opf[start..];
    let end = section.find("</spine>").unwrap_or(section.len());
    section[..end]
        .split("<itemref")
        .skip(1)
        .filter_map(|chunk| {
            let stop = chunk.find('>')?;
            tag_attr(&chunk[..stop], "idref")
        })
        .collect()
}

fn tag_attr(tag: &str, name: &str) -> Option<String> {
    for key in [format!("{name}=\""), format!("{name}='")] {
        if let Some(at) = tag.find(&key) {
            let value = &tag[at + key.len()..];
            let quote = key.chars().next_back()?;
            if let Some(close) = value.find(quote) {
                return Some(unescape(&value[..close]));
            }
        }
    }
    None
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        // Last, or an escaped entity like `&amp;lt;` would be double-decoded.
        .replace("&amp;", "&")
}

/// Turn one XHTML document into a heading and a Markdown body.
///
/// Block-level tags become paragraph breaks and everything else is dropped,
/// which is the same contract the DOCX reader offers: the prose survives, the
/// presentation does not.
fn html_to_chapter(html: &str) -> (Option<String>, String) {
    let body = html
        .find("<body")
        .and_then(|start| html[start..].find('>').map(|o| start + o + 1))
        .map(|start| {
            let rest = &html[start..];
            let end = rest.find("</body>").unwrap_or(rest.len());
            &rest[..end]
        })
        .unwrap_or(html);

    let mut heading: Option<String> = None;
    let mut blocks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    // Script and style hold text that is not prose.
    let mut skipping = false;

    let flush = |current: &mut String, blocks: &mut Vec<String>| {
        let text = collapse(current);
        if !text.is_empty() {
            blocks.push(text);
        }
        current.clear();
    };

    for c in body.chars() {
        if c == '<' {
            in_tag = true;
            tag.clear();
            continue;
        }
        if c == '>' {
            in_tag = false;
            let lower = tag.to_lowercase();
            let name = lower.trim_start_matches('/').split([' ', '\t', '\n', '/']).next().unwrap_or("");
            if matches!(name, "script" | "style") {
                skipping = !lower.starts_with('/');
            }
            // `br` inside a paragraph is a line break, not a new paragraph, and
            // every format here re-wraps anyway.
            if matches!(name, "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "blockquote" | "section") {
                if name.starts_with('h') && heading.is_none() && lower.starts_with('/') {
                    let text = collapse(&current);
                    if !text.is_empty() {
                        heading = Some(text);
                        current.clear();
                        continue;
                    }
                }
                flush(&mut current, &mut blocks);
            }
            continue;
        }
        if in_tag {
            tag.push(c);
        } else if !skipping {
            current.push(c);
        }
    }
    flush(&mut current, &mut blocks);

    (heading, blocks.join("\n\n"))
}

/// Fold whitespace and resolve entities, which is what turns XHTML text into a
/// paragraph.
fn collapse(text: &str) -> String {
    let decoded = unescape(&text.replace("&#160;", " ").replace("&nbsp;", " "));
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod import_tests {
    use super::*;

    // Read back through this file's own writer, which is the strongest check
    // available without a reader installed: the writer was itself validated
    // against epubcheck (see the `live_` test below).

    fn sample() -> Manuscript {
        Manuscript {
            title: "El largo invierno".into(),
            author: "Ana Ruiz".into(),
            byline: Default::default(),
            language: "es".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "La llegada".into(),
                    scenes: vec![Scene {
                        heading: None,
                        paragraphs: vec![
                            "La niña esperó junto a la ventana.".into(),
                            "Nadie vino.".into(),
                        ],
                    }],
                },
                Chapter {
                    id: "ch-02".into(),
                    title: "El faro & la niebla".into(),
                    scenes: vec![Scene {
                        heading: None,
                        paragraphs: vec!["La luz giraba sobre el agua.".into()],
                    }],
                },
            ],
        }
    }

    fn written(manuscript: &Manuscript) -> Vec<u8> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        export_to(manuscript, &path).unwrap();
        std::fs::read(&path).unwrap()
    }

    #[test]
    fn an_epub_this_app_wrote_reads_back_with_its_chapters_in_order() {
        let imported = import_bytes(&written(&sample())).unwrap();
        assert_eq!(imported.title, "El largo invierno");
        let titles: Vec<&str> = imported.chapters.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["La llegada", "El faro & la niebla"]);
        // Accents and an escaped ampersand both survive.
        assert!(imported.chapters[0].body.contains("La niña esperó"), "{}", imported.chapters[0].body);
        assert!(imported.chapters[1].body.contains("La luz giraba"));
    }

    #[test]
    fn paragraphs_stay_separate_rather_than_running_together() {
        let imported = import_bytes(&written(&sample())).unwrap();
        // Two paragraphs, blank line between: that is what makes them paragraphs
        // again on the way back in.
        assert_eq!(
            imported.chapters[0].body,
            "La niña esperó junto a la ventana.\n\nNadie vino."
        );
    }

    #[test]
    fn the_table_of_contents_is_not_imported_as_a_chapter() {
        // The nav document is in the spine and is not prose; importing it would
        // give every book a first chapter listing its own chapters.
        let imported = import_bytes(&written(&sample())).unwrap();
        assert_eq!(imported.chapters.len(), 2, "{:?}", imported.chapters.iter().map(|c| &c.title).collect::<Vec<_>>());
        assert!(!imported.chapters.iter().any(|c| c.body.contains("La llegada") && c.body.contains("El faro")));
    }

    #[test]
    fn the_spine_decides_order_not_the_file_names() {
        // Alphabetical hrefs would put chapter 10 before chapter 2, which is why
        // the spine is what is walked.
        let opf = r#"<package><manifest>
            <item id="c10" href="ch-10.xhtml" media-type="application/xhtml+xml"/>
            <item id="c2" href="ch-02.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine><itemref idref="c2"/><itemref idref="c10"/></spine></package>"#;
        assert_eq!(spine_of(opf), vec!["c2", "c10"]);
        let manifest = manifest_of(opf);
        assert_eq!(manifest.get("c2").map(String::as_str), Some("ch-02.xhtml"));
    }

    #[test]
    fn hrefs_resolve_against_the_opf_directory_not_the_zip_root() {
        // A nested layout (OEBPS/content.opf with hrefs like "text/ch-01.xhtml")
        // is common and is where a naive reader fails.
        let container = r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"
            media-type="application/oebps-package+xml"/></rootfiles></container>"#;
        let opf_path = attr_of(container, "rootfile", "full-path").unwrap();
        assert_eq!(opf_path, "OEBPS/content.opf");
        let base = opf_path.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
        assert_eq!(base, "OEBPS/");
    }

    #[test]
    fn something_that_is_not_an_epub_is_refused_rather_than_guessed_at() {
        assert_eq!(import_bytes(b"not a zip").unwrap_err(), "unsupported_source");
        // A zip with no container.xml is not an EPUB either.
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buffer);
            zip.start_file("hello.txt", zip::write::SimpleFileOptions::default()).unwrap();
            use std::io::Write;
            zip.write_all(b"hi").unwrap();
            zip.finish().unwrap();
        }
        assert_eq!(import_bytes(&buffer.into_inner()).unwrap_err(), "unsupported_source");
    }

    #[test]
    fn entities_decode_once_and_in_the_right_order() {
        // `&amp;lt;` must come back as the text "&lt;", not as "<": decoding
        // `&amp;` first would double-decode it.
        assert_eq!(unescape("a &amp;lt; b"), "a &lt; b");
        assert_eq!(unescape("&lt;p&gt; &amp; &quot;q&quot;"), "<p> & \"q\"");
    }

    #[test]
    fn markup_and_scripts_do_not_become_prose() {
        let html = r#"<html><body><h1>Título</h1>
            <style>p { color: red; }</style>
            <script>var x = 1;</script>
            <p>Primer <em>párrafo</em>.</p><p>Segundo.</p></body></html>"#;
        let (heading, body) = html_to_chapter(html);
        assert_eq!(heading.as_deref(), Some("Título"));
        assert_eq!(body, "Primer párrafo.\n\nSegundo.");
        assert!(!body.contains("color"), "a stylesheet reached the manuscript");
        assert!(!body.contains("var x"), "a script reached the manuscript");
    }

    #[test]
    fn losses_are_reported_when_the_book_has_them() {
        // A book with a cover and a stylesheet loses both, and says so.
        let opf = r#"<package><metadata><dc:title>T</dc:title></metadata><manifest>
            <item id="cover" href="cover.jpg" media-type="image/jpeg"/>
            <item id="css" href="style.css" media-type="text/css"/>
        </manifest><spine></spine></package>"#;
        let manifest = manifest_of(opf);
        assert!(manifest.values().any(|h| is_image(h)));
        assert!(manifest.values().any(|h| h.ends_with(".css")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scene(heading: Option<&str>, paragraphs: &[&str]) -> Scene {
        Scene {
            heading: heading.map(str::to_string),
            paragraphs: paragraphs.iter().map(|p| p.to_string()).collect(),
        }
    }

    fn book() -> Manuscript {
        Manuscript {
            title: "Niebla & \"Sombra\" <1>".into(),
            author: "María Fernández".into(),
            byline: Default::default(),
            language: "es".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "Cap. 1 & \"El <norte>\"".into(),
                    scenes: vec![
                        scene(None, &["La puerta se abrió — y nadie había llamado."]),
                        scene(None, &["¿Quién anda ahí? «Vení», dijo la voz…"]),
                        scene(Some("Más tarde"), &["El frío del zaguán."]),
                    ],
                },
                Chapter {
                    id: "ch-02".into(),
                    title: "La señal".into(),
                    scenes: vec![scene(None, &["Y el final."])],
                },
            ],
        }
    }

    fn write(manuscript: &Manuscript) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.epub");
        export_to(manuscript, &dest).unwrap();
        (dir, dest)
    }

    fn entries(path: &Path) -> Vec<(String, zip::CompressionMethod)> {
        let file = std::fs::File::open(path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        (0..zip.len())
            .map(|i| {
                let entry = zip.by_index(i).unwrap();
                (entry.name().to_string(), entry.compression())
            })
            .collect()
    }

    fn read_entry(path: &Path, name: &str) -> String {
        let file = std::fs::File::open(path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut entry = zip.by_name(name).unwrap();
        let mut text = String::new();
        entry.read_to_string(&mut text).unwrap();
        text
    }

    #[test]
    fn the_mimetype_is_the_first_entry_and_uncompressed() {
        // epubcheck rejects the file outright if either is wrong.
        let (_dir, path) = write(&book());
        let list = entries(&path);
        assert_eq!(list[0].0, "mimetype");
        assert_eq!(list[0].1, zip::CompressionMethod::Stored);
        assert_eq!(read_entry(&path, "mimetype"), "application/epub+zip");
    }

    #[test]
    fn every_required_member_is_present() {
        let (_dir, path) = write(&book());
        let names: Vec<String> = entries(&path).into_iter().map(|(n, _)| n).collect();
        for required in [
            "mimetype",
            "META-INF/container.xml",
            "OEBPS/package.opf",
            "OEBPS/nav.xhtml",
            "OEBPS/style.css",
            "OEBPS/ch-01.xhtml",
            "OEBPS/ch-02.xhtml",
        ] {
            assert!(names.iter().any(|n| n == required), "missing {required}");
        }
    }

    #[test]
    fn the_package_lists_every_chapter_in_both_manifest_and_spine() {
        let (_dir, path) = write(&book());
        let opf = read_entry(&path, "OEBPS/package.opf");
        for n in 1..=2 {
            assert!(opf.contains(&format!("href=\"ch-{n:02}.xhtml\"")), "manifest missing {n}");
            assert!(opf.contains(&format!("idref=\"ch{n}\"")), "spine missing {n}");
        }
        assert!(opf.contains("properties=\"nav\""));
        assert!(opf.contains("<dc:language>es</dc:language>"));
    }

    #[test]
    fn the_modified_timestamp_has_the_shape_epubcheck_demands() {
        let (_dir, path) = write(&book());
        let opf = read_entry(&path, "OEBPS/package.opf");
        let start = opf.find("dcterms:modified\">").unwrap() + "dcterms:modified\">".len();
        let stamp = &opf[start..start + 20];
        assert_eq!(stamp.len(), 20, "no fractional seconds, no offset");
        assert!(stamp.ends_with('Z'));
        let bytes = stamp.as_bytes();
        assert_eq!(bytes[4], b'-');
        assert_eq!(bytes[10], b'T');
        assert_eq!(bytes[13], b':');
    }

    #[test]
    fn xml_hostile_characters_are_escaped_everywhere_they_appear() {
        let (_dir, path) = write(&book());
        // The book title reaches the OPF; the chapter title reaches the nav
        // and the chapter itself. Both carry characters that would otherwise
        // make the document unparseable.
        let opf = read_entry(&path, "OEBPS/package.opf");
        assert!(opf.contains("Niebla &amp; &quot;Sombra&quot; &lt;1&gt;"));
        assert!(!opf.contains("<1>"), "the OPF left a raw tag");
        for member in ["OEBPS/nav.xhtml", "OEBPS/ch-01.xhtml"] {
            let text = read_entry(&path, member);
            assert!(text.contains("Cap. 1 &amp;"), "{member} did not escape &");
            assert!(!text.contains("<norte>"), "{member} left a raw tag");
            assert!(text.contains("&lt;norte&gt;"), "{member} did not escape the angle brackets");
        }
    }

    #[test]
    fn accented_prose_survives_as_utf8() {
        let (_dir, path) = write(&book());
        let chapter = read_entry(&path, "OEBPS/ch-01.xhtml");
        assert!(chapter.contains("La puerta se abrió — y nadie había llamado."));
        assert!(chapter.contains("«Vení», dijo la voz…"));
    }

    #[test]
    fn a_scene_without_a_heading_is_a_break_and_the_first_one_is_not() {
        let (_dir, path) = write(&book());
        let chapter = read_entry(&path, "OEBPS/ch-01.xhtml");
        // Three scenes: opening, an untitled break, then a titled one.
        assert_eq!(chapter.matches("class=\"scene-break\"").count(), 1);
        assert!(chapter.contains("<h2>Más tarde</h2>"));
    }

    #[test]
    fn an_empty_chapter_never_becomes_a_spine_item() {
        let mut manuscript = book();
        manuscript.chapters.push(Chapter {
            id: "ch-03".into(),
            title: "Nothing here".into(),
            scenes: vec![],
        });
        let (_dir, path) = write(&manuscript);
        let names: Vec<String> = entries(&path).into_iter().map(|(n, _)| n).collect();
        assert!(!names.iter().any(|n| n == "OEBPS/ch-03.xhtml"));
        let opf = read_entry(&path, "OEBPS/package.opf");
        assert!(!opf.contains("idref=\"ch3\""));
    }

    #[test]
    fn a_manuscript_with_nothing_in_it_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let manuscript = Manuscript {
            title: "Empty".into(),
            author: "A".into(),
            byline: Default::default(),
            language: "en".into(),
            chapters: vec![Chapter { id: "ch-01".into(), title: "One".into(), scenes: vec![] }],
        };
        let dest = dir.path().join("empty.epub");
        assert_eq!(export_to(&manuscript, &dest).unwrap_err(), "empty_manuscript");
    }

    #[test]
    fn the_identifier_is_stable_for_the_same_book() {
        let a = stable_uuid(&book());
        let b = stable_uuid(&book());
        assert_eq!(a, b, "the same manuscript must not invent a new identity");
        assert!(a.starts_with("urn:uuid:"));
        assert_eq!(a.len(), "urn:uuid:".len() + 36);
        // Version 5 nibble and the RFC 4122 variant bits.
        assert_eq!(a.as_bytes()["urn:uuid:".len() + 14], b'5');
        assert!(matches!(a.as_bytes()["urn:uuid:".len() + 19], b'8' | b'9' | b'a' | b'b'));

        let mut other = book();
        other.title = "Another".into();
        assert_ne!(stable_uuid(&other), a);
    }

    #[test]
    fn an_emoji_in_the_prose_does_not_break_the_package() {
        // XHTML is UTF-8, so unlike the PDF there is nothing to substitute.
        let mut manuscript = book();
        manuscript.chapters[1].scenes = vec![scene(None, &["Se fue 🌙 y no volvió."])];
        let (_dir, path) = write(&manuscript);
        assert!(read_entry(&path, "OEBPS/ch-02.xhtml").contains("🌙"));
    }

    /// epubcheck is the acceptance bar spec §9 sets. The `java` on PATH is the
    /// macOS stub and fails, so the JDK is named explicitly.
    #[test]
    #[ignore = "needs java and the epubcheck jar"]
    fn live_epubcheck_accepts_the_export() {
        let (_dir, path) = write(&book());
        let out = std::process::Command::new("/opt/homebrew/opt/openjdk/bin/java")
            .args(["-jar", "/tmp/m5/epubcheck-5.2.1/epubcheck.jar"])
            .arg(&path)
            .output()
            .expect("run epubcheck");
        let report = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        eprintln!("{report}");
        assert!(out.status.success(), "epubcheck rejected the file:\n{report}");
        assert!(!report.contains("ERROR"), "epubcheck reported errors:\n{report}");
    }

    #[test]
    fn an_author_profile_reaches_the_package_document() {
        let mut book = book();
        book.byline = crate::formats::Byline {
            sort_as: "Ruiz, Ana".into(),
            role: "aut".into(),
            organization: "Minotauro".into(),
            rights: "© 2026 Ana Ruiz".into(),
        };
        let opf = package_opf(&book, &book.chapters.iter().enumerate().collect::<Vec<_>>(), "2026-01-01T00:00:00Z");

        assert!(opf.contains(r##"<meta refines="#creator" property="file-as">Ruiz, Ana</meta>"##));
        assert!(opf.contains(r##"property="role" scheme="marc:relators">aut<"##));
        assert!(opf.contains("<dc:publisher>Minotauro</dc:publisher>"));
        assert!(opf.contains("<dc:rights>© 2026 Ana Ruiz</dc:rights>"));
    }

    #[test]
    fn nothing_is_written_for_a_profile_nobody_filled_in() {
        // An empty <dc:publisher/> shows as a blank publisher in a reader,
        // which is worse than the reader falling back to nothing.
        let opf = package_opf(&book(), &[], "2026-01-01T00:00:00Z");
        assert!(!opf.contains("<dc:publisher"));
        assert!(!opf.contains("<dc:rights"));
        assert!(!opf.contains("marc:relators"), "an invented role code is worse than none");
        // file-as is still written, from the guess, because a shelf has to sort
        // somehow and "Ruiz, Ana" beats sorting on "Ana".
        assert!(opf.contains(r##"property="file-as""##));
    }

    #[test]
    fn a_refinement_is_never_left_pointing_at_a_creator_that_is_not_there() {
        // epubcheck rejects a refines= with no target, so an anonymous
        // manuscript must write neither the creator nor its refinements.
        let anonymous = Manuscript { author: String::new(), ..book() };
        let opf = package_opf(&anonymous, &[], "2026-01-01T00:00:00Z");
        assert!(!opf.contains("dc:creator"));
        assert!(!opf.contains("refines"));
    }
}
