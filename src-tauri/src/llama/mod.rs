//! In-process llama.cpp: the engine a `builtin` slot needs.
//!
//! Spec §6.2 asks for llama.cpp embedded, the active backend shown on Ready, and
//! one heavy inference at a time. This module is the whole of that, minus the
//! parts named honestly in STATUS.md: Metal and CPU work; CUDA and Vulkan are
//! not built from the current release matrix.
//!
//! **Why a dedicated thread rather than `spawn_blocking`.** `LlamaModel` is
//! `Send + Sync`, but `LlamaContext<'a>` borrows the model and is neither, and
//! `LlamaBatch` is neither. So a context cannot live in Tauri's `State<T>` and
//! cannot cross an await point. One owning thread, fed by a channel, is the
//! only shape that compiles without lying to the borrow checker.

pub mod devices;
pub mod fit;
pub mod runtime;

pub use devices::Backend;
pub use runtime::{backend_state, cancel, is_busy, progress, unload, warm_up, Progress};

use crate::models::{catalog, hardware, store};
use std::path::PathBuf;

/// Everything needed to run a catalog model, gathered before any weights are
/// touched so a refusal costs nothing.
#[derive(Debug)]
struct Resolved {
    path: PathBuf,
    ctx: u32,
}

/// Turn a slot's catalog id into a loadable model, or say why not.
///
/// Refusals are ordered by what the writer can act on: an unknown id is a bug,
/// an unfinished download is a download, and a model too large for the machine
/// is a choice — each gets its own code rather than one "could not load".
fn resolve(id: &str) -> Result<Resolved, String> {
    let entry = catalog::find(id).ok_or_else(|| "not_found".to_string())?;
    let dir = store::models_dir()?;
    if store::state_of_in(&dir, entry) != store::ModelState::Ready {
        return Err("not_ready".to_string());
    }
    let machine = hardware::probe();
    let ctx = fit::plan(entry.ram_hint_gb, machine.total_ram_gb, entry.ctx)?;
    Ok(Resolved { path: store::model_path_in(&dir, id), ctx })
}

/// Run a prompt through a downloaded model.
///
/// Blocking, like the CLI harnesses it sits beside in `agents::rewrite`; the
/// caller is already inside `spawn_blocking`.
pub fn generate(id: &str, prompt: &str) -> Result<String, String> {
    let resolved = resolve(id)?;
    let answer = runtime::generate(id, &resolved.path, resolved.ctx, prompt, runtime::MAX_TOKENS)?;
    let cleaned = runtime::strip_reasoning(&answer);
    if cleaned.is_empty() {
        // A model that answered only with reasoning has said nothing usable, and
        // splicing an empty string into a chapter would delete the passage.
        return Err("ai_empty".to_string());
    }
    Ok(cleaned)
}

/// Run a prompt, refusing rather than waiting when the engine is busy.
///
/// For background work: a continuity pass must never sit in front of a writer's
/// rewrite, and a 27B model can take minutes.
pub fn generate_if_free(id: &str, prompt: &str) -> Result<String, String> {
    if is_busy() {
        return Err(runtime::BUSY.to_string());
    }
    generate(id, prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_model_is_not_found_rather_than_a_load_failure() {
        // Each refusal names something different to do about it, so they must
        // not collapse into one code.
        assert_eq!(resolve("no-such-model").unwrap_err(), "not_found");
    }

    #[test]
    fn a_catalog_model_that_was_never_downloaded_says_so() {
        // Every shipped entry is absent on a machine that has downloaded
        // nothing, so this holds in CI and says `not_ready`, not `not_found`.
        let catalog = catalog::catalog().expect("the shipped catalog loads");
        let entry = catalog.models.first().expect("a populated catalog");
        let dir = store::models_dir().expect("a models dir path");
        if store::state_of_in(&dir, entry) == store::ModelState::Ready {
            eprintln!("{} is downloaded on this machine: skipped", entry.id);
            return;
        }
        assert_eq!(resolve(&entry.id).unwrap_err(), "not_ready");
    }
}
