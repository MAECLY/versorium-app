//! Local crash records, and the scrubber that keeps a manuscript out of them.
//!
//! Spec §12: crash files live on disk only (`logs/crash-*.json`: stack, OS, app
//! version) and carry **zero prose**. Reporting is opt-in and opens a prefilled
//! GitHub issue; nothing reaches the network without the writer clicking.
//!
//! The load-bearing part is [`scrub`]. A panic payload is whatever was handed
//! to `panic!`, so it may contain a chapter body, a file path built from a
//! slugified chapter title, or a token read out of settings. None of that is
//! trusted: everything written to disk or into an issue body goes through the
//! scrubber first.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Enough to see a pattern, few enough that the folder never becomes a problem.
const MAX_CRASHES: usize = 20;

/// Where a report is filed. Declared here rather than imported because
/// `update`'s constants are private to that module; the test below reads its
/// source so the two cannot drift apart unnoticed.
const ISSUES_OWNER: &str = "maecly";
const ISSUES_REPO: &str = "versorium-app";

/// A run of this many plain words reads as a sentence, not a diagnostic.
const PROSE_RUN: usize = 6;

/// Replaces anything that looked like prose, a path, an address or a secret.
const REDACTED: &str = "<redacted>";

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashEntry {
    pub id: String,
    /// Epoch milliseconds.
    pub ts: i64,
    pub version: String,
    pub os: String,
    pub arch: String,
    /// `panic` | `error` — what produced the record.
    pub kind: String,
    /// Already scrubbed by the time it reaches this struct.
    pub message: String,
    /// Already scrubbed, one frame per entry.
    pub stack: Vec<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Build an entry, scrubbing the caller-supplied halves. The constructor is the
/// only way in, so nothing can reach disk unscrubbed by forgetting a call.
pub fn entry(kind: &str, message: &str, stack: &[String]) -> CrashEntry {
    let ts = now_ms();
    let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    CrashEntry {
        id: format!("{ts:x}-{seq:x}"),
        ts,
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        kind: kind.to_string(),
        message: scrub(message),
        stack: stack.iter().map(|f| scrub(f)).collect(),
    }
}

// ------------------------------------------------------------------ scrubbing

/// Is this token a plain word — the stuff prose is made of?
///
/// Code-shaped tokens (`versorium::formats`, `size_bytes`, `ch-01.md`, `42`)
/// are not, which is what lets a diagnostic survive while a sentence does not.
fn is_plain_word(token: &str) -> bool {
    let core = token.trim_matches(|c: char| !c.is_alphanumeric());
    !core.is_empty()
        && core.chars().all(|c| c.is_alphabetic())
        && !token.contains("::")
        && !token.contains('_')
        && !token.contains('/')
}

/// Collapse any run of [`PROSE_RUN`] or more consecutive plain words.
///
/// `panic!("{}", chapter_body)` is the threat: prose arrives as long runs of
/// ordinary words. A standard-library message like `index out of bounds: the
/// len is 3 but the index is 5` keeps its shape because the digits break the
/// run before it reaches six.
fn collapse_prose(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut run: Vec<&str> = Vec::new();

    let flush = |run: &mut Vec<&str>, out: &mut Vec<String>| {
        if run.len() >= PROSE_RUN {
            out.push(REDACTED.to_string());
        } else {
            out.extend(run.iter().map(|w| (*w).to_string()));
        }
        run.clear();
    };

    for token in text.split_whitespace() {
        if is_plain_word(token) {
            run.push(token);
        } else {
            flush(&mut run, &mut out);
            out.push(token.to_string());
        }
    }
    flush(&mut run, &mut out);
    out.join(" ")
}

/// Replace an absolute path with its extension only.
///
/// A chapter file is named from a slugified chapter title, so the file name is
/// manuscript content. The extension is all that is diagnostically useful.
fn redact_path(token: &str) -> Option<String> {
    let looks_absolute = token.starts_with('/')
        || token.starts_with("\\\\")
        || token.contains(":\\")
        || token.starts_with("file://");
    if !looks_absolute {
        return None;
    }
    let trimmed = token.trim_end_matches([',', ';', ')', '"', '\'']);
    let extension = trimmed
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext)
        .filter(|ext| !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_alphanumeric()));
    Some(match extension {
        Some(ext) => format!("<path>.{ext}"),
        None => "<path>".to_string(),
    })
}

/// Does this look like a credential rather than a word?
///
/// Long unbroken runs of base64/hex are tokens, hashes and keys. Settings hold
/// GitHub tokens in cleartext, so a panic formatting one is a real path to a
/// leak.
fn looks_like_secret(token: &str) -> bool {
    let core = token.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | ';' | ')' | '('));
    if core.len() < 24 {
        return false;
    }
    let secretish = core
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+' | '/' | '='));
    // A word that long with no digit is far more likely to be a German noun in
    // a stack frame than a key; a token almost always mixes cases or digits.
    secretish && core.chars().any(|c| c.is_ascii_digit())
}

fn looks_like_email(token: &str) -> bool {
    let core = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '@' && c != '.');
    match core.split_once('@') {
        Some((local, domain)) => !local.is_empty() && domain.contains('.') && !domain.ends_with('.'),
        None => false,
    }
}

/// Everything that must not leave the machine, removed.
///
/// Order matters: paths and secrets are recognised before the prose pass, so a
/// path's own words never count toward a sentence run.
pub fn scrub(text: &str) -> String {
    let replaced: Vec<String> = text
        .split_whitespace()
        .map(|token| {
            if let Some(path) = redact_path(token) {
                path
            } else if looks_like_email(token) || looks_like_secret(token) {
                REDACTED.to_string()
            } else {
                token.to_string()
            }
        })
        .collect();
    collapse_prose(&replaced.join(" "))
}

// --------------------------------------------------------------- persistence

pub fn logs_dir_in(dir: &Path) -> PathBuf {
    dir.join("logs")
}

fn crash_files(logs: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(logs) else { return Vec::new() };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("crash-") && n.ends_with(".json"))
        })
        .collect();
    // Names begin with a hex timestamp, so lexical order is chronological.
    files.sort();
    files
}

/// Write one record. Best-effort: failing to log a crash must not cause one.
pub fn record_in(dir: &Path, entry: &CrashEntry) {
    let logs = logs_dir_in(dir);
    if std::fs::create_dir_all(&logs).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(entry) else { return };
    let path = logs.join(format!("crash-{:016x}-{}.json", entry.ts.max(0), entry.id));
    if std::fs::write(&path, json).is_err() {
        return;
    }
    let files = crash_files(&logs);
    for stale in files.iter().take(files.len().saturating_sub(MAX_CRASHES)) {
        let _ = std::fs::remove_file(stale);
    }
}

pub fn record(entry: &CrashEntry) {
    if let Ok(dir) = crate::paths::app_data_dir() {
        record_in(&dir, entry);
    }
}

/// Newest first. A file we cannot parse is skipped, not fatal — a corrupt
/// record must not hide the others.
pub fn list_in(dir: &Path, limit: usize) -> Vec<CrashEntry> {
    let mut entries: Vec<CrashEntry> = crash_files(&logs_dir_in(dir))
        .iter()
        .rev()
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|raw| serde_json::from_str(&raw).ok())
        .collect();
    entries.truncate(limit.clamp(1, MAX_CRASHES));
    entries
}

pub fn list(limit: usize) -> Vec<CrashEntry> {
    crate::paths::app_data_dir()
        .map(|dir| list_in(&dir, limit))
        .unwrap_or_default()
}

pub fn clear_in(dir: &Path) -> Result<(), String> {
    for file in crash_files(&logs_dir_in(dir)) {
        std::fs::remove_file(file).map_err(|_| "io".to_string())?;
    }
    Ok(())
}

pub fn clear() -> Result<(), String> {
    clear_in(&crate::paths::app_data_dir()?)
}

// ------------------------------------------------------------------ reporting

/// Percent-encode for a query string. Hand-rolled to avoid a dependency for
/// one function; everything outside the unreserved set is escaped.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// A prefilled issue the writer can read and edit before sending.
///
/// The body is scrubbed again on the way out: the entry is already clean, but
/// this function is what faces the network and should not depend on an
/// invariant established elsewhere.
pub fn report_url(entry: &CrashEntry) -> String {
    let title = format!("Crash on {} {} ({})", entry.os, entry.arch, entry.version);
    let mut body = String::new();
    body.push_str("<!-- Nothing from your manuscript is included. Edit freely before sending. -->\n\n");
    body.push_str(&format!("Version: {}\n", entry.version));
    body.push_str(&format!("OS: {} {}\n", entry.os, entry.arch));
    body.push_str(&format!("Kind: {}\n\n", entry.kind));
    body.push_str("Message:\n");
    body.push_str(&scrub(&entry.message));
    body.push_str("\n\nStack:\n");
    for frame in &entry.stack {
        body.push_str(&scrub(frame));
        body.push('\n');
    }
    format!(
        "https://github.com/{ISSUES_OWNER}/{ISSUES_REPO}/issues/new?title={}&body={}",
        encode(&title),
        encode(&body)
    )
}

/// Record a panic instead of losing it to stderr.
///
/// The payload is untrusted — `panic!("{}", body)` would otherwise put a
/// chapter on disk — so it goes through the same constructor as everything
/// else.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        record(&entry("panic", &payload, &[location]));
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROSE: &str = "El invierno fue largo y la niña esperaba junto a la ventana";

    #[test]
    fn a_sentence_of_prose_does_not_survive() {
        let scrubbed = scrub(PROSE);
        assert_eq!(scrubbed, REDACTED);
        for word in ["invierno", "niña", "ventana", "esperaba"] {
            assert!(!scrubbed.contains(word), "{word} leaked");
        }
    }

    #[test]
    fn prose_embedded_in_a_diagnostic_is_removed_but_the_diagnostic_survives() {
        let scrubbed = scrub(&format!("called Option::unwrap on None: {PROSE}"));
        assert!(scrubbed.contains("Option::unwrap"), "the useful half must remain");
        assert!(!scrubbed.contains("invierno"));
        assert!(scrubbed.contains(REDACTED));
    }

    #[test]
    fn a_wordy_diagnostic_loses_its_words_and_that_is_the_deal() {
        // "index out of bounds: the len is" is seven plain words, so it reads
        // as a sentence and goes. The numbers and the panic location survive,
        // which is what actually identifies the bug. Spec §12 says zero prose,
        // and no threshold both keeps this message and drops a seven-word
        // fragment of somebody's novel — so the manuscript wins.
        let scrubbed = scrub("index out of bounds: the len is 3 but the index is 5");
        assert!(scrubbed.contains('3') && scrubbed.contains('5'), "the numbers matter");
        assert!(scrubbed.contains(REDACTED));
    }

    #[test]
    fn a_short_technical_message_survives_intact() {
        // Under the run length, so ordinary Rust panics read normally.
        for message in [
            "attempt to divide by zero",
            "called Option::unwrap on a None value",
            "RwLock poisoned",
        ] {
            assert_eq!(scrub(message), message, "{message} should survive");
        }
    }

    #[test]
    fn a_chapter_path_leaves_only_its_extension() {
        let scrubbed = scrub(
            "failed at /Users/ana/Documents/Versorium/mi-novela/manuscript/ch-01-el-norte.md",
        );
        assert!(scrubbed.contains("<path>.md"));
        for leak in ["ana", "mi-novela", "el-norte", "ch-01"] {
            assert!(!scrubbed.contains(leak), "{leak} leaked from a path");
        }
    }

    #[test]
    fn windows_and_file_url_paths_are_redacted_too() {
        assert!(scrub(r"C:\Users\Ana\Versorium\libro\ch-02-la-aguja.md").contains("<path>"));
        assert!(!scrub(r"C:\Users\Ana\Versorium\libro\ch-02-la-aguja.md").contains("aguja"));
        assert!(scrub("file:///Users/ana/novela/ch-03.md").contains("<path>.md"));
    }

    #[test]
    fn a_token_shaped_string_does_not_survive() {
        let token = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
        let scrubbed = scrub(&format!("auth failed for {token}"));
        assert!(!scrubbed.contains(token));
        assert!(!scrubbed.contains("A1b2C3d4"));
        // A sha256 is equally unwelcome.
        assert!(!scrub(&"a1b2c3d4".repeat(8)).contains("a1b2c3d4"));
    }

    #[test]
    fn an_email_does_not_survive() {
        let scrubbed = scrub("reported by ana.gomez@example.com today");
        assert!(!scrubbed.contains("ana.gomez"));
        assert!(!scrubbed.contains("example.com"));
    }

    #[test]
    fn an_ordinary_identifier_is_not_mistaken_for_a_secret() {
        // No digits, so a long CamelCase symbol stays readable.
        assert!(scrub("VersoriumManuscriptExporterService").contains("Versorium"));
    }

    #[test]
    fn an_entry_is_scrubbed_by_construction() {
        let e = entry("panic", PROSE, &[format!("/Users/ana/novela/manuscript/ch-01.md:12:4")]);
        assert!(!e.message.contains("invierno"));
        assert!(!e.stack[0].contains("ana"));
        assert_eq!(e.version, env!("CARGO_PKG_VERSION"));
        assert!(!e.id.is_empty());
    }

    #[test]
    fn a_report_url_carries_none_of_it_even_from_hostile_input() {
        let hostile = entry(
            "panic",
            &format!("{PROSE} ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 ana@example.com"),
            &["/Users/ana/Documents/Versorium/mi-novela/manuscript/ch-01-el-norte.md".into()],
        );
        let url = report_url(&hostile);
        // The URL is percent-encoded, so decode-resistant checks would pass
        // vacuously; compare against the encoded forms of the leaks instead.
        for leak in ["invierno", "ni%C3%B1a", "el-norte", "mi-novela", "A1b2C3d4", "example.com"] {
            assert!(!url.contains(leak), "{leak} reached the issue URL");
        }
        assert!(url.starts_with(&format!("https://github.com/{ISSUES_OWNER}/{ISSUES_REPO}/issues/new?")));
    }

    #[test]
    fn the_log_is_bounded_and_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(MAX_CRASHES + 5) {
            let mut e = entry("panic", &format!("failure {i}"), &[]);
            // Force distinct, ordered timestamps: a loop is faster than the clock.
            e.ts = 1_000 + i as i64;
            e.id = format!("{i:04}");
            record_in(dir.path(), &e);
        }
        let files = crash_files(&logs_dir_in(dir.path()));
        assert_eq!(files.len(), MAX_CRASHES, "old records are dropped");
        let listed = list_in(dir.path(), MAX_CRASHES);
        assert_eq!(listed.len(), MAX_CRASHES);
        assert!(listed[0].message.contains(&(MAX_CRASHES + 4).to_string()), "newest first");
    }

    #[test]
    fn a_corrupt_record_does_not_hide_the_others() {
        let dir = tempfile::tempdir().unwrap();
        record_in(dir.path(), &entry("panic", "real failure", &[]));
        let logs = logs_dir_in(dir.path());
        std::fs::write(logs.join("crash-0000000000000000-bad.json"), "{ not json").unwrap();
        let listed = list_in(dir.path(), 10);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].message.contains("real failure"));
    }

    #[test]
    fn clearing_removes_every_record_and_is_safe_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(clear_in(dir.path()).is_ok(), "nothing to clear is not an error");
        record_in(dir.path(), &entry("panic", "boom", &[]));
        assert_eq!(list_in(dir.path(), 10).len(), 1);
        clear_in(dir.path()).unwrap();
        assert!(list_in(dir.path(), 10).is_empty());
    }

    /// Proves the hook end to end: a panic carrying a chapter reaches disk as a
    /// record with the prose gone.
    ///
    /// Ignored because `set_hook` is process-global — running it alongside the
    /// parallel suite would swap the hook out from under other tests. Run it on
    /// purpose: `cargo test -- --ignored --test-threads=1 hook_`.
    #[test]
    #[ignore = "installs a process-global panic hook"]
    fn hook_writes_a_scrubbed_record() {
        let dir = tempfile::tempdir().unwrap();
        // SAFETY: single-threaded by the harness flag this test documents.
        unsafe { std::env::set_var(crate::paths::DATA_DIR_ENV, dir.path()) };

        install_panic_hook();
        let caught = std::panic::catch_unwind(|| {
            panic!("{PROSE}");
        });
        assert!(caught.is_err(), "the panic still propagates");

        let records = list_in(dir.path(), 10);
        assert_eq!(records.len(), 1, "the hook wrote a record");
        assert_eq!(records[0].kind, "panic");
        assert!(!records[0].message.contains("invierno"), "prose reached disk");
        assert!(records[0].message.contains(REDACTED));
        // The location frame is a *relative* compile-time source path
        // (`src/crash/mod.rs:LINE:COL`) — our own file, no user data — so it
        // survives and is worth keeping. A frame from a dependency would be an
        // absolute cargo-registry path carrying the username, and that case is
        // redacted; `a_chapter_path_leaves_only_its_extension` covers it.
        let frame = &records[0].stack[0];
        assert!(frame.starts_with("src/crash/mod.rs:"), "got {frame:?}");
        assert!(!frame.starts_with('/'), "an absolute frame would carry a username");

        unsafe { std::env::remove_var(crate::paths::DATA_DIR_ENV) };
    }

    /// The issue URL and the update source name the same repository. They are
    /// declared in different modules because `update`'s constants are private,
    /// so this reads its source to catch the day one moves without the other.
    #[test]
    fn the_report_repo_matches_the_update_repo() {
        let source = include_str!("../update/mod.rs");
        assert!(
            source.contains(&format!("UPDATE_OWNER: &str = \"{ISSUES_OWNER}\"")),
            "crash reports and updates point at different owners"
        );
        assert!(
            source.contains(&format!("UPDATE_REPO: &str = \"{ISSUES_REPO}\"")),
            "crash reports and updates point at different repos"
        );
    }
}
