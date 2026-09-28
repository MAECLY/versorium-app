//! Signing in to GitHub, without the token ever reaching the webview.
//!
//! The old flow round-tripped the token through `get_settings` to prefill a
//! password field. Nothing needed that: what the writer wants to see is whether
//! they are connected and as whom. So these commands report presence and a
//! login, and the secret itself only ever travels inwards.

use crate::secrets::{self, Slot};
use serde::Serialize;

/// What Settings shows about each credential.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretsStatus {
    /// The machine has a usable credential store.
    pub store: secrets::Availability,
    /// A token is stored for app updates.
    pub updates: bool,
    /// A token is stored for the writer's novel backup.
    pub novel: bool,
}

fn slot_of(name: &str) -> Result<Slot, String> {
    Slot::parse(name).ok_or_else(|| "bad_args".to_string())
}

/// Which credentials exist, never their values.
///
/// Blocking on every platform, so it runs off the async thread: the Linux
/// backend can stall a runtime and macOS may raise an unlock prompt.
#[tauri::command]
pub async fn secrets_status() -> Result<SecretsStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = secrets::availability();
        if !store.usable {
            // Asking for each slot would fail the same way twice and, on Linux,
            // block on a D-Bus call that cannot succeed.
            return SecretsStatus { store, updates: false, novel: false };
        }
        SecretsStatus {
            store,
            updates: secrets::is_set(Slot::Updates),
            novel: secrets::is_set(Slot::Novel),
        }
    })
    .await
    .map_err(|_| "io".to_string())
}

/// Validate a token against GitHub, then store it. Returns the login.
///
/// Validated before it is stored so a typo is reported as a bad token rather
/// than kept and failing later, at the moment the writer needed it to work.
#[tauri::command]
pub async fn secrets_connect(slot: String, token: String) -> Result<String, String> {
    let slot = slot_of(&slot)?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("bad_args".into());
    }
    let login = crate::commands::git::github_me(token.clone()).await?;
    let stored = token.clone();
    tauri::async_runtime::spawn_blocking(move || secrets::set(slot, &stored))
        .await
        .map_err(|_| "io".to_string())??;
    Ok(login)
}

/// Forget a credential.
#[tauri::command]
pub async fn secrets_forget(slot: String) -> Result<(), String> {
    let slot = slot_of(&slot)?;
    tauri::async_runtime::spawn_blocking(move || secrets::clear(slot))
        .await
        .map_err(|_| "io".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_known_slots_are_addressable() {
        // The slot name comes from the frontend, so it is a closed set: an
        // arbitrary account string would reach items this app never wrote.
        assert!(slot_of("updates").is_ok());
        assert!(slot_of("novel").is_ok());
        for bad in ["", "Updates", "github-novel", "../secrets", "both"] {
            assert_eq!(slot_of(bad).unwrap_err(), "bad_args", "{bad} was accepted");
        }
    }

    #[test]
    fn the_status_shape_never_carries_a_token() {
        // The whole point of the change: a credential must not cross into the
        // webview. This asserts the serialized shape, which is what does.
        let status = SecretsStatus {
            store: secrets::Availability { usable: true, reason: None },
            updates: true,
            novel: false,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, r#"{"store":{"usable":true,"reason":null},"updates":true,"novel":false}"#);
        assert!(!json.contains("token"), "a token field appeared on the wire");
    }

    #[test]
    fn an_empty_token_is_refused_before_github_is_asked() {
        // Otherwise a blank field would spend a network round trip to learn what
        // the string length already said.
        let refused = tauri::async_runtime::block_on(secrets_connect("novel".into(), "   ".into()));
        assert_eq!(refused.unwrap_err(), "bad_args");
    }

    #[test]
    fn an_unknown_slot_is_refused_before_anything_is_stored() {
        let refused = tauri::async_runtime::block_on(secrets_connect("other".into(), "ghp_x".into()));
        assert_eq!(refused.unwrap_err(), "bad_args");
        let refused = tauri::async_runtime::block_on(secrets_forget("other".into()));
        assert_eq!(refused.unwrap_err(), "bad_args");
    }
}
