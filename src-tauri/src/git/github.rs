//! Minimal GitHub REST client (no SDK). Used by the two OAuth slots:
//! - Updates slot: reads releases of maecly/versorium-app (M6)
//! - Novel slot: user's account/org repos for the novel remote (private default)

use serde::Deserialize;

const UA: &str = "versorium";

async fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .expect("http client")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhUser {
    pub login: String,
}

pub async fn me(token: &str) -> Result<GhUser, String> {
    let r = client().await
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    if !r.status().is_success() {
        return Err("bad_token".to_string());
    }
    r.json().await.map_err(|_| "network".to_string())
}

/// Create a repo under the token's user. Returns the https clone URL.
pub async fn create_repo(token: &str, name: &str, private: bool) -> Result<String, String> {
    let r = client().await
        .post("https://api.github.com/user/repos")
        .bearer_auth(token)
        .json(&serde_json::json!({ "name": name, "private": private, "auto_init": false }))
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    if !r.status().is_success() {
        return Err("repo_failed".to_string());
    }
    let v: serde_json::Value = r.json().await.map_err(|_| "network".to_string())?;
    Ok(v["clone_url"].as_str().unwrap_or_default().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhRepo {
    full_name: String,
    private: bool,
}

/// First page of the token's repos (user + orgs it belongs to).
pub async fn list_repos(token: &str) -> Result<Vec<(String, bool)>, String> {
    let r = client().await
        .get("https://api.github.com/user/repos?per_page=100&sort=updated")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    if !r.status().is_success() {
        return Err("bad_token".to_string());
    }
    let repos: Vec<GhRepo> = r.json().await.map_err(|_| "network".to_string())?;
    Ok(repos.into_iter().map(|r| (r.full_name, r.private)).collect())
}
