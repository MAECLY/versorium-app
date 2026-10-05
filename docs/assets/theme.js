/* The page's theme: the app's three themes, each light, dark or following the
   system. Loaded in <head> without defer so data-theme is set before the body is
   parsed: no flash of the wrong palette, and nothing moves when the picker
   appears. The choice is kept in localStorage and goes nowhere else.

   It also decides, before the first paint, the classes the stylesheet reads:
   js (the scripted controls may show), data-os and phone (which download path
   to offer), and ink (the hero will type its sentence; only when the visitor
   allows motion and has not asked to save data).

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

  /* The visitor's system, for the download path. A phone gets "send it to
     your computer" instead of a link it cannot use; iPadOS reports a Mac, so
     a Mac with a touch screen is taken for one. */
  var ua = navigator.userAgent || "";
  var plat = (navigator.userAgentData && navigator.userAgentData.platform) || "";
  var os =
    /Android/i.test(ua) || plat === "Android"
      ? "android"
      : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
        ? "ios"
        : plat === "macOS" || /Mac OS X|Macintosh/.test(ua)
          ? "mac"
          : plat === "Windows" || /Windows/.test(ua)
            ? "win"
            : plat === "Linux" || plat === "Chrome OS" || /Linux|X11|CrOS/.test(ua)
              ? "linux"
              : "other";
  root.setAttribute("data-os", os);
  if (os === "ios" || os === "android") root.classList.add("phone");
  function stillPreferred() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  try {
    var light = navigator.connection && navigator.connection.saveData;
    if (!stillPreferred() && !light) root.classList.add("ink");
  } catch (e) {
    /* No ink: the page is already in its finished state. */
  }

  apply();

  /* --------------------------------------------------------- screenshots */

  function files(base, variant, widths) {
    if (widths.length === 1) return base + "-" + variant + ".webp";
    return base + "-" + variant + "@1x.webp " + widths[0] + "w, " + base + "-" + variant + ".webp " + widths[1] + "w";
  }

  /* The picker's own label for the current mode, in the page's language. */
  function modeLabel() {
    var input = document.querySelector('#theme-picker input[name="mode"][value="' + state.mode + '"]');
    var label = input && input.closest ? input.closest("label") : null;
    return label ? label.textContent.replace(/\s+/g, " ").trim() : state.mode;
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
           picture's. */
        var from = el.hasAttribute("data-shot") ? el : picture;
        var base = from.getAttribute("data-shot");
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

  /* The new theme spreads from where it was chosen, like ink. The point is
     written to two custom properties on <html> (the CSSOM, which the CSP
     allows), only after a choice, never at load. */
  function inkTransition(update, point) {
    if (!document.startViewTransition || stillPreferred()) {
      update();
      return;
    }
    root.style.setProperty("--ink-x", Math.round(point.x) + "px");
    root.style.setProperty("--ink-y", Math.round(point.y) + "px");
    root.classList.add("vt-ink");
    var end = function () {
      root.classList.remove("vt-ink");
    };
    try {
      var transition = document.startViewTransition(update);
      transition.finished.then(end, end);
    } catch (e) {
      end();
      update();
    }
  }

  function wirePicker() {
    var picker = document.getElementById("theme-picker");
    if (!picker) return;
    syncPicker();
    var pressed = null;
    picker.addEventListener(
      "pointerdown",
      function (event) {
        pressed = { x: event.clientX, y: event.clientY };
      },
      true
    );
    picker.addEventListener(
      "keydown",
      function () {
        pressed = null;
      },
      true
    );
    picker.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || target.type !== "radio") return;
      var point = pressed;
      pressed = null;
      if (!point) {
        /* From the keyboard: the centre of the pill that was chosen. */
        var box = (target.closest ? target.closest("label") || target : target).getBoundingClientRect();
        point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }
      inkTransition(function () {
        choose(target.name, target.value);
      }, point);
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

  /* Focus is never left under the sticky header. scroll-padding-top in the
     stylesheet makes the browser stop below it; but Firefox does not scroll
     at all for a control it counts as on screen, even when the header covers
     it. After a keyboard focus has settled, such a control is brought out
     (scrollIntoView honours the same padding). */
  function wireFocusClearance() {
    var header = document.querySelector(".topbar");
    if (!header || !window.requestAnimationFrame) return;
    document.addEventListener("focusin", function (event) {
      var el = event.target;
      if (!el || !el.getBoundingClientRect || header.contains(el)) return;
      window.requestAnimationFrame(function () {
        var keyboard = true;
        try {
          keyboard = el.matches(":focus-visible");
        } catch (e) {
          /* No :focus-visible: treat every focus as the keyboard's. */
        }
        if (document.activeElement !== el || !keyboard) return;
        var box = el.getBoundingClientRect();
        /* Chrome leaves a control half out of a sideways-scrolling table where it is. */
        var row = el.closest && el.closest(".vs-scroll");
        var side = false;
        if (row) {
          var r = row.getBoundingClientRect();
          var pins = parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
          side = box.left < r.left + pins - 0.5 || box.right > r.right + 0.5;
        }
        /* "start": the snap point a column sits on, beside the pinned ones. */
        if (side) el.scrollIntoView({ block: "nearest", inline: "start" });
        else if (box.top < header.getBoundingClientRect().bottom) el.scrollIntoView({ block: "nearest" });
      });
    });
  }

  function ready() {
    swapShots();
    wireBreakpoints();
    wirePicker();
    wireCopy();
    wireFocusClearance();
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
