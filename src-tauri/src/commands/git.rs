//! Tauri commands wrapping the git engine + GitHub API.

use crate::git::{github, repo};
use std::path::PathBuf;

#[tauri::command]
pub fn git_status(path: PathBuf) -> Result<repo::StatusInfo, String> {
    repo::status(&path)
}

#[tauri::command]
pub fn git_log(path: PathBuf, limit: Option<usize>) -> Result<Vec<repo::CommitInfo>, String> {
    repo::log(&path, limit.unwrap_or(50).clamp(1, 200))
}

#[tauri::command]
pub fn git_diff(path: PathBuf) -> Result<String, String> {
    repo::diff(&path)
}

#[tauri::command]
pub fn git_commit(path: PathBuf, message: String) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("empty_message".to_string());
    }
    repo::commit_all(&path, msg)
}

#[tauri::command]
pub fn git_auto_checkpoint(path: PathBuf) -> Result<Option<String>, String> {
    let st = repo::status(&path)?;
    let dirty =
        !st.modified.is_empty() || !st.staged.is_empty() || !st.untracked.is_empty();
    if !dirty {
        return Ok(None);
    }
    let sha = repo::commit_all(&path, "checkpoint: autosave")?;
    Ok(Some(sha))
}

#[tauri::command]
pub fn git_branches(path: PathBuf) -> Result<repo::BranchInfo, String> {
    repo::branches(&path)
}

#[tauri::command]
pub fn git_branch_create(path: PathBuf, name: String) -> Result<String, String> {
    repo::branch_create(&path, &name)
}

#[tauri::command]
pub fn git_checkout_file(path: PathBuf, file: String, sha: Option<String>) -> Result<(), String> {
    repo::checkout_file(&path, &file, sha.as_deref())
}

#[tauri::command]
pub fn git_remotes(path: PathBuf) -> Result<Vec<repo::RemoteInfo>, String> {
    repo::remotes(&path)
}

#[tauri::command]
pub fn git_remote_add(path: PathBuf, name: String, url: String) -> Result<(), String> {
    repo::remote_add(&path, &name, &url)
}

#[tauri::command]
pub fn git_remote_remove(path: PathBuf, name: String) -> Result<(), String> {
    repo::remote_remove(&path, &name)
}

/// Validate a GitHub token and return the login (used by both OAuth slots).
#[tauri::command]
pub async fn github_me(token: String) -> Result<String, String> {
    let u = github::me(&token).await?;
    Ok(u.login)
}

/// Create a private repo under the token's user; returns clone URL.
#[tauri::command]
pub async fn github_create_repo(token: String, name: String, owner: Option<String>) -> Result<String, String> {
    github::create_repo(&token, &name, true, owner.as_deref()).await
}

#[tauri::command]
pub async fn github_owners(token: String) -> Result<Vec<github::GhOwner>, String> {
    github::owners(&token).await
}

#[tauri::command]
pub async fn github_list_repos(token: String) -> Result<Vec<serde_json::Value>, String> {
    let repos = github::list_repos(&token).await?;
    Ok(repos
        .into_iter()
        .map(|(n, p)| serde_json::json!({ "name": n, "private": p }))
        .collect())
}

/// Send the novel's current branch to its remote.
///
/// The token comes from the credential store, not from the caller: a frontend
/// that had to pass it would need to hold it, which is the round trip the
/// keychain change removed.
///
/// Blocking, and it is network work, so it goes to a blocking thread.
#[tauri::command]
pub async fn git_push(path: PathBuf, remote: Option<String>) -> Result<String, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let token = novel_token().await?;
    tauri::async_runtime::spawn_blocking(move || repo::push(&path, &remote, &token))
        .await
        .map_err(|_| "io".to_string())?
}

/// Fetch and fast-forward. Refuses rather than merging when the histories have
/// diverged: resolving a conflict is a feature this editor does not have yet,
/// and a half-merged manuscript is worse than a clear refusal.
#[tauri::command]
pub async fn git_pull(path: PathBuf, remote: Option<String>) -> Result<repo::PullOutcome, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let token = novel_token().await?;
    tauri::async_runtime::spawn_blocking(move || repo::pull(&path, &remote, &token))
        .await
        .map_err(|_| "io".to_string())?
}

/// The writer's own GitHub token, from the OS credential store.
async fn novel_token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| crate::secrets::get(crate::secrets::Slot::Novel))
        .await
        .map_err(|_| "io".to_string())??
        .ok_or_else(|| "not_signed_in".to_string())
}
