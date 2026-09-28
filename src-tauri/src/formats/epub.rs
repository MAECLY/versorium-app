//! EPUB 3 export.
//!
//! Hand-built rather than crate-generated, because the format's hard parts are
//! packaging rules a crate would hide: the `mimetype` entry must be the FIRST
//! member and STORED uncompressed, and epubcheck rejects the file otherwise.
//! Spec §9 makes passing epubcheck the acceptance bar, so the structure here
//! mirrors a package that was validated against epubcheck 5.2.1.

use super::{Chapter, Manuscript, Scene};
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
fn civil_from_secs(secs: i64) -> (i64, u32, u32) {
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
    let creator = if manuscript.author.trim().is_empty() {
        String::new()
    } else {
        format!(
            "    <dc:creator id=\"creator\">{}</dc:creator>\n",
            esc(&manuscript.author)
        )
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="{lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">{id}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>{lang}</dc:language>
{creator}    <meta property="dcterms:modified">{modified}</meta>
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
}
