//! Minimal GitHub REST client (no SDK). Used by the two OAuth slots:
//! - Updates slot: reads releases of maecly/versorium-app (M6)
//! - Novel slot: user's account/org repos for the novel remote (private default)

use serde::{Deserialize, Serialize};

const UA: &str = "versorium";

async fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(20))
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

#[derive(Debug, Serialize)]
pub struct GhOwner {
    pub login: String,
    pub kind: &'static str,
}

pub async fn owners(token: &str) -> Result<Vec<GhOwner>, String> {
    let user = me(token).await?;
    let mut owners = vec![GhOwner { login: user.login, kind: "user" }];
    let client = client().await;
    for page in 1..=100 {
        let response = client.get("https://api.github.com/user/orgs")
            .query(&[("per_page", 100), ("page", page)])
            .bearer_auth(token).send().await.map_err(|_| "network")?;
        if !response.status().is_success() { return Err("bad_token".into()); }
        let orgs: Vec<GhUser> = response.json().await.map_err(|_| "network")?;
        let done = orgs.len() < 100;
        owners.extend(orgs.into_iter().map(|org| GhOwner { login: org.login, kind: "organization" }));
        if done { break; }
    }
    Ok(owners)
}

/// Create only under an explicitly selected account belonging to this token.
pub async fn create_repo(token: &str, name: &str, private: bool, owner: Option<&str>) -> Result<String, String> {
    let user = me(token).await?;
    let endpoint = match owner.filter(|owner| !owner.eq_ignore_ascii_case(&user.login)) {
        Some(org) => {
            let allowed = owners(token).await?.iter().any(|item|
                item.kind == "organization" && item.login.eq_ignore_ascii_case(org));
            if !allowed { return Err("repo_failed".into()); }
            format!("https://api.github.com/orgs/{org}/repos")
        }
        None => "https://api.github.com/user/repos".to_string(),
    };
    let r = client().await
        .post(endpoint)
        .bearer_auth(token)
        .json(&serde_json::json!({ "name": name, "private": private, "auto_init": false }))
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    if !r.status().is_success() {
        return Err("repo_failed".to_string());
    }
    let v: serde_json::Value = r.json().await.map_err(|_| "network".to_string())?;
    v["clone_url"].as_str().filter(|url| url.starts_with("https://github.com/"))
        .map(String::from).ok_or_else(|| "repo_failed".to_string())
}

#[derive(Debug, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_repository_fields_without_renaming_them() {
        let repo: GhRepo = serde_json::from_str(r#"{"full_name":"writer/novel","private":true}"#).unwrap();
        assert_eq!(repo.full_name, "writer/novel");
        assert!(repo.private);
        let owner = serde_json::to_value(GhOwner { login: "writer".into(), kind: "user" }).unwrap();
        assert_eq!(owner["kind"], "user");
    }
}
