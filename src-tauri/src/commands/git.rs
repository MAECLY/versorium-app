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
pub async fn github_create_repo(token: String, name: String) -> Result<String, String> {
    github::create_repo(&token, &name, true).await
}

#[tauri::command]
pub async fn github_list_repos(token: String) -> Result<Vec<serde_json::Value>, String> {
    let repos = github::list_repos(&token).await?;
    Ok(repos
        .into_iter()
        .map(|(n, p)| serde_json::json!({ "name": n, "private": p }))
        .collect())
}
