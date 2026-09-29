//! Whether this machine can hold a model, and how much context to ask for.
//!
//! Two decisions, both made before any weights are read, because the failure
//! this guards against is not an error message: a 17 GB model on a 16 GB
//! machine does not return `Err`, it swaps until the editor stops responding or
//! the OS kills the process. Refusing early is the only honest outcome.
//!
//! **What this deliberately does not do:** trade context length for memory. The
//! catalogue gives one number per entry, `ramHintGB`, measured for that entry at
//! its stated context. It is not decomposed into weights versus KV cache, so
//! any "halve the context to fit" rule would be arithmetic on a number that
//! cannot support it. A wrong guess here costs a swapping machine, so the
//! answer is yes or no, and the context is clamped only against limits the
//! model itself reports.

use crate::models::hardware;

/// Asking for less than this is not worth loading a model for: a rewrite needs
/// the passage, the instructions and the answer to coexist.
///
/// It also has to beat llama.cpp's own 512-token default, which would cut a
/// selected passage off mid-sentence with no error at all.
pub const MIN_CONTEXT: u32 = 2048;

/// Why a model will not be loaded. Stable codes; the UI translates them.
pub const TOO_LARGE: &str = "model_too_large";

/// Can this machine hold the model at all?
///
/// Delegates to the one definition of the margin so a refusal here and the
/// card's "fits" badge can never disagree.
pub fn fits(ram_hint_gb: f32, total_ram_gb: f32) -> bool {
    hardware::fits(ram_hint_gb, total_ram_gb)
}

/// What the writer would need, in GB. Used by the tests below to state the
/// refusal boundary in the same units the model card shows.
#[cfg(test)]
fn required_gb(ram_hint_gb: f32) -> f32 {
    ram_hint_gb * hardware::HEADROOM
}

/// The context length to request.
///
/// Three ceilings, lowest wins: what the catalogue advertises, what the model
/// was trained for, and — only when a model reports nothing — a floor so a
/// misreported model does not silently get llama.cpp's 512-token default, which
/// would truncate the passage mid-sentence.
pub fn context_for(catalog_ctx: u32, n_ctx_train: u32) -> u32 {
    let advertised = if catalog_ctx == 0 { u32::MAX } else { catalog_ctx };
    let trained = if n_ctx_train == 0 { u32::MAX } else { n_ctx_train };
    match advertised.min(trained) {
        u32::MAX => MIN_CONTEXT,
        both => both.max(MIN_CONTEXT),
    }
}

/// The whole pre-load decision: refuse with a reason, or say what to ask for.
///
/// `n_ctx_train` is not known until the model is open, so callers pass 0 before
/// the load and re-clamp with `context_for` afterwards.
pub fn plan(ram_hint_gb: f32, total_ram_gb: f32, catalog_ctx: u32) -> Result<u32, String> {
    if !fits(ram_hint_gb, total_ram_gb) {
        return Err(TOO_LARGE.to_string());
    }
    Ok(context_for(catalog_ctx, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_margin_is_the_same_one_the_card_badge_uses() {
        // If these ever diverge, a card says a model fits and loading it
        // refuses — the worst combination, because the writer already
        // downloaded gigabytes on the card's word.
        for (hint, total) in [(2.0, 4.0), (4.0, 4.8), (4.0, 4.79), (20.0, 36.0), (20.0, 16.0)] {
            assert_eq!(
                fits(hint, total),
                hardware::fits(hint, total),
                "fit rule drifted for hint={hint} total={total}"
            );
        }
    }

    #[test]
    fn a_model_that_needs_more_than_the_machine_has_is_refused_not_attempted() {
        // The catalogue's high tier against a 16 GB machine. This must never
        // become "load it and hope": it swaps rather than failing.
        assert_eq!(plan(20.0, 16.0, 32768).unwrap_err(), TOO_LARGE);
        // And the boundary: 20 GB needs 24 GB with the margin.
        assert_eq!(plan(20.0, 23.9, 32768).unwrap_err(), TOO_LARGE);
        assert!(plan(20.0, 24.0, 32768).is_ok());
    }

    #[test]
    fn the_refusal_says_how_much_would_be_needed() {
        // "not enough memory" is unactionable; a number lets someone decide
        // whether to close Chrome or pick a smaller model.
        assert!((required_gb(20.0) - 24.0).abs() < 0.001);
        assert!((required_gb(3.5) - 4.2).abs() < 0.001);
    }

    #[test]
    fn the_catalog_context_is_a_ceiling_and_so_is_what_the_model_was_trained_for() {
        // A model trained at 8k must not be asked for the catalogue's 32k.
        assert_eq!(context_for(32768, 8192), 8192);
        // And the catalogue may be the tighter of the two.
        assert_eq!(context_for(16384, 32768), 16384);
        assert_eq!(context_for(32768, 32768), 32768);
    }

    #[test]
    fn an_unreported_limit_does_not_collapse_to_llama_cpps_512_default() {
        // `LlamaContextParams::default()` is 512 tokens. Falling through to it
        // would cut a selected passage off mid-sentence with no error at all.
        assert_eq!(context_for(0, 0), MIN_CONTEXT);
        assert_eq!(context_for(0, 8192), 8192);
        assert_eq!(context_for(8192, 0), 8192);
        // A model claiming something absurdly small is lifted to the floor.
        assert_eq!(context_for(128, 128), MIN_CONTEXT);
    }

    #[test]
    fn every_shipped_catalog_entry_has_a_usable_plan_on_a_machine_that_fits_it() {
        // Guards against a catalogue edit that would make an entry unloadable
        // even on a machine with room for it.
        let catalog = crate::models::catalog::catalog().expect("the shipped catalog loads");
        for entry in &catalog.models {
            let generous = required_gb(entry.ram_hint_gb) + 1.0;
            let ctx = plan(entry.ram_hint_gb, generous, entry.ctx)
                .unwrap_or_else(|e| panic!("{} is unloadable on a machine with room: {e}", entry.id));
            assert!(ctx >= MIN_CONTEXT, "{} planned a context below the floor", entry.id);
            assert!(ctx <= entry.ctx, "{} planned more context than it advertises", entry.id);
        }
    }
}
