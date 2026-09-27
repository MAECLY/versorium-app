//! Read-only project queries behind the MCP read tools.
//!
//! Protocol-independent on purpose: everything here takes a project root and
//! returns plain data, so the stdio server, a future HTTP transport and the
//! GUI can share one implementation.

use crate::commands::project::{load_meta, split_frontmatter};
use crate::storage::project_file;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Kinds of codex entry, in the order they are returned.
const CODEX_KINDS: [&str; 4] = ["characters", "factions", "items", "locations"];
/// Directories a search must never descend into: machine state, not manuscript.
const SKIP_DIRS: [&str; 3] = [".versorium", ".git", "snapshots"];
/// Long lines are truncated so one hit cannot flood a tool result.
const EXCERPT_CHARS: usize = 200;
/// A chapter naming more entries than this is almost certainly a false match.
const MAX_CONTEXT_CODEX: usize = 24;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Project-relative, always `/`-separated.
    pub file: String,
    /// 1-based, matching what an editor shows.
    pub line: u32,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDocument {
    pub id: String,
    pub title: String,
    pub file: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub title: String,
    pub language: String,
    pub document: Option<ContextDocument>,
    pub codex: Vec<CodexEntry>,
    pub style: Option<String>,
    pub outline: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameSpan {
    pub author: String,
    /// UTF-16 offsets into the replayed document, like every op in the log.
    pub from: usize,
    pub to: usize,
    pub text: String,
}

// ---------------------------------------------------------------- search

/// Where a search looks, and which extensions count there (spec §4 layout).
const SEARCH_ROOTS: [(&str, &[&str]); 5] = [
    ("codex", &["md", "yml"]),
    ("manuscript", &["md"]),
    ("plot", &["md", "yml"]),
    ("research", &["md"]),
    ("style", &["md"]),
];

/// Case-insensitive, accent-sensitive substring search over the prose tree.
pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let needle = lower_chars(query);
    if needle.iter().all(|c| c.is_whitespace()) {
        return Err("empty_query".into());
    }
    let limit = limit.clamp(1, 200);
    let mut files: Vec<String> = Vec::new();
    for (dir, exts) in SEARCH_ROOTS {
        collect_files(&root.join(dir), dir, exts, &mut files)?;
    }
    files.sort();

    let mut hits = Vec::new();
    for file in files {
        // A file that vanished mid-walk is not an error for a search.
        let Ok(text) = fs::read_to_string(root.join(&file)) else { continue };
        for (index, line) in text.lines().enumerate() {
            if !contains_seq(&lower_chars(line), &needle) {
                continue;
            }
            hits.push(SearchHit {
                file: file.clone(),
                line: index as u32 + 1,
                excerpt: excerpt(line),
            });
            if hits.len() == limit {
                return Ok(hits);
            }
        }
    }
    Ok(hits)
}

/// Depth-first, alphabetical, and never through a symlink — a symlinked
/// directory could otherwise walk straight out of the project.
fn collect_files(dir: &Path, rel: &str, exts: &[&str], out: &mut Vec<String>) -> Result<(), String> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok(()) };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = format!("{rel}/{name}");
        if kind.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                collect_files(&entry.path(), &child, exts, out)?;
            }
        } else if entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.contains(&e))
        {
            out.push(child);
        }
    }
    Ok(())
}

/// Truncation counts chars, so a multibyte line can never be split mid-char.
fn excerpt(line: &str) -> String {
    let trimmed = line.trim();
    let mut out: String = trimmed.chars().take(EXCERPT_CHARS).collect();
    if trimmed.chars().nth(EXCERPT_CHARS).is_some() {
        out.push('…');
    }
    out
}

// ---------------------------------------------------------------- context

/// The project context a chat needs (spec §5): the open chapter, the codex
/// entries actually named in it, and the voice sheet.
pub fn assemble_context(root: &Path, document: Option<&str>) -> Result<ProjectContext, String> {
    let meta = load_meta(root).ok_or_else(|| "not_found".to_string())?;
    let document = match document {
        Some(rel) => Some(read_document(root, rel)?),
        None => None,
    };
    // Without a document there is nothing to match names against, so the
    // codex would be an arbitrary dump rather than context.
    let codex = match &document {
        Some(doc) => mentioned(codex_list(root, None)?, &doc.body),
        None => Vec::new(),
    };
    Ok(ProjectContext {
        title: meta.title,
        language: meta.language,
        document,
        codex,
        style: optional_file(root, "style/voice.md"),
        outline: optional_file(root, "plot/outline.md"),
    })
}

fn read_document(root: &Path, rel: &str) -> Result<ContextDocument, String> {
    let text = fs::read_to_string(project_file(root, rel)?).map_err(|_| "not_found".to_string())?;
    let (fm, body) = split_frontmatter(&text);
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md");
    Ok(ContextDocument {
        id: fm.get("id").cloned().unwrap_or_else(|| stem.to_string()),
        title: fm.get("title").cloned().unwrap_or_else(|| stem.to_string()),
        file: rel.to_string(),
        body,
    })
}

fn optional_file(root: &Path, rel: &str) -> Option<String> {
    fs::read_to_string(root.join(rel)).ok()
}

fn mentioned(entries: Vec<CodexEntry>, body: &str) -> Vec<CodexEntry> {
    let haystack = lower_chars(body);
    entries
        .into_iter()
        .filter(|entry| contains_word(&haystack, &lower_chars(&entry.name)))
        .take(MAX_CONTEXT_CODEX)
        .collect()
}

// ---------------------------------------------------------------- codex

/// Every codex entry, newest schema first by (kind, name). `kind` filters.
pub fn codex_list(root: &Path, kind: Option<&str>) -> Result<Vec<CodexEntry>, String> {
    if let Some(k) = kind {
        if !CODEX_KINDS.contains(&k) {
            return Err("not_found".into());
        }
    }
    let mut out = Vec::new();
    for current in CODEX_KINDS {
        if kind.is_some_and(|k| k != current) {
            continue;
        }
        let mut files: Vec<String> = Vec::new();
        collect_files(
            &root.join("codex").join(current),
            &format!("codex/{current}"),
            &["md"],
            &mut files,
        )?;
        for file in files {
            if let Some(entry) = read_codex(root, current, &file) {
                out.push(entry);
            }
        }
    }
    out.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

pub fn codex_get(root: &Path, id: &str) -> Result<CodexEntry, String> {
    for kind in CODEX_KINDS {
        let rel = format!("codex/{kind}/{id}.md");
        // project_file rejects an id carrying traversal before anything is read.
        if project_file(root, &rel).is_ok_and(|p| p.is_file()) {
            if let Some(entry) = read_codex(root, kind, &rel) {
                return Ok(entry);
            }
        }
    }
    Err("not_found".into())
}

pub fn get_style(root: &Path) -> Result<String, String> {
    optional_file(root, "style/voice.md").ok_or_else(|| "not_found".to_string())
}

fn read_codex(root: &Path, kind: &str, rel: &str) -> Option<CodexEntry> {
    let text = fs::read_to_string(root.join(rel)).ok()?;
    let (fm, body) = split_frontmatter(&text);
    let id = rel.rsplit('/').next()?.strip_suffix(".md")?.to_string();
    Some(CodexEntry {
        name: fm.get("name").cloned().unwrap_or_else(|| humanise(&id)),
        id,
        kind: kind.to_string(),
        file: rel.to_string(),
        body,
    })
}

/// `ana-de-la-torre` → `Ana De La Torre`. Only a display fallback; matching is
/// case-insensitive, so the capitalisation chosen here never affects results.
fn humanise(slug: &str) -> String {
    slug.split('-')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------- blame

/// Who wrote each span of a chapter, by replaying its ops log.
///
/// Exact only when `limit` covers the whole log: `recent_ops` returns the tail,
/// and ops before that tail are missing, so early offsets may not resolve.
/// Such ops are skipped rather than trusted.
pub fn history_blame(root: &Path, chapter: &str, limit: usize) -> Result<Vec<BlameSpan>, String> {
    let ops = crate::ops::recent_ops(root, chapter, limit.clamp(1, 100_000))?;
    let mut authors: Vec<String> = Vec::new();
    // One entry per UTF-16 unit, because that is the coordinate space ops use.
    let mut units: Vec<(u16, usize)> = Vec::new();

    for op in &ops {
        let len = units.len();
        if op.from > len {
            continue;
        }
        match op.kind.as_str() {
            "insert" => {
                let author = author_id(&mut authors, &op.author);
                let text: Vec<_> = op.text.encode_utf16().map(|u| (u, author)).collect();
                units.splice(op.from..op.from, text);
            }
            "delete" if op.to >= op.from && op.to <= len => {
                units.drain(op.from..op.to);
            }
            "rollback" if op.to >= op.from && op.to <= len => {
                let author = author_id(&mut authors, &op.author);
                let text: Vec<_> = op.text.encode_utf16().map(|u| (u, author)).collect();
                units.splice(op.from..op.to, text);
            }
            _ => continue,
        }
    }

    let mut spans = Vec::new();
    let mut index = 0;
    while index < units.len() {
        let author = units[index].1;
        let start = index;
        while index < units.len() && units[index].1 == author {
            index += 1;
        }
        let raw: Vec<u16> = units[start..index].iter().map(|(unit, _)| *unit).collect();
        spans.push(BlameSpan {
            author: authors.get(author).cloned().unwrap_or_default(),
            from: start,
            to: index,
            // Lossy: a malformed op could split a surrogate pair; never panic.
            text: String::from_utf16_lossy(&raw),
        });
    }
    Ok(spans)
}

fn author_id(authors: &mut Vec<String>, name: &str) -> usize {
    match authors.iter().position(|a| a == name) {
        Some(index) => index,
        None => {
            authors.push(name.to_string());
            authors.len() - 1
        }
    }
}

// ---------------------------------------------------------------- matching

/// Lowercasing can change a string's length, so matching works on char
/// sequences instead of byte offsets into a lowercased copy.
fn lower_chars(s: &str) -> Vec<char> {
    s.chars().flat_map(char::to_lowercase).collect()
}

fn contains_seq(haystack: &[char], needle: &[char]) -> bool {
    find_seq(haystack, needle, 0).is_some()
}

fn find_seq(haystack: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&start| &haystack[start..start + needle.len()] == needle)
}

/// Substring match at word boundaries, so `Ana` does not match `Ananás`.
fn contains_word(haystack: &[char], needle: &[char]) -> bool {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(start) = find_seq(haystack, needle, from) {
        let end = start + needle.len();
        let before = start == 0 || !is_word(haystack[start - 1]);
        let after = end == haystack.len() || !is_word(haystack[end]);
        if before && after {
            return true;
        }
        from = start + 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{create_project, render_chapter, CreateProjectArgs};
    use std::path::PathBuf;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "La aguja".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = PathBuf::from(&project.path);
        fs::write(
            root.join("manuscript/ch-01-la-aguja.md"),
            render_chapter("ch-01", "La aguja", "draft", 0, "Ana miró la ventana.\nAnanás no cuenta.\n"),
        )
        .unwrap();
        fs::write(root.join("codex/characters/ana.md"), "---\nname: Ana\n---\nProtagonista.\n").unwrap();
        fs::write(root.join("codex/characters/bruno-vela.md"), "Secundario.\n").unwrap();
        fs::write(root.join("codex/locations/la-torre.md"), "---\nname: La Torre\n---\nAlta.\n").unwrap();
        (dir, root)
    }

    #[test]
    fn search_is_case_insensitive_and_skips_machine_state() {
        let (_dir, root) = fixture();
        fs::create_dir_all(root.join(".versorium/ops/ch-01")).unwrap();
        fs::write(root.join(".versorium/ops/ch-01/2026-01-01.jsonl"), "ventana\n").unwrap();

        let hits = search(&root, "VENTANA", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file, "manuscript/ch-01-la-aguja.md");
        // Line 8: the six frontmatter lines plus its closing `---`.
        assert_eq!(hits[0].line, 8);
        assert_eq!(hits[0].excerpt, "Ana miró la ventana.");
        assert!(search(&root, "no-aparece-en-ningun-sitio", 50).unwrap().is_empty());
    }

    #[test]
    fn search_is_accent_sensitive_and_rejects_an_empty_query() {
        let (_dir, root) = fixture();
        assert!(search(&root, "miro", 50).unwrap().is_empty(), "accents must not be folded");
        assert_eq!(search(&root, "MIRÓ", 50).unwrap().len(), 1);
        assert_eq!(search(&root, "   ", 50).unwrap_err(), "empty_query");
        assert_eq!(search(&root, "", 50).unwrap_err(), "empty_query");
    }

    #[test]
    fn search_caps_excerpt_on_a_char_boundary_and_honours_limit() {
        let (_dir, root) = fixture();
        let long = format!("{}🌙 cola", "ñ".repeat(EXCERPT_CHARS));
        fs::write(root.join("research/notas.md"), format!("{long}\n{long}\n{long}\n")).unwrap();

        let hits = search(&root, "ñ", 2).unwrap();
        assert_eq!(hits.len(), 2, "limit truncates the result set");
        let excerpt = &hits[0].excerpt;
        assert_eq!(excerpt.chars().count(), EXCERPT_CHARS + 1);
        assert!(excerpt.ends_with('…'));
        assert!(!excerpt.contains('🌙'), "the emoji sits past the cap");
        assert_eq!(excerpt.chars().filter(|c| *c == 'ñ').count(), EXCERPT_CHARS);
    }

    #[cfg(unix)]
    #[test]
    fn search_never_follows_a_symlink_out_of_the_project() {
        let (_dir, root) = fixture();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secreto.md"), "ventana secreta\n").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("research/escape")).unwrap();

        let hits = search(&root, "secreta", 50).unwrap();
        assert!(hits.is_empty(), "a symlinked directory must not be walked");
    }

    #[test]
    fn context_keeps_only_the_codex_entries_named_in_the_chapter() {
        let (_dir, root) = fixture();
        let context = assemble_context(&root, Some("manuscript/ch-01-la-aguja.md")).unwrap();

        assert_eq!(context.title, "La aguja");
        assert_eq!(context.language, "es");
        assert_eq!(context.document.as_ref().unwrap().id, "ch-01");
        assert!(context.document.as_ref().unwrap().body.starts_with("Ana miró"));
        assert_eq!(
            context.codex.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["Ana"],
            "Bruno Vela and La Torre are never named in the chapter"
        );
        assert_eq!(context.style.as_deref(), Some("# Voice\n"));
        assert!(context.outline.as_deref().is_some_and(|o| o.contains("Outline")));
    }

    #[test]
    fn context_matches_names_only_at_word_boundaries() {
        let (_dir, root) = fixture();
        fs::write(
            root.join("manuscript/ch-01-la-aguja.md"),
            render_chapter("ch-01", "La aguja", "draft", 0, "Ananás y anabolizantes.\n"),
        )
        .unwrap();
        let context = assemble_context(&root, Some("manuscript/ch-01-la-aguja.md")).unwrap();
        assert!(context.codex.is_empty(), "`Ana` must not match inside `Ananás`");

        fs::write(
            root.join("manuscript/ch-01-la-aguja.md"),
            render_chapter("ch-01", "La aguja", "draft", 0, "—¿ANA?— dijo bruno vela.\n"),
        )
        .unwrap();
        let context = assemble_context(&root, Some("manuscript/ch-01-la-aguja.md")).unwrap();
        assert_eq!(
            context.codex.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["Ana", "Bruno Vela"],
            "punctuation is a boundary, case is ignored, and the slug fallback is humanised"
        );
    }

    #[test]
    fn context_without_a_document_still_returns_project_wide_files() {
        let (_dir, root) = fixture();
        let context = assemble_context(&root, None).unwrap();
        assert!(context.document.is_none());
        assert!(context.codex.is_empty());
        assert_eq!(context.style.as_deref(), Some("# Voice\n"));

        fs::remove_file(root.join("style/voice.md")).unwrap();
        fs::remove_file(root.join("plot/outline.md")).unwrap();
        let bare = assemble_context(&root, None).unwrap();
        assert!(bare.style.is_none() && bare.outline.is_none(), "missing files are not errors");
    }

    #[test]
    fn context_rejects_traversal_and_a_missing_project() {
        let (_dir, root) = fixture();
        assert_eq!(assemble_context(&root, Some("../outside.md")).unwrap_err(), "not_found");
        assert_eq!(assemble_context(&root, Some("manuscript/ch-99.md")).unwrap_err(), "not_found");

        let empty = tempfile::tempdir().unwrap();
        assert_eq!(assemble_context(empty.path(), None).unwrap_err(), "not_found");
    }

    #[test]
    fn codex_lists_by_kind_and_gets_by_slug() {
        let (_dir, root) = fixture();
        let all = codex_list(&root, None).unwrap();
        assert_eq!(
            all.iter().map(|c| (c.kind.as_str(), c.name.as_str())).collect::<Vec<_>>(),
            vec![("characters", "Ana"), ("characters", "Bruno Vela"), ("locations", "La Torre")]
        );
        assert_eq!(codex_list(&root, Some("locations")).unwrap().len(), 1);
        assert_eq!(codex_list(&root, Some("dragons")).unwrap_err(), "not_found");

        let entry = codex_get(&root, "bruno-vela").unwrap();
        assert_eq!(entry.kind, "characters");
        assert_eq!(entry.file, "codex/characters/bruno-vela.md");
        assert_eq!(entry.body, "Secundario.\n");
        assert_eq!(codex_get(&root, "nadie").unwrap_err(), "not_found");
        assert_eq!(codex_get(&root, "../../../etc/passwd").unwrap_err(), "not_found");
    }

    #[test]
    fn style_is_read_or_reported_missing() {
        let (_dir, root) = fixture();
        assert_eq!(get_style(&root).unwrap(), "# Voice\n");
        fs::remove_file(root.join("style/voice.md")).unwrap();
        assert_eq!(get_style(&root).unwrap_err(), "not_found");
    }

    fn op(author: &str, kind: &str, from: usize, to: usize, text: &str) -> crate::ops::Op {
        crate::ops::Op {
            seq: 0,
            ts: 0,
            author: author.into(),
            kind: kind.into(),
            from,
            to,
            text: text.into(),
        }
    }

    #[test]
    fn blame_replays_inserts_deletes_and_rollbacks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(history_blame(root, "ch-01", 500).unwrap().is_empty(), "no log yet");

        crate::ops::append_ops(root, "ch-01", "", &[
            op("human", "insert", 0, 11, "Hola mundo."),
            op("ai:claude", "insert", 5, 12, "cruel "),
            op("human", "delete", 0, 5, "Hola "),
        ])
        .unwrap();

        let spans = history_blame(root, "ch-01", 500).unwrap();
        assert_eq!(
            spans.iter().map(|s| (s.author.as_str(), s.text.as_str())).collect::<Vec<_>>(),
            vec![("ai:claude", "cruel "), ("human", "mundo.")]
        );
        assert_eq!((spans[0].from, spans[0].to), (0, 6));
        assert_eq!((spans[1].from, spans[1].to), (6, 12));

        crate::ops::append_ops(root, "ch-01", "", &[op("human", "rollback", 0, 6, "Hola ")]).unwrap();
        let spans = history_blame(root, "ch-01", 500).unwrap();
        assert_eq!(spans.len(), 1, "the rollback re-authors the span as human");
        assert_eq!(spans[0].text, "Hola mundo.");
    }

    #[test]
    fn blame_handles_multibyte_text_and_skips_impossible_ops() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // 🌙 is two UTF-16 units, so the second insert lands after it at 3.
        crate::ops::append_ops(root, "ch-01", "", &[
            op("human", "insert", 0, 3, "a🌙"),
            op("ai:ollama", "insert", 3, 5, "ñb"),
            op("human", "delete", 99, 120, "no existe"),
            op("human", "rollback", 4, 2, "rango invertido"),
        ])
        .unwrap();

        let spans = history_blame(root, "ch-01", 500).unwrap();
        assert_eq!(
            spans.iter().map(|s| (s.author.as_str(), s.text.as_str())).collect::<Vec<_>>(),
            vec![("human", "a🌙"), ("ai:ollama", "ñb")]
        );
        assert_eq!((spans[0].from, spans[0].to), (0, 3), "the emoji occupies two units");
        assert_eq!((spans[1].from, spans[1].to), (3, 5));
    }
}
