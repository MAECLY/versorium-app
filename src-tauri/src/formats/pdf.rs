//! PDF export — a print preview of the manuscript (spec §9).
//!
//! Hand-written rather than crate-generated for one reason: using Times-Roman
//! from the base-14 set means **nothing has to be embedded**, so the whole
//! writer is a few hundred lines and the output carries no font licence. The
//! price is WinAnsiEncoding, which covers Latin-1 and the typographic marks a
//! Spanish manuscript needs but nothing beyond it.
//!
//! The xref table is the one place an error is fatal rather than ugly: every
//! offset is taken from the real serialized position, never estimated, because
//! a reader that finds anything but `N 0 obj` there rejects the file.

use super::Manuscript;
use std::path::Path;

/// Times-Roman advance widths, indexed by WinAnsi byte, in 1/1000 em. Taken
/// from Adobe's AFM so wrapping matches what a reader will actually draw.
/// Baked in rather than read at runtime — the app ships no font files.
const WIDTHS: [u16; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
    921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
    556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
    333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
    500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541, 0,
    // 0x80 Euro is newer than the AFM; 500 keeps wrapping sane if it appears.
    500, 0, 333, 500, 444, 1000, 500, 500, 333, 1000, 556, 333, 889, 0, 611, 0,
    0, 333, 333, 444, 444, 350, 500, 1000, 333, 980, 389, 333, 722, 0, 444, 722,
    250, 333, 500, 500, 500, 500, 200, 500, 333, 760, 276, 500, 564, 333, 760, 333,
    400, 564, 300, 300, 333, 500, 453, 250, 333, 300, 310, 500, 750, 750, 750, 444,
    722, 722, 722, 722, 722, 722, 889, 667, 611, 611, 611, 611, 333, 333, 333, 333,
    722, 722, 722, 722, 722, 722, 722, 564, 722, 722, 722, 722, 722, 722, 556, 500,
    444, 444, 444, 444, 444, 444, 667, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 500, 500, 500, 500, 500, 500, 564, 500, 500, 500, 500, 500, 500, 500, 500,
];

/// US Letter with the 1-inch margins and double spacing the manuscript format
/// calls for.
const PAGE_W: f32 = 612.0;
const PAGE_H: f32 = 792.0;
const MARGIN: f32 = 72.0;
const SIZE: f32 = 12.0;
/// Double spacing for 12pt type.
const LEADING: f32 = 24.0;
/// Half an inch, the usual manuscript first-line indent.
const INDENT: f32 = 36.0;
const HEAD_Y: f32 = PAGE_H - 36.0;
/// Chapters open a third of the way down the page, as manuscripts do.
const CHAPTER_DROP: f32 = 144.0;

fn text_top() -> f32 {
    PAGE_H - MARGIN - SIZE
}

/// Map one character onto its WinAnsi byte. `None` means the encoding cannot
/// represent it at all.
fn win_ansi(ch: char) -> Option<u8> {
    match ch {
        // ASCII and Latin-1 are identity in WinAnsi.
        '\u{20}'..='\u{7e}' | '\u{a0}'..='\u{ff}' => Some(ch as u8),
        // The 0x80–0x9F block, which is where WinAnsi differs from Latin-1.
        '\u{20ac}' => Some(0x80),
        '\u{201a}' => Some(0x82),
        '\u{0192}' => Some(0x83),
        '\u{201e}' => Some(0x84),
        '\u{2026}' => Some(0x85),
        '\u{2020}' => Some(0x86),
        '\u{2021}' => Some(0x87),
        '\u{02c6}' => Some(0x88),
        '\u{2030}' => Some(0x89),
        '\u{0160}' => Some(0x8a),
        '\u{2039}' => Some(0x8b),
        '\u{0152}' => Some(0x8c),
        '\u{017d}' => Some(0x8e),
        '\u{2018}' => Some(0x91),
        '\u{2019}' => Some(0x92),
        '\u{201c}' => Some(0x93),
        '\u{201d}' => Some(0x94),
        '\u{2022}' => Some(0x95),
        '\u{2013}' => Some(0x96),
        '\u{2014}' => Some(0x97),
        '\u{02dc}' => Some(0x98),
        '\u{2122}' => Some(0x99),
        '\u{0161}' => Some(0x9a),
        '\u{203a}' => Some(0x9b),
        '\u{0153}' => Some(0x9c),
        '\u{017e}' => Some(0x9e),
        '\u{0178}' => Some(0x9f),
        _ => None,
    }
}

/// Encode a string for the page, substituting what WinAnsi cannot hold.
///
/// A character with a close relative is mapped to it — a prime becomes an
/// apostrophe — so ordinary typography survives. Anything genuinely outside the
/// encoding, an emoji for instance, becomes `?`: a manuscript with one emoji in
/// it must still export, and a broken byte would make the whole file unopenable.
/// Returns the bytes and whether anything was replaced.
fn encode(text: &str) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(text.len());
    let mut lost = false;
    for ch in text.chars() {
        let substitute = match ch {
            '\u{2032}' => Some('\''),
            '\u{2033}' => Some('"'),
            '\u{2212}' => Some('-'),
            '\u{00a0}' => Some(' '),
            '\t' => Some(' '),
            _ => None,
        };
        let ch = substitute.unwrap_or(ch);
        match win_ansi(ch) {
            Some(byte) => out.push(byte),
            None => {
                out.push(b'?');
                lost = true;
            }
        }
    }
    (out, lost)
}

fn width_of(text: &str) -> f32 {
    let (bytes, _) = encode(text);
    bytes.iter().map(|b| WIDTHS[*b as usize] as f32).sum::<f32>() * SIZE / 1000.0
}

/// A PDF literal string. `(`, `)` and `\` must be escaped or the parser loses
/// the string boundary; everything outside printable ASCII goes octal so the
/// file stays 7-bit and survives any transport.
fn pdf_string(text: &str) -> Vec<u8> {
    let (bytes, _) = encode(text);
    let mut out = Vec::with_capacity(bytes.len() + 2);
    out.push(b'(');
    for byte in bytes {
        match byte {
            b'(' | b')' | b'\\' => {
                out.push(b'\\');
                out.push(byte);
            }
            0x20..=0x7e => out.push(byte),
            _ => out.extend_from_slice(format!("\\{byte:03o}").as_bytes()),
        }
    }
    out.push(b')');
    out
}

/// Greedy wrap against real glyph widths. The first line gets less room when
/// the paragraph is indented.
fn wrap(text: &str, first_indent: f32) -> Vec<String> {
    let max = PAGE_W - 2.0 * MARGIN;
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut available = max - first_indent;
    for word in text.split_whitespace() {
        let candidate =
            if current.is_empty() { word.to_string() } else { format!("{current} {word}") };
        if width_of(&candidate) <= available || current.is_empty() {
            current = candidate;
        } else {
            lines.push(std::mem::take(&mut current));
            current = word.to_string();
            available = max;
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

/// One drawn line: where it goes and what it says.
struct Line {
    x: f32,
    y: f32,
    text: String,
}

/// Lay the manuscript out into pages. Each chapter opens a new page, which is
/// what makes this a print preview rather than a text dump.
fn paginate(manuscript: &Manuscript) -> Vec<Vec<Line>> {
    let mut pages: Vec<Vec<Line>> = Vec::new();
    for chapter in &manuscript.chapters {
        if chapter.scenes.is_empty() {
            continue;
        }
        let mut page: Vec<Line> = Vec::new();
        let mut y = text_top() - CHAPTER_DROP;
        page.push(Line {
            x: (PAGE_W - width_of(&chapter.title)) / 2.0,
            y,
            text: chapter.title.clone(),
        });
        y -= LEADING * 2.0;

        for (index, scene) in chapter.scenes.iter().enumerate() {
            if index > 0 {
                let marker = scene.heading.clone().unwrap_or_else(|| "#".into());
                if y < MARGIN {
                    pages.push(std::mem::take(&mut page));
                    y = text_top();
                }
                page.push(Line { x: (PAGE_W - width_of(&marker)) / 2.0, y, text: marker });
                y -= LEADING;
            }
            for paragraph in &scene.paragraphs {
                let indent = INDENT;
                for (line_index, line) in wrap(paragraph, indent).into_iter().enumerate() {
                    if y < MARGIN {
                        pages.push(std::mem::take(&mut page));
                        y = text_top();
                    }
                    let x = MARGIN + if line_index == 0 { indent } else { 0.0 };
                    page.push(Line { x, y, text: line });
                    y -= LEADING;
                }
            }
        }
        pages.push(page);
    }
    pages
}

/// `Surname / Title / page`, set flush right, as the manuscript format asks.
fn content_stream(manuscript: &Manuscript, page: &[Line], number: usize) -> Vec<u8> {
    let head = format!("{} / {} / {}", manuscript.surname(), manuscript.title, number);
    let mut out = Vec::new();
    out.extend_from_slice(b"BT\n/F1 12 Tf\n");
    out.extend_from_slice(
        format!("1 0 0 1 {:.2} {:.2} Tm\n", PAGE_W - MARGIN - width_of(&head), HEAD_Y).as_bytes(),
    );
    out.extend_from_slice(&pdf_string(&head));
    out.extend_from_slice(b" Tj\n");
    for line in page {
        out.extend_from_slice(format!("1 0 0 1 {:.2} {:.2} Tm\n", line.x, line.y).as_bytes());
        out.extend_from_slice(&pdf_string(&line.text));
        out.extend_from_slice(b" Tj\n");
    }
    out.extend_from_slice(b"ET\n");
    out
}

pub fn render(manuscript: &Manuscript) -> Result<Vec<u8>, String> {
    let pages = paginate(manuscript);
    if pages.is_empty() {
        return Err("empty_manuscript".into());
    }

    const CATALOG: usize = 1;
    const PAGES: usize = 2;
    const FONT: usize = 3;
    let first = 4;
    let page_obj = |i: usize| first + 2 * i;
    let content_obj = |i: usize| first + 2 * i + 1;

    let mut objects: Vec<(usize, Vec<u8>)> = Vec::new();
    objects.push((CATALOG, b"<< /Type /Catalog /Pages 2 0 R >>".to_vec()));
    let kids: Vec<String> = (0..pages.len()).map(|i| format!("{} 0 R", page_obj(i))).collect();
    objects.push((
        PAGES,
        format!("<< /Type /Pages /Count {} /Kids [{}] >>", pages.len(), kids.join(" ")).into_bytes(),
    ));
    objects.push((
        FONT,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    ));
    for (i, page) in pages.iter().enumerate() {
        objects.push((
            page_obj(i),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
                 /Resources << /Font << /F1 {FONT} 0 R >> >> /Contents {} 0 R >>",
                content_obj(i)
            )
            .into_bytes(),
        ));
        let stream = content_stream(manuscript, page, i + 1);
        let mut body = format!("<< /Length {} >>\nstream\n", stream.len()).into_bytes();
        body.extend_from_slice(&stream);
        body.extend_from_slice(b"\nendstream");
        objects.push((content_obj(i), body));
    }
    objects.sort_by_key(|(number, _)| *number);

    let mut buffer: Vec<u8> = Vec::new();
    buffer.extend_from_slice(b"%PDF-1.7\n");
    // Four bytes above 127 tell tools the file is binary, not text.
    buffer.extend_from_slice(&[b'%', 0xe2, 0xe3, 0xcf, 0xd3, b'\n']);

    let mut offsets = vec![0usize; objects.len() + 1];
    for (number, body) in &objects {
        offsets[*number] = buffer.len();
        buffer.extend_from_slice(format!("{number} 0 obj\n").as_bytes());
        buffer.extend_from_slice(body);
        buffer.extend_from_slice(b"\nendobj\n");
    }

    let xref_at = buffer.len();
    let size = objects.len() + 1;
    buffer.extend_from_slice(format!("xref\n0 {size}\n").as_bytes());
    buffer.extend_from_slice(b"0000000000 65535 f \n");
    // Entry 0 is the free head, written above; the rest are object 1..size in
    // order, each exactly 20 bytes wide as the format requires.
    for offset in offsets.iter().take(size).skip(1) {
        buffer.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    buffer.extend_from_slice(
        format!("trailer\n<< /Size {size} /Root {CATALOG} 0 R >>\nstartxref\n{xref_at}\n%%EOF\n")
            .as_bytes(),
    );
    Ok(buffer)
}

pub fn export_to(manuscript: &Manuscript, dest: &Path) -> Result<u64, String> {
    let bytes = render(manuscript)?;
    let len = bytes.len() as u64;
    crate::storage::atomic_write(dest, bytes)?;
    Ok(len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::{Chapter, Scene};

    fn scene(heading: Option<&str>, paragraphs: &[&str]) -> Scene {
        Scene {
            heading: heading.map(str::to_string),
            paragraphs: paragraphs.iter().map(|p| p.to_string()).collect(),
        }
    }

    fn book() -> Manuscript {
        let prose = "La puerta se abrió — y nadie había llamado. «Vení», dijo la voz, \
                     y el año entero se detuvo… ¿Quién anda ahí? ¡Niña, esperá!";
        Manuscript {
            title: "La Casa de Niebla".into(),
            author: "María Fernández".into(),
            language: "es".into(),
            chapters: vec![
                Chapter {
                    id: "ch-01".into(),
                    title: "Capítulo 1. El umbral".into(),
                    scenes: vec![
                        scene(None, &[prose, prose]),
                        scene(None, &[prose]),
                    ],
                },
                Chapter {
                    id: "ch-02".into(),
                    title: "Capítulo 2. La señal".into(),
                    scenes: vec![scene(None, &["Y el final."])],
                },
            ],
        }
    }

    /// Walk the xref back and confirm each offset lands on its object header.
    /// This is the check that catches an off-by-one, which readers reject.
    fn verify_xref(pdf: &[u8]) -> usize {
        // Work on bytes throughout: the binary marker near the header is not
        // valid UTF-8, so a lossy String would shift every offset and the test
        // would be measuring the wrong thing.
        let marker = b"startxref\n";
        let start = pdf
            .windows(marker.len())
            .rposition(|w| w == marker)
            .expect("startxref");
        let tail = &pdf[start + marker.len()..];
        let end = tail.iter().position(|b| *b == b'\n').unwrap();
        let xref_at: usize = std::str::from_utf8(&tail[..end]).unwrap().trim().parse().unwrap();
        assert_eq!(&pdf[xref_at..xref_at + 4], b"xref", "startxref must point at the table");

        // From the table onwards the file is pure ASCII.
        let table = std::str::from_utf8(&pdf[xref_at..]).expect("the xref table is ASCII");
        let mut lines = table.lines();
        lines.next();
        let header = lines.next().unwrap();
        let size: usize = header.split_whitespace().nth(1).unwrap().parse().unwrap();
        lines.next(); // the free object
        for number in 1..size {
            let entry = lines.next().unwrap();
            let offset: usize = entry.split_whitespace().next().unwrap().parse().unwrap();
            let expected = format!("{number} 0 obj");
            assert_eq!(
                &pdf[offset..offset + expected.len()],
                expected.as_bytes(),
                "xref entry {number} points at the wrong byte"
            );
        }
        size
    }

    #[test]
    fn the_file_is_a_pdf_from_its_first_byte_to_its_last() {
        let pdf = render(&book()).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.7"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        // The binary marker keeps tools from mangling it as text.
        assert_eq!(&pdf[9..14], &[b'%', 0xe2, 0xe3, 0xcf, 0xd3]);
    }

    #[test]
    fn every_xref_offset_points_at_its_object() {
        let pdf = render(&book()).unwrap();
        let size = verify_xref(&pdf);
        assert!(size > 4);
    }

    #[test]
    fn each_chapter_opens_a_new_page() {
        let manuscript = book();
        let pages = paginate(&manuscript);
        assert_eq!(pages.len(), 2, "two short chapters, two pages");
        // The first line of each page is the centred chapter title.
        assert_eq!(pages[0][0].text, "Capítulo 1. El umbral");
        assert_eq!(pages[1][0].text, "Capítulo 2. La señal");

        let pdf = render(&manuscript).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Count 2"));
    }

    #[test]
    fn a_long_chapter_spills_onto_further_pages() {
        let mut manuscript = book();
        let prose = manuscript.chapters[0].scenes[0].paragraphs[0].clone();
        manuscript.chapters[0].scenes = vec![scene(
            None,
            &std::iter::repeat(prose.as_str()).take(40).collect::<Vec<_>>(),
        )];
        manuscript.chapters.truncate(1);
        let pages = paginate(&manuscript);
        assert!(pages.len() > 1, "40 paragraphs cannot fit on one page");
        // The continuation pages must not repeat the title.
        assert_ne!(pages[1][0].text, manuscript.chapters[0].title);
    }

    #[test]
    fn the_running_head_is_surname_title_and_page_number() {
        let manuscript = book();
        let pages = paginate(&manuscript);
        let stream = content_stream(&manuscript, &pages[1], 2);
        let text = String::from_utf8_lossy(&stream);
        // Octal escapes, since the head is written 7-bit.
        assert!(text.contains("Fern\\341ndez / La Casa de Niebla / 2"));
    }

    #[test]
    fn spanish_typography_becomes_the_right_winansi_bytes() {
        for (ch, byte) in [
            ('á', 0xe1u8), ('é', 0xe9), ('í', 0xed), ('ó', 0xf3), ('ú', 0xfa),
            ('ñ', 0xf1), ('ü', 0xfc), ('¿', 0xbf), ('¡', 0xa1),
            ('«', 0xab), ('»', 0xbb), ('—', 0x97), ('…', 0x85),
        ] {
            let (bytes, lost) = encode(&ch.to_string());
            assert_eq!(bytes, vec![byte], "{ch} encoded wrong");
            assert!(!lost, "{ch} is representable and must not be replaced");
        }
    }

    #[test]
    fn a_character_outside_the_encoding_is_replaced_not_emitted_raw() {
        let (bytes, lost) = encode("Se fue 🌙 y no volvió.");
        assert!(lost, "the substitution must be reported");
        assert!(bytes.iter().all(|b| *b != 0), "no stray zero bytes");
        assert_eq!(bytes.iter().filter(|b| **b == b'?').count(), 1);
        // And the file it produces is still structurally sound.
        let mut manuscript = book();
        manuscript.chapters[1].scenes = vec![scene(None, &["Se fue 🌙 y no volvió."])];
        let pdf = render(&manuscript).unwrap();
        verify_xref(&pdf);
    }

    #[test]
    fn a_string_never_loses_its_delimiters() {
        // An unescaped bracket or backslash would end the string early and
        // corrupt everything after it.
        let escaped = String::from_utf8_lossy(&pdf_string(r"a (b) \c")).into_owned();
        assert_eq!(escaped, r"(a \(b\) \\c)");
    }

    #[test]
    fn wrapping_uses_real_glyph_widths() {
        // 'm' is far wider than 'i'; a fixed-width guess would wrap identically.
        // Separate words, so wrapping actually has somewhere to break.
        let wide = wrap(&vec!["mmmm"; 60].join(" "), 0.0);
        let narrow = wrap(&vec!["iiii"; 60].join(" "), 0.0);
        assert!(wide.len() > narrow.len(), "widths are not being measured");
        let max = PAGE_W - 2.0 * MARGIN;
        for line in wrap(&book().chapters[0].scenes[0].paragraphs[0], INDENT).iter().skip(1) {
            assert!(width_of(line) <= max, "a wrapped line ran past the margin");
        }
    }

    #[test]
    fn a_word_longer_than_the_line_still_gets_written() {
        let lines = wrap(&"x".repeat(400), 0.0);
        assert_eq!(lines.len(), 1, "an unbreakable word must not loop forever");
    }

    #[test]
    fn a_manuscript_with_nothing_in_it_is_refused() {
        let manuscript = Manuscript {
            title: "Empty".into(),
            author: "A B".into(),
            language: "en".into(),
            chapters: vec![Chapter { id: "ch-01".into(), title: "One".into(), scenes: vec![] }],
        };
        assert_eq!(render(&manuscript).unwrap_err(), "empty_manuscript");
    }

    #[test]
    fn export_writes_the_file_and_reports_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.pdf");
        let bytes = export_to(&book(), &dest).unwrap();
        assert_eq!(bytes, std::fs::metadata(&dest).unwrap().len());
        assert!(std::fs::read(&dest).unwrap().starts_with(b"%PDF-"));
    }

    #[test]
    #[ignore = "needs poppler"]
    fn live_poppler_reads_the_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("book.pdf");
        export_to(&book(), &dest).unwrap();

        let info = std::process::Command::new("pdfinfo").arg(&dest).output().expect("pdfinfo");
        let info = String::from_utf8_lossy(&info.stdout).into_owned();
        eprintln!("{info}");
        // Parse the value rather than matching poppler's column alignment.
        let pages = info
            .lines()
            .find_map(|line| line.strip_prefix("Pages:"))
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or_else(|| panic!("pdfinfo reported no page count: {info}"));
        assert_eq!(pages, 2, "pdfinfo saw: {info}");
        assert!(info.contains("letter"), "the page size is not US Letter: {info}");

        let out = std::process::Command::new("pdftotext")
            .arg(&dest)
            .arg("-")
            .output()
            .expect("pdftotext");
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        eprintln!("{text}");
        assert!(text.contains("Capítulo 1. El umbral"), "chapter title missing");
        assert!(text.contains("Fernández / La Casa de Niebla / 1"), "running head missing");
        assert!(text.contains("nadie había llamado"), "prose missing");
    }
}
