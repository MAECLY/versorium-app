//! Commands for the in-process engine.
//!
//! Deliberately thin, and deliberately not on `ModelCard`: a test asserts the
//! card has exactly nineteen fields, and the backend is a property of the
//! machine rather than of a model, so it is asked for separately. That also
//! keeps `store.rs` and the card's serde shape untouched, which is what makes
//! the whole engine removable in one commit.

use crate::llama;

/// Which device the engine will use, and whether it has finished starting.
///
/// Cheap to call repeatedly: after warm-up it reads a cached device list.
#[tauri::command]
pub fn llama_backend() -> llama::runtime::BackendState {
    llama::backend_state()
}

/// Text produced by the running job so far.
///
/// Polled, not pushed. There is no Tauri event anywhere in this codebase, and a
/// download already reports a ten-gigabyte stream this way, so a generation
/// follows the same shape rather than introducing the first `emit`/`listen`
/// pair and a second thing for the E2E mock to imitate.
#[tauri::command]
pub fn llama_progress() -> Option<llama::Progress> {
    llama::progress()
}

/// Stop the running generation. Checked once per token, so closing the rewrite
/// dialog stops the GPU instead of letting it finish into a discarded buffer.
#[tauri::command]
pub fn llama_cancel() {
    llama::cancel();
}

/// Drop the resident model, freeing its memory without quitting.
#[tauri::command]
pub fn llama_unload() -> Result<(), String> {
    llama::unload()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_backend_reports_a_state_the_ui_can_branch_on() {
        let state = llama_backend();
        assert!(
            ["warming", "ready", "failed"].contains(&state.state.as_str()),
            "unexpected backend state: {}",
            state.state
        );
        // A device is only claimed once the engine is actually ready; saying
        // "Metal" while still compiling shaders would be a lie the badge shows
        // for fifteen seconds.
        if state.state != "ready" {
            assert!(state.device.is_none(), "a device was reported before warm-up finished");
        }
    }

    #[test]
    fn asking_to_cancel_when_nothing_runs_is_not_an_error() {
        // The dialog can close at any moment, including after a generation
        // already finished.
        llama_cancel();
        llama_cancel();
    }

    #[test]
    fn progress_is_absent_rather_than_empty_before_anything_has_run() {
        // `None` and "ran but produced nothing" must stay distinguishable: the
        // UI shows a spinner for one and an error for the other.
        if let Some(p) = llama_progress() {
            assert!(!p.model.is_empty(), "a reported job always names its model");
        }
    }
}
