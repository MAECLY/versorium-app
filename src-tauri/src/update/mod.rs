//! Finding a signed release on GitHub.
//!
//! Spec §11, as amended on 2026-10-03: the repository is being made public, and
//! anyone may read a public repository's releases, so the updater asks GitHub
//! anonymously unless the writer saved an updates token. A saved token is sent
//! exactly as before. It is what lets the updater see releases while the
//! repository is still private, and it lifts GitHub's limit of 60 anonymous
//! requests an hour per address.
//!
//! The token is a credential and nothing else. The owner, the repo and the API
//! host are compiled in, so no setting, environment variable or command argument
//! can point the updater somewhere else: an updater whose endpoint can be
//! steered is a code-execution vector wearing a helpful face. And the token only
//! ever reaches `api.github.com` — `may_follow` is the redirect half of that.
//!
//! The plugin verifies minisign on the bytes it downloads; the sha256 half the
//! spec also asks for (§11) lives here, checked against the release's own
//! `SHA256SUMS` before anything is installed. None of this depends on the
//! token: an anonymous check passes through the same pin and the same two
//! checks as one that carries a token.

use reqwest::header::{HeaderMap, HeaderName, ACCEPT, AUTHORIZATION};
use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Spec §11 names this repository as the source of app updates, and the repo now
/// lives there: it was transferred from a personal account to the MAECLY org on
/// 2026-09-28. Compiled in on purpose — an updater whose owner can be steered by
/// a setting is a code-execution vector wearing a helpful face.
const UPDATE_OWNER: &str = "MAECLY";
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

/// What the asset endpoint needs to serve bytes rather than JSON metadata. The
/// updater must send it on the **download** as well as the check: with the
/// default `Accept`, GitHub answers a successful check with a JSON description
/// of the asset and the install fails on bytes that are not an installer.
pub const ACCEPT_BINARY: &str = "application/octet-stream";

/// GitHub's own redirect for an asset is a single hop, from the API to its
/// storage host. Ten is reqwest's default ceiling, kept only as the bound on a
/// loop.
const MAX_REDIRECTS: usize = 10;

/// Error codes for GitHub's answers. Each is its own sentence in the UI, so a
/// writer can tell "nothing to see yet" from "you were throttled" from "your
/// token is dead". No spaces: `errors.ts` keeps only the last word.
///
/// 404 on the release lookup: nothing this request is allowed to see. Either no
/// release exists yet, or the repository is private and no token that can read
/// it was sent. GitHub answers both the same way, so the code cannot tell them
/// apart either.
pub const NONE_VISIBLE: &str = "update_none_visible";
/// The anonymous limit was hit; a token would lift it.
pub const RATE_LIMITED: &str = "update_rate_limited";
/// The limit was hit with a token sent, so "add a token" would be wrong advice.
pub const RATE_LIMITED_TOKEN: &str = "update_rate_limited_token";
/// A token was sent and GitHub refused it: wrong, expired or revoked.
pub const TOKEN_REJECTED: &str = "update_token_rejected";
/// Offline, a server error, anything else. Kept quiet (spec §11.7).
pub const NETWORK: &str = "network";
/// A redirect, or an asset URL, pointed off `api.github.com`.
pub const BAD_HOST: &str = "bad_update_host";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    /// The API asset URL. A private repo's `browser_download_url` is not
    /// fetchable with a bearer token, so this is the one that works — and it
    /// works anonymously once the repo is public.
    pub url: String,
}

/// Why a request produced no release: a code the UI translates, plus GitHub's
/// word on when to try again.
///
/// Every other command fails with a bare code. This one also carries a time,
/// because "the limit was reached" is only useful next to "until when".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: String,
    /// When the rate limit lifts, in Unix seconds. Set only with a rate-limit
    /// code, and only when GitHub said.
    pub resets_at: Option<u64>,
}

impl From<String> for Refusal {
    fn from(code: String) -> Self {
        Self { code, resets_at: None }
    }
}

/// Commands that answer the frontend with a bare code drop the time; the check
/// keeps it (`commands::update`).
impl From<Refusal> for String {
    fn from(refusal: Refusal) -> Self {
        refusal.code
    }
}

/// The one origin a token may be sent to, as a URL to compare others with.
fn home() -> Url {
    Url::parse(GITHUB_API).expect("GITHUB_API is a valid URL")
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Whether a redirect may be followed, given where the chain has been.
///
/// reqwest drops `Authorization` when a hop changes host, but it compares each
/// hop only with the one before it, and the redirect layer under it
/// (tower-http 0.6) rebuilds every hop's headers from the original request. So
/// after the hop to GitHub's storage host, a further hop that stayed on that
/// host would carry the token again: `tests/updater/redirect-probe` shows it on
/// both reqwest versions in `Cargo.lock`. Following a hop only out of `home`
/// closes that. A chain leaves the token's host once, and the host it lands on
/// has to answer by itself, which is what GitHub's asset redirect does.
///
/// Never onto another scheme either: no request is downgraded to plain http,
/// whether it carries a token or not.
pub fn may_follow(home: &Url, next: &Url, previous: &[Url]) -> bool {
    previous.len() <= MAX_REDIRECTS
        && next.scheme() == home.scheme()
        && previous.last().is_some_and(|from| same_origin(from, home))
}

const REDIRECT_REFUSED: &str = "redirect refused: the updater follows a hop only out of api.github.com";

/// The redirect rule for our own client.
fn redirects(home: Url) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if may_follow(&home, attempt.url(), attempt.previous()) {
            attempt.follow()
        } else {
            attempt.error(REDIRECT_REFUSED)
        }
    })
}

/// The same rule, for the plugin's client: it is reqwest 0.13, a different
/// type from ours.
fn plugin_redirects(home: Url) -> updater_reqwest::redirect::Policy {
    updater_reqwest::redirect::Policy::custom(move |attempt| {
        if may_follow(&home, attempt.url(), attempt.previous()) {
            attempt.follow()
        } else {
            attempt.error(REDIRECT_REFUSED)
        }
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(20))
        .https_only(true)
        .redirect(redirects(home()))
        .build()
        .map_err(|_| NETWORK.to_string())
}

/// What `UpdaterBuilder::configure_client` does to the plugin's own client,
/// which fetches `latest.json` and downloads the installer. Both of those are
/// API asset URLs that GitHub redirects to its storage host, and both carry the
/// builder's headers, the token among them when there is one.
pub fn plugin_client(builder: updater_reqwest::ClientBuilder) -> updater_reqwest::ClientBuilder {
    builder.https_only(true).redirect(plugin_redirects(home()))
}

/// A token worth sending, or none. Whitespace is not a credential.
pub fn usable(token: Option<&str>) -> Option<&str> {
    token.map(str::trim).filter(|token| !token.is_empty())
}

/// Every header an updater request carries, on our client and on the plugin's.
///
/// `Authorization` only with a token. Without one there is no header at all —
/// not an empty `Bearer`, which GitHub would read as a credential and refuse,
/// turning "no token" into "bad token".
pub fn request_headers(token: Option<&str>, accept: &str) -> Vec<(HeaderName, String)> {
    let mut headers = vec![(ACCEPT, accept.to_string())];
    if let Some(token) = usable(token) {
        headers.push((AUTHORIZATION, format!("Bearer {token}")));
    }
    headers
}

fn header_number(headers: &HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.trim().parse().ok()
}

/// The limit, named for whoever asked: "add a token" is only advice for a
/// request that carried none.
fn rate_limited(with_token: bool, resets_at: Option<u64>) -> Refusal {
    Refusal {
        code: if with_token { RATE_LIMITED_TOKEN } else { RATE_LIMITED }.to_string(),
        resets_at,
    }
}

/// What GitHub's answer means, in the UI's terms. Pure, so every branch is
/// tested without a network; `now` is a parameter for the same reason.
///
/// A 401 is "your token is wrong" only when a token was sent; GitHub has no
/// reason to send one to an anonymous request, so there it is just a failure.
/// A rate limit is a 429, or a 403 with `x-ratelimit-remaining: 0` (the hourly
/// limit) or with `retry-after` (GitHub's secondary limits); any other 403 with
/// a token means the token cannot read the repository.
pub fn classify(status: u16, headers: &HeaderMap, with_token: bool, now: u64) -> Result<(), Refusal> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let exhausted = header_number(headers, "x-ratelimit-remaining") == Some(0);
    let retry_after = header_number(headers, "retry-after");
    if status == 429 || (status == 403 && (exhausted || retry_after.is_some())) {
        let hourly = exhausted.then(|| header_number(headers, "x-ratelimit-reset")).flatten();
        let secondary = retry_after.map(|seconds| now.saturating_add(seconds));
        // Whichever lifts later is the one that still holds.
        return Err(rate_limited(with_token, hourly.max(secondary)));
    }
    let code = match status {
        404 => NONE_VISIBLE,
        401 | 403 if with_token => TOKEN_REJECTED,
        _ => NETWORK,
    };
    Err(code.to_string().into())
}

/// What the release list is for, which fixes how many more requests to
/// `api.github.com` have to be answered before the writer has a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// The plugin fetches `latest.json`.
    Check,
    /// The plugin fetches `latest.json` and the installer; then `verify_sha256`
    /// fetches `SHA256SUMS`.
    Install,
}

impl Next {
    fn requests(self) -> u64 {
        match self {
            Next::Check => 1,
            Next::Install => 3,
        }
    }
}

/// Whether the hour's requests, as a successful answer counts them, cover what
/// still has to be fetched.
///
/// The plugin makes the next requests, and it cannot say why GitHub refused
/// one: a refused `latest.json` comes back as "no release" and a refused
/// installer as a network failure, so the limit and its reset time would be
/// lost there. GitHub has just said how many requests are left, though. When
/// fewer are left than the steps still to come, the limit is what will stop
/// them, and saying so now, before any of them is sent, keeps the reset time.
/// No header means nothing to go on, and the steps run.
///
/// What this cannot see is another program on the same address spending the
/// last request between this answer and the plugin's; that check reads as
/// "no release", and the next one names the limit.
pub fn budget_covers(headers: &HeaderMap, next: Next, with_token: bool) -> Result<(), Refusal> {
    match header_number(headers, "x-ratelimit-remaining") {
        Some(left) if left < next.requests() => {
            // On a 2xx the reset header is the hourly window's end, and that
            // window is exactly what is short.
            Err(rate_limited(with_token, header_number(headers, "x-ratelimit-reset")))
        }
        _ => Ok(()),
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Reject any URL that is not `https://api.github.com/...`.
///
/// GitHub's own response supplies the asset URL, so a compromised or spoofed
/// API reply is the thing this guards against: without it, the answer to
/// "where do I download my next executable from" would come from the network.
///
/// The path is not pinned, on purpose. Pinning `/repos/MAECLY/versorium-app/`
/// would strand every installed copy the next time the repository moves, as it
/// did on 2026-09-28: GitHub then hands out asset URLs under the new name, and
/// a copy that refused them could never update to a build that knew it. What
/// the path pin would add is already held elsewhere. The token reaches only
/// `api.github.com` either way, and another repository's asset cannot be
/// installed: minisign wants the founder's key, and `asset_name_for` finds no
/// such asset in this release, which stops the install with `no_checksums`.
pub fn manifest_url_for(asset_url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(asset_url).map_err(|_| "bad_update_host".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(UPDATE_HOST) {
        return Err("bad_update_host".into());
    }
    Ok(parsed.to_string())
}

/// One GET to the API: pinned, with the token only if there is one, and judged.
async fn get(url: &str, token: Option<&str>, accept: &str) -> Result<reqwest::Response, Refusal> {
    // The pin runs before anything is sent, so no request — anonymous or not —
    // ever starts anywhere but api.github.com.
    let url = manifest_url_for(url)?;
    let mut request = client()?.get(url);
    for (name, value) in request_headers(token, accept) {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|error| {
        // A refused redirect is the pin doing its job, not the network failing.
        Refusal::from(if error.is_redirect() { BAD_HOST } else { NETWORK }.to_string())
    })?;
    classify(response.status().as_u16(), response.headers(), usable(token).is_some(), unix_now())?;
    Ok(response)
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

async fn get_asset_bytes(token: Option<&str>, url: &str) -> Result<Vec<u8>, Refusal> {
    let response = get(url, token, ACCEPT_BINARY).await?;
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|_| NETWORK.to_string().into())
}

/// The release list, judged, with the headers that count the hour's requests.
async fn release_list(token: Option<&str>) -> Result<(serde_json::Value, HeaderMap), Refusal> {
    let response = get(&releases_url(), token, ACCEPT_JSON).await?;
    let headers = response.headers().clone();
    let body = response.json().await.map_err(|_| NETWORK.to_string())?;
    Ok((body, headers))
}

/// Every asset of the newest release on this channel.
pub async fn latest_release_assets(token: Option<&str>, channel: &str) -> Result<Vec<ReleaseAsset>, Refusal> {
    let (body, _) = release_list(token).await?;
    Ok(select_release(&body, channel)?)
}

/// Where the Tauri updater should point for this channel, once GitHub's own
/// count says the plugin's requests will be answered (`budget_covers`).
pub async fn latest_manifest_url(token: Option<&str>, channel: &str, next: Next) -> Result<String, Refusal> {
    let (body, headers) = release_list(token).await?;
    let manifest = manifest_of(&select_release(&body, channel)?)?;
    // Only once there is something to fetch: with no release, or no manifest,
    // that is the whole answer whatever the budget.
    budget_covers(&headers, next, usable(token).is_some())?;
    Ok(manifest)
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

/// The verdict on a downloaded file, given the release's checksums. Pure, so
/// the refusal is tested without a network: no line for the file and a line
/// that disagrees both stop the install.
pub fn digest_matches(sums: &str, file_name: &str, digest: &str) -> Result<(), String> {
    let published = checksum_for(sums, file_name).ok_or_else(|| "no_checksums".to_string())?;
    if published.eq_ignore_ascii_case(digest) {
        Ok(())
    } else {
        Err("sha_mismatch".into())
    }
}

/// Compare a downloaded file against the release's own checksums.
///
/// The plugin already refused anything whose minisign signature did not verify;
/// this is the second of the two checks spec §11 asks for.
pub async fn verify_sha256(
    token: Option<&str>,
    release_assets: &[ReleaseAsset],
    file_name: &str,
    digest: &str,
) -> Result<(), Refusal> {
    let asset = release_assets
        .iter()
        .find(|a| a.name == CHECKSUMS_ASSET)
        .ok_or_else(|| "no_checksums".to_string())?;
    let bytes = get_asset_bytes(token, &asset.url).await.map_err(|refusal| {
        // The release was there a moment ago, so a 404 here means the
        // checksums are what is missing, and that is what the writer is told.
        if refusal.code == NONE_VISIBLE {
            Refusal::from("no_checksums".to_string())
        } else {
            refusal
        }
    })?;
    Ok(digest_matches(&String::from_utf8_lossy(&bytes), file_name, digest)?)
}

/// Which asset a download URL refers to, so its name can be looked up in
/// `SHA256SUMS`. An API asset URL ends in the numeric asset id and carries no
/// file name of its own.
pub fn asset_name_for(assets: &[ReleaseAsset], download_url: &str) -> Option<String> {
    let id: u64 = download_url.rsplit('/').next()?.parse().ok()?;
    assets.iter().find(|a| a.id == id).map(|a| a.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;
    use serde_json::json;

    fn release(tag: &str, draft: bool, prerelease: bool) -> serde_json::Value {
        json!({
            "tag_name": tag,
            "draft": draft,
            "prerelease": prerelease,
            "assets": [
                { "id": 1, "name": MANIFEST_ASSET,
                  "url": "https://api.github.com/repos/MAECLY/versorium-app/releases/assets/1" },
                { "id": 2, "name": CHECKSUMS_ASSET,
                  "url": "https://api.github.com/repos/MAECLY/versorium-app/releases/assets/2" }
            ]
        })
    }

    #[test]
    fn the_update_source_is_compiled_in() {
        // No setting, env var or argument feeds these. If this test has to
        // change, someone moved the release home on purpose.
        assert_eq!(UPDATE_OWNER, "MAECLY");
        assert_eq!(UPDATE_REPO, "versorium-app");
        assert_eq!(GITHUB_API, "https://api.github.com");
        assert_eq!(
            releases_url(),
            "https://api.github.com/repos/MAECLY/versorium-app/releases"
        );
        // The redirect rule's notion of "the token's host" is the same host.
        assert_eq!(home().host_str(), Some(UPDATE_HOST));
        assert_eq!(home().scheme(), "https");
    }

    #[test]
    fn an_asset_url_on_another_host_is_refused() {
        // A spoofed or compromised API response must not be able to say
        // "download your next executable from here instead".
        for hostile in [
            "https://evil.example.com/repos/MAECLY/versorium-app/releases/assets/1",
            "https://api.github.com.evil.example.com/releases/assets/1",
            "http://api.github.com/releases/assets/1",
            "file:///etc/passwd",
            "https://raw.githubusercontent.com/MAECLY/versorium-app/main/latest.json",
            "not a url at all",
            // tauri-action's own output shape. It 404s on a private repo even
            // with a valid token — only the API asset endpoint serves bytes —
            // so the release workflow rewrites every platform URL. If one ever
            // reaches us un-rewritten, refusing it names the problem instead of
            // failing later on an empty download.
            "https://github.com/MAECLY/versorium-app/releases/download/v1.2.0/Versorium.dmg",
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
        let ok = "https://api.github.com/repos/MAECLY/versorium-app/releases/assets/7";
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
        // A public repository with nothing released answers 200 with `[]`: the
        // repository is visible, it just has nothing on this channel.
        assert_eq!(select_release(&json!([]), "stable").unwrap_err(), "no_release");
        assert_eq!(select_release(&json!({}), "stable").unwrap_err(), "no_release");
    }

    #[test]
    fn a_release_without_a_manifest_says_so() {
        let body = json!([{
            "draft": false, "prerelease": false,
            "assets": [{ "id": 9, "name": "versorium.dmg",
                         "url": "https://api.github.com/repos/MAECLY/versorium-app/releases/assets/9" }]
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
                  "url": "https://api.github.com/repos/MAECLY/versorium-app/releases/assets/4" }
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
    fn the_sha256_check_still_refuses_a_mismatch_or_a_missing_line() {
        // The second of the two checks, unchanged by the token becoming
        // optional: it never looks at how the bytes were fetched.
        let sums = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Versorium.app.tar.gz\n";
        let empty = sha256_of(b"");
        assert_eq!(digest_matches(sums, "Versorium.app.tar.gz", &empty), Ok(()));
        assert_eq!(
            digest_matches(sums, "Versorium.app.tar.gz", &sha256_of(b"tampered")).unwrap_err(),
            "sha_mismatch"
        );
        assert_eq!(digest_matches(sums, "Versorium.msi", &empty).unwrap_err(), "no_checksums");
        assert_eq!(digest_matches(sums, "Versorium.app.tar.gz", "").unwrap_err(), "sha_mismatch");
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

    #[test]
    fn without_a_token_there_is_no_authorization_header_at_all() {
        let named = |headers: &[(HeaderName, String)], name: &HeaderName| {
            headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone())
        };

        // None, empty and whitespace all mean "ask anonymously". An empty
        // `Bearer ` would be a credential GitHub refuses.
        for absent in [None, Some(""), Some("   ")] {
            let headers = request_headers(absent, ACCEPT_BINARY);
            assert_eq!(named(&headers, &AUTHORIZATION), None, "{absent:?} sent Authorization");
            assert_eq!(named(&headers, &ACCEPT).as_deref(), Some(ACCEPT_BINARY));
            assert_eq!(headers.len(), 1, "an anonymous request carries Accept and nothing else");
        }

        // With one, exactly as before the amendment.
        let headers = request_headers(Some("ghp_example"), ACCEPT_BINARY);
        assert_eq!(named(&headers, &AUTHORIZATION).as_deref(), Some("Bearer ghp_example"));
        assert_eq!(named(&headers, &ACCEPT).as_deref(), Some(ACCEPT_BINARY));
        assert_eq!(headers.len(), 2, "every header the updater sends is pinned here");

        // Pasted with a stray newline, still the same token.
        let headers = request_headers(Some(" ghp_example\n"), ACCEPT_JSON);
        assert_eq!(named(&headers, &AUTHORIZATION).as_deref(), Some("Bearer ghp_example"));
    }

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_static(value));
        }
        map
    }

    fn code(result: Result<(), Refusal>) -> String {
        result.unwrap_err().code
    }

    #[test]
    fn success_is_success_with_or_without_a_token() {
        for status in [200, 204] {
            assert_eq!(classify(status, &HeaderMap::new(), false, 0), Ok(()));
            assert_eq!(classify(status, &HeaderMap::new(), true, 0), Ok(()));
        }
    }

    #[test]
    fn a_404_means_nothing_is_visible_whoever_asks() {
        // GitHub answers a private repo and a repo with no release the same
        // way to an outsider, so there is one code for both.
        assert_eq!(code(classify(404, &HeaderMap::new(), false, 0)), NONE_VISIBLE);
        assert_eq!(code(classify(404, &HeaderMap::new(), true, 0)), NONE_VISIBLE);
    }

    #[test]
    fn the_hourly_limit_is_told_apart_from_a_refused_token() {
        let exhausted = headers(&[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "1791054785")]);

        let anonymous = classify(403, &exhausted, false, 1_791_050_000).unwrap_err();
        assert_eq!(anonymous.code, RATE_LIMITED);
        assert_eq!(anonymous.resets_at, Some(1_791_054_785), "the reset GitHub sent");

        // Same answer with a token: still a limit, not a bad token, and the
        // advice to add a token would be wrong.
        let with_token = classify(403, &exhausted, true, 1_791_050_000).unwrap_err();
        assert_eq!(with_token.code, RATE_LIMITED_TOKEN);
        assert_eq!(with_token.resets_at, Some(1_791_054_785));

        // A reset header alone does not make a limit: GitHub sends it on every
        // answer, and here there are requests left.
        let plenty = headers(&[("x-ratelimit-remaining", "41"), ("x-ratelimit-reset", "1791054785")]);
        assert_eq!(code(classify(403, &plenty, true, 0)), TOKEN_REJECTED);
    }

    #[test]
    fn a_429_or_a_secondary_limit_is_a_limit_too() {
        let none = HeaderMap::new();
        let refusal = classify(429, &none, false, 100).unwrap_err();
        assert_eq!(refusal.code, RATE_LIMITED);
        assert_eq!(refusal.resets_at, None, "GitHub said nothing about when");

        // `retry-after` is in seconds from now.
        let retry = headers(&[("retry-after", "60")]);
        let refusal = classify(403, &retry, false, 1_000).unwrap_err();
        assert_eq!(refusal.code, RATE_LIMITED);
        assert_eq!(refusal.resets_at, Some(1_060));

        // Both said: whichever lifts later is the one that still binds.
        let both = headers(&[
            ("x-ratelimit-remaining", "0"),
            ("x-ratelimit-reset", "5000"),
            ("retry-after", "60"),
        ]);
        assert_eq!(classify(429, &both, false, 1_000).unwrap_err().resets_at, Some(5_000));

        // A header that is not a number is not a time.
        let garbage = headers(&[("retry-after", "Wed, 21 Oct 2026 07:28:00 GMT")]);
        assert_eq!(classify(429, &garbage, false, 0).unwrap_err().resets_at, None);
    }

    #[test]
    fn a_401_is_a_bad_token_only_when_a_token_was_sent() {
        assert_eq!(code(classify(401, &HeaderMap::new(), true, 0)), TOKEN_REJECTED);
        // GitHub has no credential to refuse in an anonymous request.
        assert_eq!(code(classify(401, &HeaderMap::new(), false, 0)), NETWORK);
        assert_eq!(code(classify(403, &HeaderMap::new(), false, 0)), NETWORK);
    }

    #[test]
    fn a_list_that_leaves_too_few_requests_is_the_limit_with_its_reset() {
        // The plugin's own refusals cannot be read, so the release list's count
        // decides before the plugin asks: a check needs one more request, an
        // install three.
        assert_eq!(Next::Check.requests(), 1);
        assert_eq!(Next::Install.requests(), 3);

        // The list took the last request: latest.json would be refused and
        // read as "no release". Named as the limit instead, with its reset.
        let spent = headers(&[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "1791054785")]);
        assert_eq!(
            budget_covers(&spent, Next::Check, false),
            Err(Refusal { code: RATE_LIMITED.into(), resets_at: Some(1_791_054_785) })
        );
        // With a token it is the token's limit, without the advice to add one.
        assert_eq!(budget_covers(&spent, Next::Check, true).unwrap_err().code, RATE_LIMITED_TOKEN);

        // One left covers a check, not an install, whose installer download
        // would otherwise fail as "network".
        let one = headers(&[("x-ratelimit-remaining", "1"), ("x-ratelimit-reset", "1791054785")]);
        assert_eq!(budget_covers(&one, Next::Check, false), Ok(()));
        let short = budget_covers(&one, Next::Install, false).unwrap_err();
        assert_eq!(short.code, RATE_LIMITED);
        assert_eq!(short.resets_at, Some(1_791_054_785), "the hourly window is what is short");
        let three = headers(&[("x-ratelimit-remaining", "3")]);
        assert_eq!(budget_covers(&three, Next::Install, false), Ok(()));

        // No count, or one that is not a number, is nothing to go on: the
        // steps run, and GitHub's own answers are judged as before.
        assert_eq!(budget_covers(&HeaderMap::new(), Next::Install, false), Ok(()));
        let garbage = headers(&[("x-ratelimit-remaining", "plenty")]);
        assert_eq!(budget_covers(&garbage, Next::Install, false), Ok(()));
        // Spent with no reset sent: the limit, and no invented time.
        let no_reset = headers(&[("x-ratelimit-remaining", "0")]);
        assert_eq!(budget_covers(&no_reset, Next::Check, false).unwrap_err().resets_at, None);
    }

    #[test]
    fn everything_else_is_the_quiet_network_failure() {
        for status in [301, 400, 409, 451, 500, 502, 503] {
            assert_eq!(code(classify(status, &HeaderMap::new(), false, 0)), NETWORK, "{status}");
            assert_eq!(code(classify(status, &HeaderMap::new(), true, 0)), NETWORK, "{status}");
        }
    }

    #[test]
    fn every_error_code_is_one_word() {
        // `errors.ts` keeps only the last space-separated word of a rejection.
        for code in [NONE_VISIBLE, RATE_LIMITED, RATE_LIMITED_TOKEN, TOKEN_REJECTED, NETWORK, BAD_HOST] {
            assert!(!code.contains(' '), "{code} would be truncated by the frontend");
        }
    }

    #[test]
    fn a_redirect_is_followed_only_out_of_the_tokens_host() {
        let api = home();
        let storage = Url::parse("https://release-assets.githubusercontent.com/a/b?sig=x").unwrap();
        let asset = Url::parse("https://api.github.com/repos/MAECLY/versorium-app/releases/assets/7").unwrap();
        let moved = Url::parse("https://api.github.com/repositories/1/releases/assets/7").unwrap();

        // GitHub's real shape: API → storage, one hop. reqwest drops the
        // token on this hop because the host changes.
        assert!(may_follow(&api, &storage, std::slice::from_ref(&asset)));
        // A repository that moved answers from the API to the API first.
        assert!(may_follow(&api, &moved, std::slice::from_ref(&asset)));
        assert!(may_follow(&api, &storage, &[asset.clone(), moved.clone()]));

        // A second hop off the storage host is the one reqwest would send
        // the token on again. Refused.
        let again = Url::parse("https://release-assets.githubusercontent.com/elsewhere").unwrap();
        assert!(!may_follow(&api, &again, &[asset.clone(), storage.clone()]));
        let back = Url::parse("https://api.github.com/repos/x").unwrap();
        assert!(!may_follow(&api, &back, &[asset.clone(), storage.clone()]));

        // Never down to plain http, not even out of the API.
        let plain = Url::parse("http://release-assets.githubusercontent.com/a").unwrap();
        assert!(!may_follow(&api, &plain, std::slice::from_ref(&asset)));

        // Same host on another port is another origin.
        let other_port = Url::parse("https://api.github.com:8443/x").unwrap();
        assert!(!may_follow(&api, &storage, &[asset.clone(), other_port]));

        // A loop on the API is cut off at reqwest's own ceiling.
        let loop_chain = vec![asset.clone(); MAX_REDIRECTS + 1];
        assert!(!may_follow(&api, &moved, &loop_chain));
        assert!(may_follow(&api, &moved, &loop_chain[..MAX_REDIRECTS]));

        // Nothing to follow from is nothing to follow.
        assert!(!may_follow(&api, &storage, &[]));
    }

    #[test]
    fn both_clients_build_with_the_rule_in_place() {
        crypto_provider();
        assert!(client().is_ok());
        assert!(plugin_client(updater_reqwest::Client::builder()).build().is_ok());
    }

    /// The plugin's reqwest is built with `rustls-no-provider` and the plugin
    /// installs ring before each request; a test building that client has to
    /// do the same.
    fn crypto_provider() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    /// One request as seen by a loopback host: path and `Authorization`.
    type Seen = std::sync::Arc<std::sync::Mutex<Vec<(String, Option<String>)>>>;

    /// Two loopback listeners standing in for GitHub's two hosts: `home` plays
    /// api.github.com, `away` the storage host that asset downloads are
    /// redirected to. They differ by port, which reqwest counts as a different
    /// host, exactly as it counts a different name.
    struct Loopback {
        home: Url,
        away: Url,
        seen: Seen,
    }

    impl Loopback {
        fn start() -> Self {
            let home_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let away_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
            let home = Url::parse(&format!("http://127.0.0.1:{}", home_listener.local_addr().unwrap().port())).unwrap();
            let away = Url::parse(&format!("http://127.0.0.1:{}", away_listener.local_addr().unwrap().port())).unwrap();
            let seen = Seen::default();
            let to_away = |path: &str| Some(away.join(path).unwrap().to_string());
            Self::serve(
                home_listener,
                "home",
                vec![("/one-hop", to_away("/final")), ("/two-hops", to_away("/hop1"))],
                seen.clone(),
            );
            Self::serve(
                away_listener,
                "away",
                vec![("/final", None), ("/hop1", to_away("/hop2")), ("/hop2", None)],
                seen.clone(),
            );
            Self { home, away, seen }
        }

        /// Each route redirects to `Some(location)` or answers 200. Detached:
        /// the listener lives as long as the test process.
        fn serve(listener: std::net::TcpListener, name: &'static str, routes: Vec<(&'static str, Option<String>)>, seen: Seen) {
            use std::io::{BufRead, Write};
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { continue };
                    let Ok(clone) = stream.try_clone() else { continue };
                    let mut reader = std::io::BufReader::new(clone);
                    let mut first = String::new();
                    if reader.read_line(&mut first).is_err() {
                        continue;
                    }
                    let path = first.split_whitespace().nth(1).unwrap_or_default().to_string();
                    let mut authorization = None;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                            break;
                        }
                        if let Some((key, value)) = line.split_once(':') {
                            if key.eq_ignore_ascii_case("authorization") {
                                authorization = Some(value.trim().to_string());
                            }
                        }
                    }
                    seen.lock().unwrap().push((format!("{name}{path}"), authorization));
                    let reply = match routes.iter().find(|(route, _)| *route == path) {
                        Some((_, Some(location))) => format!(
                            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        ),
                        Some((_, None)) => "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".into(),
                        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
                    };
                    let _ = stream.write_all(reply.as_bytes());
                }
            });
        }

        fn seen(&self) -> Vec<(String, Option<String>)> {
            self.seen.lock().unwrap().clone()
        }

        fn url(&self, path: &str) -> String {
            self.home.join(path).unwrap().to_string()
        }
    }

    /// What every loopback test asserts: the token reached `home` and nothing
    /// else, the one-hop download arrived, and the second hop on the storage
    /// host was never even requested.
    fn assert_token_stayed_home(net: &Loopback, token: Option<&str>) {
        let sent = usable(token).map(|t| format!("Bearer {t}"));
        assert_eq!(
            net.seen(),
            vec![
                ("home/one-hop".to_string(), sent.clone()),
                ("away/final".to_string(), None),
                ("home/two-hops".to_string(), sent),
                ("away/hop1".to_string(), None),
            ],
            "away/hop2 is where the token would have gone back out (see may_follow)"
        );
        assert_ne!(net.home, net.away);
    }

    #[test]
    fn our_client_never_lets_the_token_follow_a_redirect_off_its_host() {
        for token in [Some("ghp_secret"), None] {
            let net = Loopback::start();
            let client = reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(5))
                .redirect(redirects(net.home.clone()))
                .build()
                .unwrap();
            let get = |path: &str| {
                let mut request = client.get(net.url(path));
                for (name, value) in request_headers(token, ACCEPT_BINARY) {
                    request = request.header(name, value);
                }
                request.send()
            };
            let (one, two) = tauri::async_runtime::block_on(async { (get("/one-hop").await, get("/two-hops").await) });
            // First, so that losing the rule fails on the leaked hop itself.
            assert_token_stayed_home(&net, token);
            assert_eq!(one.expect("one hop").status().as_u16(), 200);
            let refused = two.expect_err("a second hop off home is refused");
            assert!(refused.is_redirect(), "maps to {BAD_HOST}: {refused}");
        }
    }

    #[test]
    fn the_plugins_client_never_lets_the_token_follow_a_redirect_off_its_host() {
        // The installer download goes through this client, not ours.
        crypto_provider();
        for token in [Some("ghp_secret"), None] {
            let net = Loopback::start();
            let client = updater_reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(5))
                .redirect(plugin_redirects(net.home.clone()))
                .build()
                .unwrap();
            let get = |path: &str| {
                let mut request = client.get(net.url(path));
                for (name, value) in request_headers(token, ACCEPT_BINARY) {
                    request = request.header(name, value);
                }
                request.send()
            };
            let (one, two) = tauri::async_runtime::block_on(async { (get("/one-hop").await, get("/two-hops").await) });
            // First, so that losing the rule fails on the leaked hop itself.
            assert_token_stayed_home(&net, token);
            assert_eq!(one.expect("one hop").status().as_u16(), 200);
            let refused = two.expect_err("a second hop off home is refused");
            assert!(refused.is_redirect(), "maps to {BAD_HOST}: {refused}");
        }
    }

    /// Against the real API. Runs anonymously when no token is configured, which
    /// is the path most installs take now: `cargo test -- --ignored live_`.
    #[test]
    #[ignore = "talks to the GitHub API, with the configured updates token if there is one"]
    fn live_the_release_endpoint_answers_or_says_why() {
        let token = crate::paths::settings_path()
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|settings| settings.get("githubUpdatesToken")?.as_str().map(str::to_string));
        eprintln!("asking {}", if token.is_some() { "with a token" } else { "anonymously" });
        match tauri::async_runtime::block_on(latest_manifest_url(token.as_deref(), "stable", Next::Check)) {
            Ok(url) => {
                eprintln!("manifest: {url}");
                assert!(url.starts_with("https://api.github.com/"));
            }
            // Every one of these is a real answer about a repo that may have no
            // release yet, or may still be private, not a test failure.
            Err(refusal) => {
                eprintln!("no manifest yet: {} (resets at {:?})", refusal.code, refusal.resets_at);
                assert!(matches!(
                    refusal.code.as_str(),
                    "no_release"
                        | "no_manifest"
                        | NONE_VISIBLE
                        | RATE_LIMITED
                        | RATE_LIMITED_TOKEN
                        | TOKEN_REJECTED
                        | NETWORK
                ));
            }
        }
    }
}
