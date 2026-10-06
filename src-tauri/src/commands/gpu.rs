//! The GPU check, as the frontend asks for it (src/gpu/mod.rs).

use crate::gpu::{self, classify::Readiness};

/// The last answer, or null while the first check at launch is still running.
#[tauri::command]
pub fn gpu_readiness() -> Option<Readiness> {
    gpu::current()
}

/// "Check again": look at the computer anew, off the main thread. When the
/// engine may start now and has not, it starts here: a refusal never
/// started it, so a driver installed since needs no restart of the app.
#[tauri::command]
pub async fn gpu_check_again() -> Result<Readiness, String> {
    let readiness = tauri::async_runtime::spawn_blocking(gpu::check).await.map_err(|_| "io".to_string())?;
    if readiness.allows_engine() && crate::llama::backend_state().state != "ready" {
        crate::llama::warm_up();
    }
    Ok(readiness)
}
