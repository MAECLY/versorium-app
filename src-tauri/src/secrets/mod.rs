//! Credentials in the OS store, not in a JSON file.
//!
//! Two GitHub personal access tokens used to sit in plaintext in
//! `settings.json`: one authorizing update downloads, one for the writer's own
//! novel backup. A file in the app-data directory is readable by anything
//! running as that user and ends up in Time Machine, in `rsync`, and in any
//! folder someone syncs. So they live in Keychain / Credential Manager / Secret
//! Service instead, and the file keeps only whether one exists.
//!
//! ## Three things the platform forces on the design
//!
//! **Every call blocks.** The Linux backend is synchronous over D-Bus and its
//! own docs warn it "may stall the runtime" if called from an async context;
//! macOS and Windows are synchronous too, and a Keychain prompt blocks for as
//! long as somebody stares at it. So nothing here is async, and every caller
//! goes through `spawn_blocking`.
//!
//! **The store may simply not exist.** On headless Linux there is no Secret
//! Service, and `keyring` reports that as `NoDefaultStore` — which reads like a
//! programming error rather than the truth. `store_status()` carries the real
//! cause, so `availability()` asks it once and the UI can explain instead of
//! failing mysteriously.
//!
//! **The token never goes back to the frontend.** It is written once and read
//! only by the Rust that spends it. The old settings round-trip sent it to the
//! webview to prefill a password field, which is a credential crossing a
//! boundary for no reason.

use serde::Serialize;

/// Namespace for every item Versorium owns, matching the bundle identifier so
/// the entries are recognisable in Keychain Access.
const SERVICE: &str = crate::paths::APP_IDENTIFIER;

/// Which credential. Compiled-in names, never taken from the frontend: an
/// arbitrary account string would let a caller read or overwrite items this app
/// did not create.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// Optional. Lets the updater read the app's own releases while the
    /// repository is private, and lifts GitHub's anonymous rate limit; without
    /// it the updater asks anonymously (spec §11, amended 2026-10-03).
    Updates,
    /// The writer's own GitHub, for their novel's private backup.
    Novel,
}

impl Slot {
    pub fn account(self) -> &'static str {
        match self {
            Slot::Updates => "github-updates",
            Slot::Novel => "github-novel",
        }
    }

    /// Parse a name from the frontend. Unknown names are refused rather than
    /// defaulted, so a typo cannot silently read the other credential.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "updates" => Some(Slot::Updates),
            "novel" => Some(Slot::Novel),
            _ => None,
        }
    }
}

/// Stable error codes. No spaces: `errors.ts` keeps only the last word.
pub const NO_STORE: &str = "keyring_unavailable";
pub const LOCKED: &str = "keyring_locked";
pub const FAILED: &str = "keyring_failed";

/// Whether this machine has a usable credential store.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub usable: bool,
    /// An i18n code when it is not usable; never the platform's own prose.
    pub reason: Option<String>,
}

/// Ask the store whether it initialized, without creating an entry.
///
/// Called on its own rather than inferred from a failed read, because
/// `Entry::new` flattens every initialization failure into one variant.
pub fn availability() -> Availability {
    match keyring::Entry::store_status() {
        Ok(()) => Availability { usable: true, reason: None },
        Err(_) => Availability { usable: false, reason: Some(NO_STORE.to_string()) },
    }
}

fn classify(error: &keyring::Error) -> String {
    match error {
        // The store exists but is locked, or a prompt was dismissed. Retryable,
        // and a different sentence from "this system has no store".
        keyring::Error::NoStorageAccess(_) => LOCKED.to_string(),
        keyring::Error::NoDefaultStore => NO_STORE.to_string(),
        _ => FAILED.to_string(),
    }
}

fn entry(slot: Slot) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, slot.account()).map_err(|e| classify(&e))
}

/// The stored token, or `None` when none was ever saved.
///
/// "Not set" is deliberately not an error: a fresh install has no token and
/// must not greet anybody with a failure.
pub fn get(slot: Slot) -> Result<Option<String>, String> {
    match entry(slot)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(classify(&e)),
    }
}

/// Store a token, replacing any previous one. An empty token clears the slot
/// rather than storing nothing under a name that then looks occupied.
pub fn set(slot: Slot, token: &str) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return clear(slot);
    }
    entry(slot)?.set_password(trimmed).map_err(|e| classify(&e))
}

/// Forget a token. Already absent counts as success: the caller asked for it to
/// be gone.
pub fn clear(slot: Slot) -> Result<(), String> {
    match entry(slot)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(classify(&e)),
    }
}

/// Whether a slot holds anything, without reading the value.
pub fn is_set(slot: Slot) -> bool {
    matches!(get(slot), Ok(Some(_)))
}

/// The updates token, wherever it currently lives.
///
/// The credential store first, then the legacy settings field. The fallback is
/// not tidiness: on a machine with no usable store the migration cannot run, and
/// refusing to read the token the writer already saved would break their updater
/// to make a point about where secrets belong.
///
/// Blocking. Callers already on an async thread must wrap it.
pub fn updates_token(store: &crate::commands::settings::SettingsStore) -> Option<String> {
    if let Ok(Some(token)) = get(Slot::Updates) {
        return Some(token);
    }
    store.get().github_updates_token.filter(|t| !t.trim().is_empty())
}

/// Move any token still sitting in `settings.json` into the credential store.
///
/// Runs once, in the background at startup, for the same reason the engine warms
/// up there: a keychain call blocks and can raise a system prompt, and neither
/// belongs on the path that opens the window.
///
/// If there is no usable store the tokens are left exactly where they are.
/// Deleting a credential Versorium cannot re-store would sign the writer out of
/// their own backup to achieve nothing.
pub fn migrate_from_settings(store: &crate::commands::settings::SettingsStore) -> bool {
    if !availability().usable {
        return false;
    }
    let settings = store.get();
    let pending = [
        (Slot::Updates, settings.github_updates_token.clone()),
        (Slot::Novel, settings.github_novel_token.clone()),
    ];
    let mut moved = false;
    for (slot, token) in pending {
        let Some(token) = token.filter(|t| !t.trim().is_empty()) else { continue };
        // Only clear the file once the store has really taken it.
        if set(slot, &token).is_ok() {
            moved = true;
        }
    }
    if moved {
        store.update(|s| {
            s.github_updates_token = None;
            s.github_novel_token = None;
        });
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_names_are_a_closed_set() {
        // An arbitrary account string from the frontend would let a caller read
        // or overwrite items this app never created.
        assert_eq!(Slot::parse("updates"), Some(Slot::Updates));
        assert_eq!(Slot::parse("novel"), Some(Slot::Novel));
        assert_eq!(Slot::parse("github-updates"), None, "the account name is not the slot name");
        assert_eq!(Slot::parse(""), None);
        assert_eq!(Slot::parse("../../other"), None);
    }

    #[test]
    fn the_two_slots_never_share_an_account() {
        // Sharing one would mean signing in for updates also hands over the
        // writer's own GitHub, which is the exact confusion the two-slot design
        // exists to prevent.
        assert_ne!(Slot::Updates.account(), Slot::Novel.account());
        for slot in [Slot::Updates, Slot::Novel] {
            assert!(!slot.account().is_empty(), "the platform rejects an empty account");
        }
        assert!(!SERVICE.is_empty(), "the platform rejects an empty service");
    }

    #[test]
    fn every_error_code_is_one_word() {
        // `errors.ts` does `raw.split(" ").pop()`, so a code containing a space
        // silently becomes only its last word and then resolves to nothing.
        for code in [NO_STORE, LOCKED, FAILED] {
            assert!(!code.contains(' '), "{code} would be truncated by the frontend");
            assert!(code.starts_with("keyring_"), "{code} should be recognisably ours");
        }
    }

    #[test]
    fn a_missing_store_is_told_apart_from_a_locked_one() {
        // These need different sentences: one is "your system cannot do this",
        // the other is "unlock and try again".
        assert_eq!(classify(&keyring::Error::NoDefaultStore), NO_STORE);
        assert_eq!(
            classify(&keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")))),
            LOCKED
        );
        assert_eq!(
            classify(&keyring::Error::PlatformFailure(Box::new(std::io::Error::other("boom")))),
            FAILED
        );
        // `NoEntry` must never reach `classify`: it is "not set", handled above
        // as a successful `None`.
        assert_eq!(classify(&keyring::Error::NoEntry), FAILED);
    }

    #[test]
    fn availability_answers_without_creating_an_entry() {
        // Safe on every platform including a CI runner with no Secret Service,
        // where it must report unusable rather than panicking.
        let status = availability();
        assert_eq!(status.usable, status.reason.is_none());
        if let Some(reason) = status.reason {
            assert_eq!(reason, NO_STORE);
        }
    }

    /// Touches the real credential store, so it is opt-in: a CI runner has no
    /// Secret Service, and on an unsigned macOS build every rebuild changes the
    /// binary's designated requirement and re-prompts.
    #[test]
    #[ignore = "reads and writes this machine's real credential store"]
    fn live_a_token_round_trips_and_can_be_forgotten() {
        if !availability().usable {
            eprintln!("no credential store here: skipped");
            return;
        }
        // The Novel slot, because overwriting Updates would sign the app out of
        // its own updater on a machine somebody is using.
        let slot = Slot::Novel;
        let restore = get(slot).expect("read");

        set(slot, "ghp_test_value_do_not_use").expect("write");
        assert_eq!(get(slot).unwrap().as_deref(), Some("ghp_test_value_do_not_use"));
        assert!(is_set(slot));

        // Empty clears rather than storing a blank that looks occupied.
        set(slot, "   ").expect("clear via empty");
        assert_eq!(get(slot).unwrap(), None);
        assert!(!is_set(slot));

        // Clearing twice is not an error.
        clear(slot).expect("clear");
        clear(slot).expect("clear again");

        if let Some(original) = restore {
            set(slot, &original).expect("put the real token back");
        }
    }
}
