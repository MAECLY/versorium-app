//! Finding a signed release on GitHub.
//!
//! The app ships from a **private** repo, so every request carries the reader's
//! token. That token is a credential and nothing else: the owner, the repo and
//! the API host are compiled in, so no setting, environment variable or command
//! argument can point the updater somewhere else. An updater whose endpoint can
//! be steered is a code-execution vector wearing a helpful face.
//!
//! The plugin verifies minisign on the bytes it downloads; the sha256 half the
//! spec also asks for (§11) lives here, checked against the release's own
//! `SHA256SUMS` before anything is installed.

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Spec §11 names this repository as the source of app updates. The current git
/// remote is a personal fork, so these constants are the spec's target rather
/// than today's remote — moving them is a human decision, not a config toggle.
const UPDATE_OWNER: &str = "maecly";
const UPDATE_REPO: &str = "versorium-app";
const GITHUB_API: &str = "https://api.github.com";

/// The only host the updater will ever fetch from.
const UPDATE_HOST: &str = "api.github.com";

/// The manifest the Tauri updater reads, published as a release asset.
pub const MANIFEST_ASSET: &str = "latest.json";
/// Companion checksums, so a release is verified two ways.
pub const CHECKSUMS_ASSET: &str = "SHA256SUMS";

const UA: &str = "versorium";
const ACCEPT_JSON: &str = "application/vnd.github+json";

/// What a private repo's asset endpoint needs to serve bytes rather than JSON
/// metadata. The updater must send it on the **download** as well as the check:
/// with the default `Accept`, GitHub answers a successful check with a JSON
/// description of the asset and the install fails on bytes that are not an
/// installer.
pub const ACCEPT_BINARY: &str = "application/octet-stream";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    /// The API asset URL. A private repo's `browser_download_url` is not
    /// fetchable with a bearer token, so this is the one that works.
    pub url: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "network".to_string())
}

/// Reject any URL that is not `https://api.github.com/...`.
///
/// GitHub's own response supplies the asset URL, so a compromised or spoofed
/// API reply is the thing this guards against: without it, the answer to
/// "where do I download my next executable from" would come from the network.
pub fn manifest_url_for(asset_url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(asset_url).map_err(|_| "bad_update_host".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(UPDATE_HOST) {
        return Err("bad_update_host".into());
    }
    Ok(parsed.to_string())
}

fn releases_url() -> String {
    format!("{GITHUB_API}/repos/{UPDATE_OWNER}/{UPDATE_REPO}/releases")
}

/// Does this release belong to the channel the writer chose?
///
/// `stable` takes published, non-prerelease builds only. `beta` also accepts a
/// prerelease. Neither ever takes a draft: a draft is work in progress that the
/// publisher has not stood behind.
fn matches_channel(release: &serde_json::Value, channel: &str) -> bool {
    let draft = release.get("draft").and_then(|v| v.as_bool()).unwrap_or(false);
    if draft {
        return false;
    }
    let prerelease = release.get("prerelease").and_then(|v| v.as_bool()).unwrap_or(false);
    match channel {
        "beta" => true,
        // Anything not `beta` is treated as stable; the command layer validates
        // the string before it reaches here.
        _ => !prerelease,
    }
}

fn assets_of(release: &serde_json::Value) -> Vec<ReleaseAsset> {
    release
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|assets| {
            assets
                .iter()
                .filter_map(|asset| {
                    Some(ReleaseAsset {
                        id: asset.get("id")?.as_u64()?,
                        name: asset.get("name")?.as_str()?.to_string(),
                        url: asset.get("url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pick the newest release for a channel out of the API's list response.
///
/// Pure, so the channel rules are tested without a network. GitHub returns
/// releases newest first, so the first match wins.
pub fn select_release(body: &serde_json::Value, channel: &str) -> Result<Vec<ReleaseAsset>, String> {
    let releases = body.as_array().ok_or_else(|| "no_release".to_string())?;
    releases
        .iter()
        .find(|release| matches_channel(release, channel))
        .map(assets_of)
        .ok_or_else(|| "no_release".to_string())
}

/// The asset named `latest.json`, validated.
pub fn manifest_of(assets: &[ReleaseAsset]) -> Result<String, String> {
    let asset = assets
        .iter()
        .find(|a| a.name == MANIFEST_ASSET)
        .ok_or_else(|| "no_manifest".to_string())?;
    manifest_url_for(&asset.url)
}

async fn get_asset_bytes(token: &str, url: &str) -> Result<Vec<u8>, String> {
    let url = manifest_url_for(url)?;
    let response = client()?
        .get(url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, ACCEPT_BINARY)
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    match response.status().as_u16() {
        200 => response.bytes().await.map(|b| b.to_vec()).map_err(|_| "network".to_string()),
        401 | 403 => Err("bad_token".into()),
        404 => Err("no_release".into()),
        _ => Err("network".into()),
    }
}

/// Every asset of the newest release on this channel.
pub async fn latest_release_assets(token: &str, channel: &str) -> Result<Vec<ReleaseAsset>, String> {
    let response = client()?
        .get(releases_url())
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, ACCEPT_JSON)
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("bad_token".into()),
        404 => return Err("no_release".into()),
        _ => return Err("network".into()),
    }
    let body: serde_json::Value = response.json().await.map_err(|_| "network".to_string())?;
    select_release(&body, channel)
}

/// Where the Tauri updater should point for this channel.
pub async fn latest_manifest_url(token: &str, channel: &str) -> Result<String, String> {
    let assets = latest_release_assets(token, channel).await?;
    manifest_of(&assets)
}

/// sha2 0.11 returns a raw array rather than something `{:x}` accepts, and a
/// hex crate is not worth a dependency for this.
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

pub fn sha256_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    to_hex(&hasher.finalize())
}

/// Find a file's published digest in a `SHA256SUMS` body.
///
/// The format is `<hex>  <name>`, the name sometimes prefixed with `*` for a
/// binary read. Pure, so the parsing is tested without a network.
pub fn checksum_for(sums: &str, file_name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let digest = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == file_name && digest.len() == 64).then(|| digest.to_ascii_lowercase())
    })
}

/// Compare a downloaded file against the release's own checksums.
///
/// The plugin already refused anything whose minisign signature did not verify;
/// this is the second of the two checks spec §11 asks for.
pub async fn verify_sha256(
    token: &str,
    release_assets: &[ReleaseAsset],
    file_name: &str,
    digest: &str,
) -> Result<(), String> {
    let asset = release_assets
        .iter()
        .find(|a| a.name == CHECKSUMS_ASSET)
        .ok_or_else(|| "no_checksums".to_string())?;
    let bytes = get_asset_bytes(token, &asset.url).await?;
    let sums = String::from_utf8_lossy(&bytes);
    let published = checksum_for(&sums, file_name).ok_or_else(|| "no_checksums".to_string())?;
    if published.eq_ignore_ascii_case(digest) {
        Ok(())
    } else {
        Err("sha_mismatch".into())
    }
}

/// Which asset a download URL refers to, so its name can be looked up in
/// `SHA256SUMS`. A private repo's download URL ends in the numeric asset id and
/// carries no file name of its own.
pub fn asset_name_for(assets: &[ReleaseAsset], download_url: &str) -> Option<String> {
    let id: u64 = download_url.rsplit('/').next()?.parse().ok()?;
    assets.iter().find(|a| a.id == id).map(|a| a.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, draft: bool, prerelease: bool) -> serde_json::Value {
        json!({
            "tag_name": tag,
            "draft": draft,
            "prerelease": prerelease,
            "assets": [
                { "id": 1, "name": MANIFEST_ASSET,
                  "url": format!("https://api.github.com/repos/maecly/versorium-app/releases/assets/1") },
                { "id": 2, "name": CHECKSUMS_ASSET,
                  "url": "https://api.github.com/repos/maecly/versorium-app/releases/assets/2" }
            ]
        })
    }

    #[test]
    fn the_update_source_is_compiled_in() {
        // No setting, env var or argument feeds these. If this test has to
        // change, someone moved the release home on purpose.
        assert_eq!(UPDATE_OWNER, "maecly");
        assert_eq!(UPDATE_REPO, "versorium-app");
        assert_eq!(GITHUB_API, "https://api.github.com");
        assert_eq!(
            releases_url(),
            "https://api.github.com/repos/maecly/versorium-app/releases"
        );
    }

    #[test]
    fn an_asset_url_on_another_host_is_refused() {
        // A spoofed or compromised API response must not be able to say
        // "download your next executable from here instead".
        for hostile in [
            "https://evil.example.com/repos/maecly/versorium-app/releases/assets/1",
            "https://api.github.com.evil.example.com/releases/assets/1",
            "http://api.github.com/releases/assets/1",
            "file:///etc/passwd",
            "https://raw.githubusercontent.com/maecly/versorium-app/main/latest.json",
            "not a url at all",
            // tauri-action's own output shape. It 404s on a private repo even
            // with a valid token — only the API asset endpoint serves bytes —
            // so the release workflow rewrites every platform URL. If one ever
            // reaches us un-rewritten, refusing it names the problem instead of
            // failing later on an empty download.
            "https://github.com/maecly/versorium-app/releases/download/v1.2.0/Versorium.dmg",
        ] {
            assert_eq!(
                manifest_url_for(hostile).unwrap_err(),
                "bad_update_host",
                "{hostile} must not be reachable"
            );
        }
    }

    #[test]
    fn the_real_asset_host_is_accepted() {
        // The shape the release workflow rewrites every platform URL into.
        // This is the expected form on a private repo, not an anomaly.
        let ok = "https://api.github.com/repos/maecly/versorium-app/releases/assets/7";
        assert_eq!(manifest_url_for(ok).unwrap(), ok);
    }

    #[test]
    fn a_manifest_whose_url_was_tampered_with_is_refused() {
        let assets = vec![ReleaseAsset {
            id: 1,
            name: MANIFEST_ASSET.into(),
            url: "https://evil.example.com/assets/1".into(),
        }];
        assert_eq!(manifest_of(&assets).unwrap_err(), "bad_update_host");
    }

    #[test]
    fn stable_ignores_prereleases_and_drafts() {
        let body = json!([
            release("v1.3.0", true, false),
            release("v1.2.0", false, true),
            release("v1.1.0", false, false),
        ]);
        let assets = select_release(&body, "stable").unwrap();
        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].name, MANIFEST_ASSET);
    }

    #[test]
    fn beta_takes_a_prerelease_but_never_a_draft() {
        let body = json!([release("v1.3.0", true, true), release("v1.2.0", false, true)]);
        assert!(select_release(&body, "beta").is_ok());

        let only_drafts = json!([release("v1.3.0", true, true)]);
        assert_eq!(select_release(&only_drafts, "beta").unwrap_err(), "no_release");
    }

    #[test]
    fn an_empty_or_unshaped_response_is_no_release() {
        assert_eq!(select_release(&json!([]), "stable").unwrap_err(), "no_release");
        assert_eq!(select_release(&json!({}), "stable").unwrap_err(), "no_release");
    }

    #[test]
    fn a_release_without_a_manifest_says_so() {
        let body = json!([{
            "draft": false, "prerelease": false,
            "assets": [{ "id": 9, "name": "versorium.dmg",
                         "url": "https://api.github.com/repos/maecly/versorium-app/releases/assets/9" }]
        }]);
        let assets = select_release(&body, "stable").unwrap();
        assert_eq!(manifest_of(&assets).unwrap_err(), "no_manifest");
    }

    #[test]
    fn a_malformed_asset_entry_is_skipped_rather_than_fatal() {
        let body = json!([{
            "draft": false, "prerelease": false,
            "assets": [
                { "name": "no-id.json", "url": "https://api.github.com/x" },
                { "id": 4, "name": MANIFEST_ASSET,
                  "url": "https://api.github.com/repos/maecly/versorium-app/releases/assets/4" }
            ]
        }]);
        let assets = select_release(&body, "stable").unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].id, 4);
    }

    #[test]
    fn a_digest_is_lowercase_hex_of_the_bytes() {
        // The empty-input digest is a known constant, so a broken hex encoder
        // or a short digest cannot pass unnoticed.
        assert_eq!(
            sha256_of(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(sha256_of(b"abc").len(), 64);
    }

    #[test]
    fn checksums_are_read_in_both_common_layouts() {
        let sums = "\
abc123  other.dmg
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Versorium.app.tar.gz
AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666AAAA7777BBBB8888 *Versorium.msi
";
        assert_eq!(
            checksum_for(sums, "Versorium.app.tar.gz").unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // The `*` binary marker is part of the format, not the name.
        assert!(checksum_for(sums, "Versorium.msi").is_some());
        // A short field is not a digest, so it is not accepted as one.
        assert!(checksum_for(sums, "other.dmg").is_none());
        assert!(checksum_for(sums, "absent.dmg").is_none());
    }

    #[test]
    fn a_download_url_resolves_back_to_its_asset_name() {
        let assets = vec![
            ReleaseAsset { id: 11, name: "Versorium.msi".into(), url: "u".into() },
            ReleaseAsset { id: 12, name: "Versorium.dmg".into(), url: "u".into() },
        ];
        assert_eq!(
            asset_name_for(&assets, "https://api.github.com/repos/o/r/releases/assets/12").as_deref(),
            Some("Versorium.dmg")
        );
        assert!(asset_name_for(&assets, "https://api.github.com/repos/o/r/releases/assets/99").is_none());
        assert!(asset_name_for(&assets, "not-a-url").is_none());
    }

    /// Against the real API. Skips cleanly when no token is configured, so it
    /// is safe to run anywhere: `cargo test -- --ignored live_`.
    #[test]
    #[ignore = "talks to the GitHub API with the configured updates token"]
    fn live_the_release_endpoint_answers_or_says_why() {
        let Ok(path) = crate::paths::settings_path() else { return };
        let Ok(raw) = std::fs::read_to_string(path) else {
            eprintln!("no settings file; skipping");
            return;
        };
        let settings: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
        let Some(token) = settings.get("githubUpdatesToken").and_then(|v| v.as_str()) else {
            eprintln!("no updates token configured; skipping");
            return;
        };
        match tauri::async_runtime::block_on(latest_manifest_url(token, "stable")) {
            Ok(url) => {
                eprintln!("manifest: {url}");
                assert!(url.starts_with("https://api.github.com/"));
            }
            // Every one of these is a real answer about a repo that may not
            // exist yet, not a test failure.
            Err(code) => {
                eprintln!("no manifest yet: {code}");
                assert!(matches!(
                    code.as_str(),
                    "no_release" | "no_manifest" | "bad_token" | "network"
                ));
            }
        }
    }
}
