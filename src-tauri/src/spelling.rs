//! Spell checking in the webview, which macOS does not switch on for us.
//!
//! WKWebView underlines a misspelling only when the app's own defaults say
//! `WebContinuousSpellCheckingEnabled`, and WebKit registers no default for it:
//! `TextCheckerMac.mm` reads the key with `boolForKey:`, which is NO when the
//! key is absent. Safari turns it on for itself; an app that embeds the view
//! gets it off. So `spellcheck="true"` on the manuscript drew nothing at all
//! until the writer found "Check Spelling While Typing" in a submenu of the
//! right-click menu. `tests/scratch/wkwebview-manuscript-spellcheck-probe.swift`
//! types into the manuscript in a WKWebView and draws both states.
//!
//! Registered, not written. A registered default sits below the app's own
//! domain, so a writer who unticks that menu item keeps the choice they made
//! there, and nothing lands on disk.
//!
//! WebView2 is expected to check spelling without being asked, as Edge does;
//! nobody has looked yet. WebKitGTK does not: it needs
//! `WebContext::set_spell_checking_enabled` and a language list, which is not
//! done here because it can neither be compiled nor seen on a Mac (docs/project/TODO.md).
//! Until it is, Settings → Editor tells a Linux writer that nothing is
//! underlined (`spellingUnderlines` in `src/lib/editor/preferences.ts`); the
//! change that wires WebKitGTK removes that.

/// Must run before the first webview exists: WebKit reads the default once,
/// when its text checker first starts.
#[cfg(target_os = "macos")]
pub fn enable_as_you_type() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str("WebContinuousSpellCheckingEnabled");
    let on = NSNumber::new_bool(true);
    let fallback = NSDictionary::<NSString, AnyObject>::from_slices(&[&*key], &[on.as_ref()]);
    // SAFETY: `registerDefaults:` takes string keys and property-list values,
    // which is exactly what this dictionary holds.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&fallback) };
}

#[cfg(not(target_os = "macos"))]
pub fn enable_as_you_type() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2_foundation::{NSString, NSUserDefaults};

    #[test]
    fn webkit_reads_spell_checking_as_on_once_the_default_is_registered() {
        // The same read TextCheckerMac.mm makes. Without the registration it
        // is NO on a machine nobody configured, which is what kept the
        // manuscript free of underlines.
        super::enable_as_you_type();
        let key = NSString::from_str("WebContinuousSpellCheckingEnabled");
        assert!(NSUserDefaults::standardUserDefaults().boolForKey(&key));
    }
}
