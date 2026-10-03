/* The page's theme: the app's three themes, each light, dark or following the
   system. Loaded in <head> without defer so data-theme is set before the body is
   parsed: no flash of the wrong palette, and nothing moves when the picker
   appears. The choice is kept in localStorage and goes nowhere else.

   Screenshots follow the theme too. Each <picture data-shot> names its files
   by pattern; when the theme changes, the sources are rewritten and the
   browser fetches the one variant it now needs. A <source> that carries its
   own data-shot (the phone crops do) names its own files the same way.

   And their alt text follows what is on screen. An <img> whose picture has a
   phone crop is written with an alt that describes the crop in words that
   hold for the full window as well (that is what a page without script
   says); its data-alt describes the full window, and is used whenever the
   crop's media query does not match. Either may name the theme and mode the
   visitor picked, as {theme} and {mode}, and so may a data-alt-detail that
   stands in for the written alt. */

(function () {
  "use strict";

  var THEMES = ["folio", "quarry", "needle"];
  var MODES = ["light", "dark", "follow"];
  var DEFAULT_THEME = "needle";
  var DEFAULT_MODE = "follow";
  var KEY_THEME = "versorium.site.theme";
  var KEY_MODE = "versorium.site.mode";

  /* --bg-app of each variant, for the browser's own chrome (theme-color).
     Same values as src/styles.css; tests/landing/verify.mjs checks them. */
  var CHROME = {
    "folio-light": "#e7dfd0",
    "folio-dark": "#1c1914",
    "quarry-light": "#e8e6e1",
    "quarry-dark": "#161615",
    "needle-light": "#e4ebe9",
    "needle-dark": "#0f1615",
  };

  var NAMES = { folio: "Folio", quarry: "Quarry", needle: "Needle" };

  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function stored(key, allowed, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return allowed.indexOf(value) >= 0 ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function remember(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* Private mode or storage off: the choice lasts for this page only. */
    }
  }

  var state = {
    theme: stored(KEY_THEME, THEMES, DEFAULT_THEME),
    mode: stored(KEY_MODE, MODES, DEFAULT_MODE),
  };

  function systemMode() {
    return media && media.matches ? "dark" : "light";
  }

  function modeFor(preferred) {
    return state.mode === "follow" ? preferred : state.mode;
  }

  function apply() {
    var variant = state.theme + "-" + modeFor(systemMode());
    root.setAttribute("data-theme", variant);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i += 1) {
      var forDark = (metas[i].getAttribute("media") || "").indexOf("dark") >= 0;
      metas[i].setAttribute("content", CHROME[state.theme + "-" + modeFor(forDark ? "dark" : "light")]);
    }
  }

  root.classList.add("js");
  apply();

  /* --------------------------------------------------------- screenshots */

  function files(base, variant, widths) {
    if (widths.length === 1) return base + "-" + variant + ".webp";
    return base + "-" + variant + "@1x.webp " + widths[0] + "w, " + base + "-" + variant + ".webp " + widths[1] + "w";
  }

  /* The picker's own label for the current mode, in the page's language. */
  function modeLabel() {
    var label = document.querySelector('#theme-picker input[name="mode"][value="' + state.mode + '"] + .mode');
    return label ? label.textContent : state.mode;
  }

  /* The media query under which a picture shows its phone crop, read from the
     crop's own <source> so it cannot drift from it; null without a crop. */
  function cropQuery(picture) {
    var source = picture.querySelector('source[data-shot][data-mode="light"]');
    return source && window.matchMedia ? source.getAttribute("media") : null;
  }

  function describe(img, picture) {
    var wide = img.getAttribute("data-alt");
    if (!wide) return;
    /* The alt as written describes the crop; keep it before replacing it. */
    if (!img.hasAttribute("data-alt-detail")) img.setAttribute("data-alt-detail", img.getAttribute("alt") || "");
    var query = cropQuery(picture);
    var text = query && window.matchMedia(query).matches ? img.getAttribute("data-alt-detail") : wide;
    text = text.replace("{theme}", NAMES[state.theme]).replace("{mode}", modeLabel());
    if (img.getAttribute("alt") !== text) img.setAttribute("alt", text);
  }

  function swapShots() {
    var pictures = document.querySelectorAll("picture[data-shot]");
    for (var i = 0; i < pictures.length; i += 1) {
      var picture = pictures[i];
      var parts = picture.querySelectorAll("source, img");
      for (var j = 0; j < parts.length; j += 1) {
        var el = parts[j];
        /* A phone's crop names its own files; everything else uses the
           picture's. A shot of the app's own theme picker has a second set,
           taken with Light or Dark pressed instead of Follow system, so it can
           match this page's; its crop has one too. */
        var from = el.hasAttribute("data-shot") ? el : picture;
        var pinned = state.mode !== "follow" && from.getAttribute("data-shot-pinned");
        var base = pinned || from.getAttribute("data-shot");
        var widths = (from.getAttribute("data-widths") || "").split(",");
        var variant = state.theme + "-" + modeFor(el.getAttribute("data-mode") || "light");
        var next = files(base, variant, widths);
        if (el.tagName === "IMG") {
          var src = base + "-" + variant + (widths.length > 1 ? "@1x" : "") + ".webp";
          if (el.getAttribute("src") !== src) el.setAttribute("src", src);
          if (widths.length > 1 && el.getAttribute("srcset") !== next) el.setAttribute("srcset", next);
          describe(el, picture);
        } else if (el.getAttribute("srcset") !== next) {
          el.setAttribute("srcset", next);
        }
      }
    }
  }

  /* -------------------------------------------------------------- picker */

  function syncPicker() {
    var inputs = document.querySelectorAll('#theme-picker input[type="radio"]');
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      input.checked = input.value === state[input.name];
    }
  }

  function choose(name, value) {
    if (name === "theme" && THEMES.indexOf(value) >= 0) {
      state.theme = value;
      remember(KEY_THEME, value);
    } else if (name === "mode" && MODES.indexOf(value) >= 0) {
      state.mode = value;
      remember(KEY_MODE, value);
    } else {
      return;
    }
    apply();
    swapShots();
  }

  function wirePicker() {
    var picker = document.getElementById("theme-picker");
    if (!picker) return;
    syncPicker();
    picker.addEventListener("change", function (event) {
      var target = event.target;
      if (target && target.type === "radio") choose(target.name, target.value);
    });
  }

  /* ---------------------------------------------------------------- copy */

  function wireCopy() {
    var buttons = document.querySelectorAll("button[data-copy]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function (event) {
        var button = event.currentTarget;
        var status = document.getElementById(button.getAttribute("data-status") || "");
        var text = button.getAttribute("data-copy");
        var label = button.getAttribute("data-label") || button.textContent;
        button.setAttribute("data-label", label);
        var done = function (ok) {
          var message = ok ? button.getAttribute("data-done") : button.getAttribute("data-failed");
          if (status) {
            status.textContent = message;
            /* "Copied" fits on the button, so on success the status only has
               to be heard. A failure does not fit there, and a reader who can
               see needs it as much as one who listens: it shows itself. */
            if (ok) {
              status.classList.add("sr-only");
              status.classList.remove("copy-failed");
            } else {
              status.classList.remove("sr-only");
              status.classList.add("copy-failed");
            }
          }
          if (ok) {
            button.textContent = message;
            window.setTimeout(function () {
              button.textContent = label;
              if (status) status.textContent = "";
            }, 2500);
          }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              done(true);
            },
            function () {
              done(false);
            }
          );
        } else {
          done(false);
        }
      });
    }
  }

  /* --------------------------------------------------------------- hero */

  /* The HTML can name only one variant of the hero shot, and the browser's
     preload scanner would fetch it before this script could say which one the
     visitor needs; a returning visitor on Folio or Quarry would then download
     the hero twice. So the hero ships with loading="lazy", which keeps the
     scanner away, and is switched to eager here the moment the parser inserts
     it, already pointing at the right file. Without script it still loads,
     lazily, at the first layout. */
  function promote() {
    swapShots();
    var eager = document.querySelectorAll("img[data-eager]");
    for (var i = 0; i < eager.length; i += 1) {
      if (eager[i].getAttribute("loading") !== "eager") eager[i].setAttribute("loading", "eager");
    }
  }

  var watcher = null;
  if (document.readyState === "loading" && window.MutationObserver) {
    watcher = new MutationObserver(function () {
      if (document.querySelector("img[data-eager]:not([loading='eager'])")) promote();
    });
    watcher.observe(root, { childList: true, subtree: true });
  }

  /* Turning a tablet, or narrowing a window, swaps a crop for its full window
     or back; the alt text has to swap with it. */
  function wireBreakpoints() {
    var seen = {};
    var pictures = document.querySelectorAll("picture[data-shot]");
    for (var i = 0; i < pictures.length; i += 1) {
      var query = cropQuery(pictures[i]);
      if (!query || seen[query]) continue;
      seen[query] = true;
      var list = window.matchMedia(query);
      if (list.addEventListener) list.addEventListener("change", swapShots);
      else if (list.addListener) list.addListener(swapShots);
    }
  }

  function ready() {
    if (watcher) watcher.disconnect();
    promote();
    wireBreakpoints();
    wirePicker();
    wireCopy();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  /* Following the system means following it live, as the app does. */
  if (media) {
    var onSystem = function () {
      if (state.mode === "follow") apply();
    };
    if (media.addEventListener) media.addEventListener("change", onSystem);
    else if (media.addListener) media.addListener(onSystem);
  }

  /* Another tab changed the theme. */
  window.addEventListener("storage", function (event) {
    if (event.key === KEY_THEME || event.key === KEY_MODE) {
      state.theme = stored(KEY_THEME, THEMES, DEFAULT_THEME);
      state.mode = stored(KEY_MODE, MODES, DEFAULT_MODE);
      apply();
      swapShots();
      syncPicker();
    }
  });
})();
