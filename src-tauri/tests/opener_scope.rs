//! What the shipped capability lets the page hand to the system browser.
//!
//! The page opens web addresses through the opener plugin (`openUrl`, from
//! `src/lib/external.ts` for Settings › About and from
//! `SafetySectionCrash.svelte` for a crash report), and the plugin's
//! `open_url` opens only what its scope allows. In tauri-plugin-opener 2.6.0
//! `Scope::is_url_allowed` is `allowed.iter().any(..)`, false for an empty
//! scope, and `opener:allow-open-url` on its own enables the command with no
//! scope at all. Granted like that, every address was refused with "Not
//! allowed to open url …" in the real app, while the in-browser IPC mock,
//! which applied no ACL, accepted them all.
//!
//! These tests build the app's own context (`generate_context!`: the
//! capabilities resolved against the plugins' ACL manifests by tauri-build,
//! exactly as the shipped binary is built) on Tauri's mock runtime, and ask
//! `plugin:opener|open_url` from the main window, through Tauri's own IPC
//! authorisation and scope lookup. An address the scope allows cannot be
//! given to the real plugin here: it would open the browser. So a stand-in
//! named `opener` does what the plugin's command does up to that point and
//! stops. The real plugin is asked only addresses that open nothing even if
//! its scope let them through: a file that does not exist, and a program
//! that does not exist.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, CommandArg, CommandItem, CommandScope, GlobalScope, InvokeBody, InvokeError};
use tauri::plugin::{Plugin, TauriPlugin};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const REPOSITORY: &str = "https://github.com/MAECLY/versorium-app";

/// A scope entry as the plugin reads one (`scope_entry.rs`): an address
/// pattern, and the program it may be opened with.
#[derive(Debug, Deserialize)]
struct Entry {
    url: Option<String>,
    #[serde(default)]
    app: Program,
}

/// `scope_entry::Application`: absent, only when no program is named; `true`,
/// with any program; a name, with that program only.
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
enum Program {
    #[default]
    Default,
    Any(bool),
    Named(String),
}

impl Entry {
    /// `scope::Entry::matches_url`: a UNIX glob (`glob::Pattern`, which the
    /// plugin uses too) and the program.
    fn matches(&self, url: &str, with: Option<&str>) -> bool {
        let program = match &self.app {
            Program::Default => with.is_none(),
            Program::Any(any) => *any,
            Program::Named(name) => with == Some(name.as_str()),
        };
        let pattern = self.url.as_deref().and_then(|raw| glob::Pattern::new(raw).ok());
        program && pattern.is_some_and(|pattern| pattern.matches(url))
    }
}

/// The plugin's global scope, as its own commands receive it.
/// `#[tauri::command]` names a command's plugin after the crate it is
/// compiled in (`tauri-plugin-opener` gives "opener"); this crate is not a
/// plugin, so a plain `GlobalScope` here would read the app's global scope,
/// which is empty, and the stand-in would refuse what the plugin allows.
struct OpenerGlobalScope(GlobalScope<Entry>);

impl<'a, R: Runtime> CommandArg<'a, R> for OpenerGlobalScope {
    fn from_command(command: CommandItem<'a, R>) -> Result<Self, InvokeError> {
        GlobalScope::from_command(CommandItem { plugin: Some("opener"), ..command }).map(Self)
    }
}

/// The plugin's `open_url` (`commands.rs`, `Scope::is_url_allowed`) without
/// its last line, which opens the browser: the command and global scopes
/// together, a denial winning over any allowance, and the plugin's own words
/// for a refusal.
#[tauri::command]
fn open_url(
    command_scope: CommandScope<Entry>,
    global_scope: OpenerGlobalScope,
    url: String,
    with: Option<String>,
) -> Result<(), String> {
    let with = with.as_deref();
    let mut allowed = command_scope.allows().iter().chain(global_scope.0.allows());
    let mut denied = command_scope.denies().iter().chain(global_scope.0.denies());
    if !denied.any(|entry| entry.matches(&url, with)) && allowed.any(|entry| entry.matches(&url, with)) {
        Ok(())
    } else {
        Err(refusal(&url, with))
    }
}

/// `Error::ForbiddenUrl`, as the plugin serialises it to the page.
fn refusal(url: &str, with: Option<&str>) -> String {
    format!("Not allowed to open url {url}{}", with.map(|program| format!(" with {program}")).unwrap_or_default())
}

fn stand_in() -> TauriPlugin<MockRuntime> {
    tauri::plugin::Builder::new("opener").invoke_handler(tauri::generate_handler![open_url]).build()
}

/// The app's context, with `plugin` as its opener, and its main window: the
/// one the capability names.
fn app_with(plugin: impl Plugin<MockRuntime> + 'static) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .plugin(plugin)
        .build(tauri::generate_context!(test = true))
        .expect("the app's own context builds");
    let main = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().expect("the main window");
    (app, main)
}

/// What the page hears back from `openUrl(url, with)`.
fn ask(window: &WebviewWindow<MockRuntime>, url: &str, with: Option<&str>) -> Result<(), String> {
    let local = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    let request = InvokeRequest {
        cmd: "plugin:opener|open_url".into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: local.parse().unwrap(),
        body: InvokeBody::Json(json!({ "url": url, "with": with })),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    };
    match get_ipc_response(window, request) {
        Ok(_) => Ok(()),
        Err(Value::String(message)) => Err(message),
        Err(other) => Err(other.to_string()),
    }
}

/// Addresses the page has no reason to open, each of which an operating
/// system would hand to some program.
const NEVER: &[&str] = &[
    "http://www.maecly.com",
    "file:///etc/passwd",
    "mailto:someone@example.com",
    "tel:+15555550100",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.com/file",
    "smb://example.com/share",
    "x-apple.systempreferences:com.apple.preference.security",
];

/// What the real plugin may be asked: were its scope ever to let one of
/// these through, the system would be handed a file or a program that does
/// not exist, and start nothing.
const INERT: &[(&str, Option<&str>)] = &[
    ("file:///versorium-opener-test/does-not-exist", None),
    ("https://www.maecly.com/about", Some("versorium-opener-test-no-such-program")),
];

#[test]
fn the_page_may_open_its_https_addresses_in_the_browser() {
    let (_app, main) = app_with(stand_in());
    let addresses = [
        // Settings › About (src/lib/about.ts).
        "https://www.maecly.com/about".to_string(),
        "https://www.maecly.com".to_string(),
        REPOSITORY.to_string(),
        format!("{REPOSITORY}/blob/main/LICENSE"),
        format!("{REPOSITORY}/blob/main/CLA.md"),
        format!("{REPOSITORY}/blob/main/THIRD-PARTY-NOTICES.md"),
        format!("{REPOSITORY}/releases"),
        // A crash report's Report (crash::report_url): a query, encoded.
        format!("{REPOSITORY}/issues/new?title=Crash%3A%20index%20out%20of%20bounds&body=Versorium%200.1.0%0A%60%60%60"),
    ];
    for address in &addresses {
        assert_eq!(ask(&main, address, None), Ok(()), "{address}");
    }
}

#[test]
fn nothing_but_https_may_be_opened_and_only_by_the_default_browser() {
    let (_app, main) = app_with(stand_in());
    for address in NEVER {
        assert_eq!(ask(&main, address, None), Err(refusal(address, None)), "{address}");
    }
    // A named program is not the writer's browser, and the page never names one.
    let about = "https://www.maecly.com/about";
    assert_eq!(ask(&main, about, Some("Safari")), Err(refusal(about, Some("Safari"))));
}

#[test]
fn the_plugin_itself_refuses_them_in_the_same_words() {
    // The real plugin under the same context. The stand-in is asked first, so
    // a widened scope fails there; and what the plugin is asked opens nothing
    // even if the two ever disagree.
    let (_app, main) = app_with(stand_in());
    let (_real_app, real) = app_with(tauri_plugin_opener::init());
    for &(address, with) in INERT {
        let refused = Err(refusal(address, with));
        assert_eq!(ask(&main, address, with), refused, "{address} {with:?}");
        assert_eq!(ask(&real, address, with), refused, "the plugin itself: {address} {with:?}");
    }
}
