# Formats — what survives a round trip

Versorium's manuscript is Markdown on disk: one file per chapter, scenes marked
by `##` headings. Every other format is a projection of that, and each loses
something. This is the list, so nobody discovers it after sending a file to an
editor.

The app says some of this at the moment it happens. Three exports (DOCX, PDF,
Scrivener) report some of what they could not carry, and every import shows a
preview with its warnings **before** it writes a project. Markdown and EPUB
exports report nothing. Not every loss has a warning, on either side. The
silent ones are listed below:

- PDF drops the heading on a chapter's first scene without saying so.
- EPUB import drops bold and italics. Its only warnings cover images and
  stylesheets.
- DOCX import never reads footnotes or comments, and does not warn about them.
- Scrivener import drops keywords without a warning.
- Markdown import keeps image links as text but does not copy the image files,
  and does not warn.

The code is in `src-tauri/src/formats/` (one module per format) and
`src-tauri/src/commands/formats.rs` (the commands that pick one).

## Export

Five targets, offered in this order in the Manuscript dialog: Markdown, Word
(DOCX), EPUB 3, PDF, Scrivener.

| | Markdown | DOCX | EPUB 3 | PDF | Scrivener 3 |
|---|---|---|---|---|---|
| Chapter titles | ✅ `#` | ✅ Heading 1, new page | ✅ `<h1>`, one file each | ✅ centred, new page | ✅ one binder document each |
| Paragraphs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Scene breaks | ✅ `##` | centred `#` | `<h2>` or centred `#` | centred title or `#` | centred `#` |
| **Scene titles** | ✅ | ❌ dropped | ✅ `<h2>` | ⚠️ printed, except a chapter's first scene (no warning) | ❌ dropped |
| Title page | — | ✅ | ✅ | ✅ | — |
| Colophon | — | ✅ | ✅ | ✅ | — |
| Title / author metadata | ✅ frontmatter | ✅ | ✅ | ✅ `/Info` + running head | title only |
| Accented Latin text | ✅ | ✅ | ✅ | ⚠️ Latin-1 only; others become `?` | ✅ |
| Emoji and non-Latin scripts | ✅ | ✅ | ✅ | ❌ replaced by `?` | ✅ |
| Needs an author | no | yes, the project's own | no | yes, the project's own | no |
| Warning it can raise | — | `export_docx_scene_titles_dropped` | — | `export_pdf_characters_replaced` (characters only) | `export_scrivener_scenes_flattened` |

DOCX and PDF print the surname in every running head, so both need an author.
In the app, that author has to be the **project's own**. The Manuscript dialog
fills its Author field from the project only (`meta.author`), never from
Settings → Author, and it disables Export for DOCX and PDF while that field is
blank (`ManuscriptDialog.svelte`, `NEEDS_AUTHOR`). A writer whose name is only
in their author profile has to type it into the dialog once. The dialog saves
it to the project, and from then on the export goes through. The backend would
accept the profile name for DOCX and PDF too (`with_byline` in
`commands/formats.rs`), and refuses with `no_author` only when neither has one,
but the dialog never sends that request. In practice the profile name reaches
only Markdown and EPUB exports of a project with no author of its own. The
hint under Name in Settings → Author says the name is written into DOCX and
PDF as well. The backend would do that, but the dialog never lets it.

Every format refuses a manuscript with no text in it (`empty_manuscript`), and
EPUB and PDF leave out a chapter that has no text.

**Markdown** is canonical: one document, a frontmatter block, then `#` per
chapter and `##` per scene. `export` → `import` reproduces every chapter title,
scene and paragraph, with no warnings, and a test asserts it
(`round_trip_preserves_every_chapter_and_paragraph`). Only the title comes
back, though. The importer ignores the author and byline keys the export
writes.

**DOCX** is Standard Manuscript Format: 12pt Times New Roman, double-spaced,
US Letter with 1-inch margins, `Surname / Title / page` right-aligned in the
header, each chapter starting a new page, no indent on a scene's first
paragraph and a half-inch indent after that. The first page has no running head
(`w:titlePg`). That format has no place for a scene *title*, so `## Morning`
becomes an anonymous centred `#`, and the export warns with
`export_docx_scene_titles_dropped`.

**EPUB 3** writes one XHTML file per chapter, a nav document listing the
chapters, and a stylesheet. Its identifier is a UUID derived from the title and
author, so exporting the same book again keeps its identity rather than minting
a new edition. Changing either one gives it a new identifier. The nav heading
is the English word "Contents" whatever the manuscript's language. That is a
string hardcoded in `epub.rs`, a known gap in the EN+ES i18n rule.
It passes epubcheck 5.2.1 with the default title page and colophon on: 0
errors, 0 warnings (2026-10-03, after the title page's role was fixed); see
[Checking the output](#checking-the-output).

**PDF** uses Times-Roman from the base-14 set, so the app embeds no fonts and
ships none. Pages are US Letter with 1-inch margins, 12pt type and 24pt leading.
Each chapter opens a new page, but not necessarily a right-hand (odd) one, so
the spec's "chapter recto" for PDF is not met. Every paragraph gets a
half-inch first-line indent, including a scene's first. The running head
(`Surname / Title / N`) is on every page of the text; the title page and the
colophon have none, and page 1 is the first page of the text. Between scenes the PDF centres the scene's title, or `#` when the
scene has none. A heading on a chapter's first scene is not printed, and the
export does not warn about it: `export_warnings` in `pdf.rs` only checks the
encoding.

The encoding (WinAnsi) covers Latin-1, plus `Š š Ž ž Œ œ Ÿ` and the
typographic marks a Spanish manuscript needs (`á é í ó ú ñ ü ¿ ¡ « » — …`).
It does not cover an emoji, a non-Latin script, or accented Latin letters
outside that set, such as Polish `ł`, Czech `č ř`, Hungarian `ő`, Romanian
`ș ț ă` or Turkish `ğ ı ş`. Those characters become `?`, and the export says so
(`export_pdf_characters_replaced`). The check only looks at chapter titles,
scene titles and prose. The book title, the author and the byline fields go
through the same encoding on the title page, in the running head and in
`/Info`, but a character lost there raises no warning.

**Scrivener** writes a Scrivener 3 bundle, which is a folder rather than a
file. The dialog asks for a parent folder and creates `<project title>.scriv`
inside it. There is one Text document per chapter under the Draft folder, at
`Files/Data/<UUID>/content.rtf`. The UUIDs come from each chapter's position,
so exporting again produces the same `.scrivx`. Each document gets a
`synopsis.txt` holding the chapter's first sentence (at most 200 characters),
for the corkboard. Scenes are separated by a centred `#`, and their titles are
dropped (`export_scrivener_scenes_flattened`). No author, labels, keywords or
compile settings are written. Unlike the other writers, this one writes files
in place rather than atomically. Exporting over an existing bundle overwrites
the files it writes and leaves any others where they were. The bundle has only
been checked by reading it back through Versorium's own Scrivener importer,
never by opening it in Scrivener.

## Title page and colophon

Each project has two settings in its project settings dialog, and both are on
by default. They are stored in `versorium.json` as `exportCover` and
`exportColophon`. Only DOCX, EPUB and PDF use them.

- **Title page** ("Open exports with a title page"): the title, then the author,
  publisher and rights lines that are filled in. This is a page of text, not a
  cover image: no format exports an image.
  - DOCX: paragraphs styled `TitlePage`, ending in a page break.
  - EPUB: `cover.xhtml`, `epub:type="titlepage"`, first in the spine.
  - PDF: a centred first page.
- **Colophon** ("Close exports with this novel's record"): a heading, then
  title, author, publisher and rights (when filled in), language, chapter count
  and word count, then `Written in Versorium <version>` and a line of thanks.
  The chapter count is every chapter in the project, including empty ones.
  EPUB and PDF leave empty chapters out, so their colophon can report more
  chapters than the file contains.
  - DOCX: paragraphs styled `Colophon` after a page break.
  - EPUB: `colophon.xhtml`, `epub:type="colophon"`, last in the spine.
  - PDF: a left-aligned last page.

The colophon's heading, its field labels and the line of thanks follow the
manuscript's language, not the interface's: Spanish when the project language
starts with `es`, English otherwise. The frontend sends those words with each
export. The credit line `Written in Versorium <version>` does not follow it.
It is an English string hardcoded in Rust (`colophon_credit()` in
`formats/mod.rs`), so a Spanish novel's colophon ends with an English sentence.
That is a known gap in the EN+ES i18n rule.

Neither page appears in the EPUB nav. With the colophon off, the EPUB contains
nothing that names Versorium: in an EPUB the name appears only in the
colophon's credit line. The test (`a_writer_who_refuses_them_gets_a_book_with_neither`)
is narrower than that sentence. It switches off both the title page and the
colophon, and checks only `package.opf`.

The other formats name Versorium whatever the settings say. DOCX always
writes `<Application>Versorium</Application>` to `docProps/app.xml`, PDF
always sets `/Creator` and `/Producer` to `Versorium`, and the `.scrivx`
carries `Creator="Versorium"`.

## Author metadata

The project's own author (set in the export dialog and saved to
`versorium.json`) wins. When the project has none, the name comes from the
active author profile in Settings → Author ("Work" or "Personal"), but only for
Markdown and EPUB: the dialog will not export DOCX or PDF without a project
author (see [Export](#export)). The other four fields always come from the
active profile, and an empty field writes nothing.

The table uses this document's names. Settings → Author labels them "Sort as",
"Role", "Publisher or company" (Organization below) and "Copyright line"
(Rights below). The hints under "Sort as" and "Role" in Settings say "EPUB
only"; Markdown writes both to its frontmatter as well.

| Field | Markdown | DOCX | EPUB | PDF | Scrivener |
|---|---|---|---|---|---|
| Title | `title:` | `dc:title` | `dc:title` | `/Title`, running head | Draft folder title |
| Name | `author:` | `dc:creator`, `cp:lastModifiedBy`, running head | `dc:creator` (left out with no author) | `/Author`, running head | — |
| Language | `language:` | `dc:language`, `w:lang` | `dc:language`, `xml:lang` | — | — |
| Sort as | `sortAs:` | — | `file-as` on the creator; guessed as "last word, the rest" when empty | — | — |
| Role | `role:` | — | MARC relator on the creator, only `aut`, `edt` or `trl` | — | — |
| Organization ("Publisher or company") | `publisher:` | `Company` in `docProps/app.xml` | `dc:publisher` | — | — |
| Rights ("Copyright line") | `rights:` | `dc:description` in `docProps/core.xml` | `dc:rights` | `/Subject` | — |

DOCX, EPUB and PDF also print the organization and rights on the title page and
in the colophon. PDF `/CreationDate` and EPUB `dcterms:modified` are the export
time in UTC.

## Import

| | Markdown | DOCX | EPUB | Scrivener |
|---|---|---|---|---|
| Chapters | `#` headings | Heading 1 | spine documents with body text, in spine order | binder items with text anywhere outside the trash, not only the Draft folder, in binder order |
| Chapter text | ✅ | ✅ | ✅ | ✅ (from RTF) |
| Scene structure | `##` preserved | ❌ | ❌ | ❌ none to map |
| Scene breaks | `##` preserved | ⚠️ a `#` paragraph | ⚠️ a `#` paragraph (from a Versorium EPUB) | ⚠️ a `#` paragraph (from a Versorium bundle) |
| Synopsis | — | — | — | ❌ read, but not saved |
| Bold/italic formatting | ✅ (it is Markdown) | ❌ warned | ❌ **no warning** | ❌ warned |
| Images | links kept as text, files not copied, **no warning** | ❌ warned | ❌ warned | ❌ warned |
| Footnotes, comments | kept as Markdown text | ❌ never read, **no warning** | text kept as plain paragraphs | ❌ |
| Labels, status | — | — | — | ❌ warned |
| Keywords | — | — | — | ❌ **no warning** |
| Trashed documents | — | — | — | skipped on purpose |
| Title page / colophon | — | skipped by style id | skipped by `epub:type` | — |
| Author metadata | ❌ | ❌ | ❌ | ❌ |

Import is two steps: the preview reads the source and lists its warnings
without writing anything, and a project is only created after the writer
confirms. The new project goes into the default projects folder, takes the
title shown in the preview (editable there), and is always created with
language `en`. No importer reads the source's language or author.

The file picker accepts `.md`, `.markdown`, `.docx` and `.epub`. A Scrivener
project is picked as a folder. The backend also takes `.txt` as Markdown, but
the picker does not offer it.

Every import is tolerant of files Versorium did not write:

- **Markdown** accepts setext headings, CRLF, a BOM, closing hashes, and
  documents with no headings at all. Text before the first `#` becomes an
  opening chapter rather than vanishing. With no `title:` in the frontmatter,
  the book title is taken from the first heading and the preview says so.
  Invalid UTF-8 is salvaged rather than refused: each byte that is not valid
  UTF-8 becomes `�` and the import warns (`import_not_utf8`). A Latin-1 file
  keeps its words, but every accented letter in it arrives as `�`.
- **DOCX** finds a chapter heading by its style id first and then by the style's
  declared name in `styles.xml`. That second check catches a Spanish Word file
  whose id is `Ttulo1` but whose name is `Título 1`. The list in `docx.rs`
  (`HEADING_ONE`) also holds localized Heading 1 spellings for German,
  Italian, Dutch, Swedish, Danish/Norwegian and Polish, but tests cover only
  `Heading1`, `Ttulo1`, `Titre1` and the name `Título 1`, so the other
  languages are unverified. The Polish entry (`nagowek1`) can never match: the
  normalizer folds `ó` but keeps `ł`, so the name `Nagłówek 1` becomes
  `nagłowek1`, and the ASCII-only id `Nagwek1` becomes `nagwek1`. A Polish
  Word file splits into chapters only if some other spelling in the list
  catches its heading style; otherwise it arrives as one chapter with
  `import_docx_no_headings`. A paragraph carrying only an outline level is
  deliberately *not* a heading: direct formatting is too weak a signal to
  split a manuscript on. Tracked deletions and field codes are skipped. Text inside hyperlinks, smart tags and tracked
  insertions is kept. Paragraphs styled `TitlePage` or `Colophon`, the ids this
  app writes, are skipped, so re-importing a Versorium DOCX does not turn its
  title page into chapter one. A scene break comes back as a paragraph holding
  a literal `#` (see the warning after this list). Footnotes and comments are
  lost without a warning: the importer reads only `word/document.xml`,
  `word/styles.xml` and `docProps/core.xml`, and its warnings cover missing
  headings, prose before the first heading, formatting and images. The book
  title comes from `dc:title` in `docProps/core.xml`, or from the first chapter
  when that is missing.
- **EPUB** finds the package through `META-INF/container.xml` and resolves hrefs
  against the package document's folder. The spine decides chapter order, not
  file names or the table of contents. Each spine document with body text
  becomes one chapter, titled by its first heading (or by its number when it
  has none). A document with a heading and no body text is skipped. A later
  heading in the same document, such as a scene title, becomes an ordinary
  paragraph, and a Versorium EPUB's scene break (`<p class="scene-break">#</p>`)
  comes back as a paragraph holding a literal `#`. Spine documents marked with
  exactly one `epub:type` value from `toc`, `titlepage`, `colophon`, `cover`,
  `copyright-page`, `dedication`, `acknowledgments` or `landmarks` are
  skipped. That covers this app's own title page and colophon. The check is an
  exact match on `epub:type="<value>"`, so a page carrying several values, such
  as `epub:type="frontmatter titlepage"` or `epub:type="backmatter colophon"`,
  as many publishers write them, is imported as a chapter. All markup is
  stripped. The preview warns when the book has images
  (`import_images_dropped`) and when it has any stylesheet
  (`import_epub_styles_dropped`), but it gives no warning about bold or
  italics. The book title comes from `dc:title`.
- **Scrivener** reads both layouts. v3 keys documents by UUID under
  `Files/Data`, and v2 keys them by ID under `Files/Docs`. Both paths are
  probed for every item rather than picked from a version number, so a project
  whose files are split between the two layouts (a hybrid or hand-moved
  project) still reads. A bundle matching neither layout does not: every item
  is skipped, the preview lists no chapters, and the import is refused with
  `empty_document`. Nested binder items are flattened in order. A folder with
  text of its own becomes a chapter, and one without contributes nothing.
  The importer is not limited to the Draft folder. It walks the whole binder
  outside the trash, so text documents in Research, Template Sheets or any
  other top-level folder (character sheets, notes kept as text documents) come
  in as chapters too. The trash subtree is skipped: importing what the writer
  deleted is never what they meant. The book title is the bundle's folder
  name. Warnings fire only for losses the project actually has:
  - labels or status: `import_scrivener_labels_dropped`
  - document notes: `import_scrivener_notes_dropped`
  - images, PDFs or other attachments: `import_images_dropped`
  - bold, italic or underline: `import_docx_formatting_dropped`

  Keywords are neither read nor warned about. Synopses are read into the
  preview data, but the dialog does not show them and the import does not save
  them. The corkboard builds its own card text from each chapter's prose.

**The `#` that a DOCX, EPUB or Scrivener scene break leaves behind is not
harmless.** A Versorium Scrivener bundle separates scenes with a centred `#`
in the RTF, and that comes back the same way. In the imported Markdown body,
a line holding only `#` is an empty level-1 heading. The exporters read it as
an ordinary paragraph (scenes split only on `## `), so DOCX, EPUB and PDF
print a literal `#`. But export that project to Markdown and import the file
again, and every former scene break opens a new chapter, named after the book
(or "Untitled" when the frontmatter has no title). Nothing warns about this.

## Checking the output

Each check below can be run by hand:

```bash
# EPUB
java -jar epubcheck.jar novel.epub

# PDF
pdfinfo novel.pdf && pdftotext novel.pdf -

# DOCX
pandoc novel.docx -t markdown
```

The repository runs the same three tools as `#[ignore]` tests:
`live_pandoc_reads_our_chapters_back`, `live_epubcheck_accepts_the_export` and
`live_poppler_reads_the_pdf`. They need pandoc and poppler on `PATH`, plus a
JDK at `/opt/homebrew/opt/openjdk/bin/java` and the jar at
`/tmp/m5/epubcheck-5.2.1/epubcheck.jar`. `make tools` downloads the jar.

```bash
make tools
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" \
  cargo test --manifest-path src-tauri/Cargo.toml --lib formats:: -- --ignored
```

`make test-live` runs these three along with every other `live_` test, and some
of those need the network and an Ollama daemon.

None of these three tests is part of the measured suites, and no output from
them is saved in the repository. What follows separates what the code shows
from what a hand run on 2026-10-03 reported. All three tests export with the
title page and colophon on (the default).

- **EPUB / epubcheck 5.2.1: passes.** The title page first shipped as
  `<section epub:type="titlepage" role="doc-tithead">`; `doc-tithead` is not a
  DPUB-ARIA role, and epubcheck reported `RSC-005` on it. The role is gone
  (commit 6af6c60), and `every_aria_role_in_the_book_is_one_epubcheck_accepts`
  keeps any new one inside the list epubcheck accepts. On 2026-10-03
  `live_epubcheck_accepts_the_export`, which exports with the title page and
  colophon on, reported 0 errors and 0 warnings.
- **PDF / poppler: fails, and the fault is in the test.** It can be read off
  the code: `live_poppler_reads_the_pdf` expects `pdfinfo` to report 2 pages,
  but with the title page and colophon on, the same manuscript paginates to 4,
  as the unit test `the_title_page_comes_first_and_the_colophon_last` asserts.
  The test stops at that assertion, so its later checks (US Letter, the text
  through `pdftotext`) do not run.
- **DOCX / pandoc:** an unlogged hand run on 2026-10-03 reported a pass: pandoc
  read both chapters as headings, and the em dash and the emoji survived.
  Unverified for the same reason.

Two ordinary (not ignored) tests read research fixtures from `/tmp/m5` and
return early, passing without checking anything, when those files are missing:
`runs_tabs_breaks_and_wrappers_come_through_but_deletions_do_not` in `docx.rs`
and `the_reference_fixtures_read_the_same_way` in `scrivener.rs`. The fixtures
are not in the repository, and `make tools` does not fetch them. On a fresh
machine and in CI, the DOCX tracked-change and field-code handling described
above is backed by the code, not by a test that runs.
