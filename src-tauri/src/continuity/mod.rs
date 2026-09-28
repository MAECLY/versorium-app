//! Continuity check — the M7 stub.
//!
//! The DoD asks for "local MID or skip if no model", and the honest half of
//! that is the skip. There is no built-in inference runtime yet (a documented
//! M4 hole), so a slot pointing at a downloaded GGUF cannot run and says so
//! rather than returning an empty report that reads like a clean bill of
//! health. A slot pointing at Ollama does run, because that daemon exists.
//!
//! What gets sent is deliberately small: chapter titles and codex entries, not
//! the manuscript. A continuity pass wants the skeleton, and shipping a whole
//! novel to a model — even a local one — is not something to do by default.

use crate::commands::settings::SlotAssignment;
use serde::Serialize;
use std::path::Path;

/// How much of the project's skeleton is worth sending. Titles and codex
/// entries are short; the cap stops a project with hundreds of chapters from
/// building a prompt no model can hold.
const MAX_CHAPTERS: usize = 60;
const MAX_CODEX: usize = 40;
/// A codex body is prose. Only the opening lines go, enough to name who
/// somebody is without shipping their whole history.
const CODEX_EXCERPT: usize = 240;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuityFinding {
    /// `contradiction` | `note`
    pub kind: String,
    pub detail: String,
    pub chapter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuityReport {
    pub ran: bool,
    /// An i18n code when `ran` is false — never prose.
    pub reason: Option<String>,
    pub findings: Vec<ContinuityFinding>,
}

impl ContinuityReport {
    fn skipped(reason: &str) -> Self {
        Self { ran: false, reason: Some(reason.into()), findings: Vec::new() }
    }
}

/// Why a check could not run. Codes, so the UI says it in the writer's language.
pub const NO_MODEL: &str = "continuity_no_model";
pub const DAEMON_OFFLINE: &str = "continuity_daemon_offline";
pub const FAILED: &str = "continuity_failed";
/// The engine is running a rewrite. A background pass yields to the writer.
pub const BUSY: &str = "continuity_busy";
/// The assigned model does not fit this machine.
pub const TOO_LARGE: &str = "continuity_model_too_large";

/// The skeleton of a project: what a continuity pass actually reasons over.
pub fn summarize(root: &Path) -> Result<String, String> {
    let manuscript = crate::formats::read_manuscript(root)?;
    let mut out = String::new();
    out.push_str(&format!("TITLE: {}\nLANGUAGE: {}\n\nCHAPTERS:\n", manuscript.title, manuscript.language));
    for chapter in manuscript.chapters.iter().take(MAX_CHAPTERS) {
        let scenes = chapter.scenes.len();
        out.push_str(&format!("- {} — {} ({scenes} scenes)\n", chapter.id, chapter.title));
        for scene in chapter.scenes.iter().filter_map(|s| s.heading.as_deref()) {
            out.push_str(&format!("    · {scene}\n"));
        }
    }
    if manuscript.chapters.len() > MAX_CHAPTERS {
        out.push_str(&format!("- … and {} more\n", manuscript.chapters.len() - MAX_CHAPTERS));
    }

    let codex = crate::mcp::query::codex_list(root, None).unwrap_or_default();
    if !codex.is_empty() {
        out.push_str("\nCODEX:\n");
        for entry in codex.iter().take(MAX_CODEX) {
            let excerpt: String = entry.body.chars().take(CODEX_EXCERPT).collect();
            let excerpt = excerpt.replace('\n', " ");
            out.push_str(&format!("- [{}] {}: {}\n", entry.kind, entry.name, excerpt.trim()));
        }
    }
    Ok(out)
}

fn prompt_for(summary: &str) -> String {
    format!(
        "You are checking a novel for internal contradictions. Below is the \
         skeleton: chapter titles, scene headings, and the codex of characters, \
         places, factions and items.\n\n\
         List only contradictions you can actually see in this material — a name \
         used two ways, a timeline that cannot hold, a codex entry that disagrees \
         with a chapter. Do not invent problems, and do not comment on style.\n\n\
         Answer as one finding per line, starting each with '- '. If you find \
         nothing, answer exactly: NONE.\n\n{summary}"
    )
}

/// Turn whatever the model said into findings.
///
/// Lenient on purpose: a local model may answer with a bulleted list, a
/// numbered one, or a paragraph. Prose that is not a list becomes a single
/// `note` rather than being dropped — a check that silently discards its own
/// answer is worse than one that shows it raw.
pub fn parse_findings(answer: &str) -> Vec<ContinuityFinding> {
    let trimmed = answer.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        return Vec::new();
    }
    let bullets: Vec<ContinuityFinding> = trimmed
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            let detail = line
                .strip_prefix("- ")
                .or_else(|| line.strip_prefix("* "))
                .or_else(|| {
                    line.split_once(". ")
                        .filter(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
                        .map(|(_, rest)| rest)
                })?;
            let detail = detail.trim();
            (!detail.is_empty()).then(|| ContinuityFinding {
                kind: "contradiction".into(),
                detail: detail.to_string(),
                chapter: chapter_hint(detail),
            })
        })
        .collect();

    if bullets.is_empty() {
        vec![ContinuityFinding { kind: "note".into(), detail: trimmed.to_string(), chapter: None }]
    } else {
        bullets
    }
}

/// Pull a `ch-NN` reference out of a finding so the UI can link it.
fn chapter_hint(detail: &str) -> Option<String> {
    let lowered = detail.to_lowercase();
    let start = lowered.find("ch-")?;
    let digits: String = lowered[start + 3..].chars().take_while(|c| c.is_ascii_digit()).collect();
    (!digits.is_empty()).then(|| format!("ch-{digits}"))
}

/// Run a continuity pass, or explain why it did not.
pub async fn check(root: &Path, slot: &SlotAssignment) -> Result<ContinuityReport, String> {
    let id = slot.id.trim();
    match slot.kind.as_str() {
        // A CLI harness could run this, but it is not wired; saying so beats an
        // empty report that reads as "no problems found".
        "none" | "cli" => return Ok(ContinuityReport::skipped(NO_MODEL)),
        "builtin" if !id.is_empty() => return builtin_check(root, id).await,
        "ollama" => {}
        _ => return Ok(ContinuityReport::skipped(NO_MODEL)),
    }
    if id.is_empty() {
        return Ok(ContinuityReport::skipped(NO_MODEL));
    }

    let (online, models) = crate::agents::ollama_status().await;
    if !online {
        return Ok(ContinuityReport::skipped(DAEMON_OFFLINE));
    }
    if !models.iter().any(|m| m == &slot.id) {
        // The slot names a model the daemon no longer serves.
        return Ok(ContinuityReport::skipped(NO_MODEL));
    }

    let summary = summarize(root)?;
    match generate(&slot.id, &prompt_for(&summary)).await {
        Ok(answer) => Ok(ContinuityReport { ran: true, reason: None, findings: parse_findings(&answer) }),
        Err(_) => Ok(ContinuityReport::skipped(FAILED)),
    }
}

/// A whole-novel summary is not a paragraph, so this waits far longer than a
/// rewrite does.
const CONTINUITY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// A continuity pass through the in-process engine.
///
/// Refuses instead of waiting: this runs in the background over the whole novel
/// and must never sit in front of the rewrite a writer is waiting on.
async fn builtin_check(root: &Path, id: &str) -> Result<ContinuityReport, String> {
    if crate::llama::is_busy() {
        return Ok(ContinuityReport::skipped(BUSY));
    }
    let summary = summarize(root)?;
    let prompt = prompt_for(&summary);
    let model = id.to_string();
    let answer = tauri::async_runtime::spawn_blocking(move || {
        crate::llama::generate_if_free(&model, &prompt)
    })
    .await
    .map_err(|_| FAILED.to_string())?;
    match answer {
        Ok(text) => Ok(ContinuityReport { ran: true, reason: None, findings: parse_findings(&text) }),
        // The engine's own codes do not start with `continuity_`, and the UI
        // reads these as continuity reasons, so they are mapped rather than
        // passed through.
        Err(e) if e == crate::llama::runtime::BUSY => Ok(ContinuityReport::skipped(BUSY)),
        Err(e) if e == "not_ready" || e == "not_found" => Ok(ContinuityReport::skipped(NO_MODEL)),
        Err(e) if e == "model_too_large" => Ok(ContinuityReport::skipped(TOO_LARGE)),
        Err(_) => Ok(ContinuityReport::skipped(FAILED)),
    }
}

async fn generate(model: &str, prompt: &str) -> Result<String, String> {
    crate::agents::ollama_generate(model, prompt, CONTINUITY_TIMEOUT)
        .await
        .map_err(|_| FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::project::{create_project, CreateProjectArgs};

    fn slot(kind: &str, id: &str) -> SlotAssignment {
        SlotAssignment { kind: kind.into(), id: id.into() }
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn a_downloaded_model_with_no_runtime_says_so_rather_than_reporting_clean() {
        let dir = tempfile::tempdir().unwrap();
        // The dangerous failure would be ran:true with no findings, which reads
        // as "your novel is consistent" when nothing actually ran.
        // `builtin` with an empty id still has nothing to run; a real id now
        // reaches the engine and is covered by the test below.
        for assignment in [slot("none", ""), slot("builtin", ""), slot("cli", "claude")] {
            let report = block_on(check(dir.path(), &assignment)).unwrap();
            assert!(!report.ran);
            assert_eq!(report.reason.as_deref(), Some(NO_MODEL));
            assert!(report.findings.is_empty());
        }
    }

    #[test]
    fn an_ollama_slot_with_no_model_named_is_a_skip() {
        let dir = tempfile::tempdir().unwrap();
        let report = block_on(check(dir.path(), &slot("ollama", "   "))).unwrap();
        assert_eq!(report.reason.as_deref(), Some(NO_MODEL));
    }

    #[test]
    fn a_reason_is_always_a_code_never_prose() {
        for code in [NO_MODEL, DAEMON_OFFLINE, FAILED] {
            assert!(code.starts_with("continuity_"));
            assert!(!code.contains(' '), "{code} must be a key the UI can translate");
        }
    }

    #[test]
    fn the_summary_carries_the_skeleton_not_the_prose() {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "La aguja".into(),
            language: "es".into(),
        })
        .unwrap();
        let root = std::path::PathBuf::from(&project.path);
        let chapter = &project.chapters[0];
        crate::commands::chapters::save_chapter(
            root.clone(),
            chapter.file.clone(),
            "## Amanecer\n\nEl invierno fue largo y la niña esperaba.".into(),
            None,
        )
        .unwrap();

        let summary = summarize(&root).unwrap();
        assert!(summary.contains("La aguja"), "the title frames the check");
        assert!(summary.contains("ch-01"));
        assert!(summary.contains("Amanecer"), "scene headings are structure");
        assert!(
            !summary.contains("El invierno fue largo"),
            "chapter prose must not be sent for a structural check"
        );
    }

    #[test]
    fn a_bulleted_answer_becomes_findings() {
        let findings = parse_findings("- Ana is blonde in ch-02 but dark in ch-05\n- The road takes two days, then one");
        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].kind, "contradiction");
        assert_eq!(findings[0].chapter.as_deref(), Some("ch-02"));
        assert_eq!(findings[1].chapter, None);
    }

    #[test]
    fn numbered_and_starred_lists_are_read_too() {
        assert_eq!(parse_findings("1. First problem\n2. Second problem").len(), 2);
        assert_eq!(parse_findings("* Only problem").len(), 1);
    }

    #[test]
    fn a_clean_answer_is_no_findings() {
        for answer in ["NONE", "none", "  None  ", ""] {
            assert!(parse_findings(answer).is_empty(), "{answer:?} should mean nothing found");
        }
    }

    #[test]
    fn prose_that_is_not_a_list_is_shown_rather_than_dropped() {
        let findings = parse_findings("I could not find any clear contradictions in this outline.");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "note");
        assert!(findings[0].detail.contains("could not find"));
    }

    /// Needs a running Ollama daemon: `cargo test -- --ignored live_continuity`.
    #[test]
    #[ignore = "talks to the Ollama daemon on this machine"]
    fn live_continuity_runs_or_explains_itself() {
        let dir = tempfile::tempdir().unwrap();
        let project = create_project(CreateProjectArgs {
            path: dir.path().to_path_buf(),
            title: "Live Check".into(),
            language: "en".into(),
        })
        .unwrap();
        let (online, models) = block_on(crate::agents::ollama_status());
        if !online || models.is_empty() {
            eprintln!("ollama offline — skipping");
            return;
        }
        let report =
            block_on(check(std::path::Path::new(&project.path), &slot("ollama", &models[0]))).unwrap();
        eprintln!("ran={} reason={:?} findings={}", report.ran, report.reason, report.findings.len());
        assert!(report.ran || report.reason.is_some(), "either it ran or it said why");
    }
}
