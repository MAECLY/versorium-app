# Formats — what survives a round trip

Versorium's manuscript is Markdown on disk: one file per chapter, scenes marked
by `##` headings. Every other format is a projection of that, and each loses
something. This is the list, so nobody discovers it after sending a file to an
editor.

The app says the same things at the moment they happen: an export reports what
it could not carry, and an import shows its losses **before** it writes a
project.

## Export

| | Markdown | DOCX | EPUB 3 | PDF |
|---|---|---|---|---|
| Chapter titles | ✅ | ✅ | ✅ | ✅ |
| Paragraphs | ✅ | ✅ | ✅ | ✅ |
| Scene breaks | ✅ | centred `#` | centred `#` | centred `#` |
| **Scene titles** | ✅ | ❌ dropped | ✅ `<h2>` | ❌ dropped |
| Author / title metadata | ✅ | ✅ | ✅ | running head |
| Accented Latin text | ✅ | ✅ | ✅ | ✅ |
| Emoji and non-Latin scripts | ✅ | ✅ | ✅ | ❌ replaced |

**Markdown** is canonical: `export` → `import` reproduces every chapter title
and paragraph, and a test asserts it.

**DOCX** is Standard Manuscript Format — 12pt Times, double-spaced, 1-inch
margins, `Surname / Title / page` in the header, each chapter breaking to a new
page. That format has no place for a scene *title*, so `## Morning` becomes an
anonymous break. Warned as `export_docx_scene_titles_dropped`.

**EPUB 3** passes epubcheck 5.2.1 with zero errors and zero warnings. Its
identifier is derived from title and author, so re-exporting the same book keeps
its identity rather than minting a new edition.

**PDF** uses Times-Roman from the base-14 set, so the app embeds no fonts and
ships none. That encoding (WinAnsi) covers Latin-1 and the typographic marks a
Spanish manuscript needs — `á é í ó ú ñ ü ¿ ¡ « » —` — but not an emoji or a
non-Latin script. Those are replaced, and the export says so
(`export_pdf_characters_replaced`).

There is no Scrivener export. Import only, per the milestone.

## Import

| | Markdown | DOCX | Scrivener |
|---|---|---|---|
| Chapters | `#` headings | Heading 1 | binder order |
| Chapter text | ✅ | ✅ | ✅ (from RTF) |
| Scene structure | `##` preserved | ❌ | ❌ none to map |
| Synopsis | — | — | ✅ |
| Character/bold/italic formatting | ✅ (it is Markdown) | ❌ | ❌ |
| Images, footnotes, comments | ❌ | ❌ | ❌ |
| Labels, status, keywords | — | — | ❌ |
| Trashed documents | — | — | skipped on purpose |

Every import is tolerant of files Versorium did not write:

- **Markdown** accepts setext headings, CRLF, a BOM, trailing hashes, and
  documents with no headings at all. Text before the first `#` becomes an
  opening chapter rather than vanishing. Invalid UTF-8 is salvaged rather than
  refused — a Latin-1 file loses one character, not the manuscript.
- **DOCX** finds a chapter heading as Word, Google Docs, LibreOffice and pandoc
  spell it: the style id first, then the declared name in `styles.xml`, which is
  what catches a Spanish Word file whose id is `Ttulo1` but whose name is
  `Título 1`. A paragraph carrying only an outline level is deliberately *not* a
  heading — direct formatting is too weak a signal to split a manuscript on.
- **Scrivener** reads both layouts: v3 keys documents by UUID under
  `Files/Data`, v2 by ID under `Files/Docs`, and each is probed rather than
  sniffed from a version, so a project matching neither still opens. The trash
  subtree is skipped: importing what the writer deleted is never what they
  meant.

## Verifying the output yourself

```bash
# EPUB — the acceptance gate
java -jar epubcheck.jar novel.epub

# PDF
pdfinfo novel.pdf && pdftotext novel.pdf -

# DOCX
pandoc novel.docx -t markdown
```

The repository runs all three as `#[ignore] live_` tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored live_
```
