//! Whether this computer can run local AI on its GPU, on its processor, or
//! not at all, and what it would need. See `classify` for the rules.
//!
//! The engine (llama.cpp) starts only after a check: on Windows and Linux
//! its Vulkan backend opens the Vulkan loader as it starts, and a computer
//! without one would crash there. The check runs the probe in a process of
//! its own (`child`), lists the OS's adapters (`adapters`), and keeps the
//! answer here for the engine's gate, Settings and the status modal. "Check
//! again" runs it anew; the engine has not started on a refusal, so a check
//! that now passes starts it without restarting the app.

pub mod adapters;
pub mod child;
pub mod classify;
pub mod probe;
pub mod vendor;

use classify::{Facts, ProbeOutcome, Readiness};
use std::sync::RwLock;

static READINESS: RwLock<Option<Readiness>> = RwLock::new(None);

/// Error codes the engine's callers can show.
pub const CHECKING: &str = "gpu_checking";
pub const UNAVAILABLE: &str = "gpu_unavailable";

/// The engine is built on Vulkan here, so a check stands before it.
pub fn needs_check() -> bool {
    !cfg!(target_os = "macos") && cfg!(feature = "vulkan")
}

fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Look at this computer now, and keep the answer.
pub fn check() -> Readiness {
    let probe = if needs_check() { child::probe(child::TIMEOUT) } else { ProbeOutcome::NotApplicable };
    let facts = Facts {
        platform: platform().to_string(),
        adapters: if cfg!(target_os = "macos") { Vec::new() } else { adapters::list() },
        probe,
        remote_session: adapters::remote_session(),
    };
    let readiness = classify::classify(&facts);
    if let Ok(mut slot) = READINESS.write() {
        *slot = Some(readiness.clone());
    }
    readiness
}

/// The last answer, if a check has finished.
pub fn current() -> Option<Readiness> {
    READINESS.read().ok().and_then(|r| r.clone())
}

/// The engine's gate: Ok where it may start (on a GPU or the processor).
pub fn allows_engine() -> Result<(), String> {
    if !needs_check() {
        return Ok(());
    }
    match current() {
        None => Err(CHECKING.to_string()),
        Some(r) if r.allows_engine() => Ok(()),
        Some(_) => Err(UNAVAILABLE.to_string()),
    }
}

/// Windows Vulkan builds: bind the delay-loaded vulkan-1.dll before llama.cpp
/// starts (`delayguard.c`). An error instead of a crash when it is missing.
#[cfg(all(windows, target_env = "msvc", feature = "vulkan"))]
pub fn bind_vulkan() -> Result<(), u32> {
    extern "C" {
        fn versorium_bind_vulkan() -> i32;
    }
    // SAFETY: a C function with no arguments that only binds imports.
    match unsafe { versorium_bind_vulkan() } {
        0 => Ok(()),
        code => Err(code as u32),
    }
}

/// At launch: check, then warm the engine up if it may start. Off the main
/// thread; the probe can take seconds on a first Windows run.
pub fn start() {
    std::thread::spawn(|| {
        if check().allows_engine() {
            crate::llama::warm_up();
        }
    });
}
