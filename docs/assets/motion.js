/* What moves (site spec §8.2), once and only towards the finished page the
   HTML already shows; any error leaves that page. Plus the request counter. */

(function () {
  "use strict";

  var html = document.documentElement;
  var stopHero = null;

  /* Off-origin http(s) requests seen by resource timing. */
  function counter() {
    var out = document.querySelector(".req-count"), ext = document.querySelector(".proof-ext");
    if (!out || !window.PerformanceObserver || !performance.getEntriesByType) return;
    var seen = {}, n = 0;
    var look = function (list) {
      list.forEach(function (e) {
        try {
          var u = new URL(e.name);
          if (/^https?:$/.test(u.protocol) && u.origin !== location.origin && !seen[e.name]) seen[e.name] = ++n;
        } catch (x) {}
      });
      out.textContent = n;
      if (ext) ext.hidden = n === 0;
    };
    look(performance.getEntriesByType("resource"));
    try {
      new PerformanceObserver(function (l) { look(l.getEntries()); }).observe({ type: "resource", buffered: true });
    } catch (x) {}
  }

  function onScreen(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function once(target, threshold, fn) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      fn();
    }, { threshold: threshold });
    io.observe(target);
  }

  /* Type, save 800 ms after the last key as the app does, snapshot (§6.4). */
  function hero() {
    var w = document.querySelector(".replica");
    if (!w) return;
    var fig = w.closest("figure"), done = w.querySelector(".t-done");
    var rest = w.querySelector(".t-rest"), count = w.querySelector(".r-words-n"), wc = w.classList;
    if (!done || !rest || !count || performance.now() > 2300) return html.classList.remove("ink");
    var text = rest.textContent, end = +count.textContent;
    var start = end - text.split(/\s+/).filter(Boolean).length;
    var states = "typing idle saving dirty snap played".split(" "), timers = [];
    var clear = function () {
      timers.forEach(clearTimeout);
      timers = [];
      wc.remove.apply(wc, states);
      done.textContent = "";
      rest.textContent = text;
    };
    stopHero = function () {
      clear();
      wc.remove("armed");
      count.textContent = end;
      html.classList.remove("ink");
    };
    var later = function (fn, ms) {
      timers.push(setTimeout(function () {
        try { fn(); } catch (x) { stopHero(); }
      }, ms));
    };
    var type = function (i, n) {
      if (i >= text.length) {
        wc.replace("typing", "idle");
        later(function () { wc.add("saving"); }, 800);
        later(function () { wc.replace("saving", "dirty"); }, 1120);
        later(function () { wc.remove("dirty", "idle"); wc.add("snap"); }, 1720);
        later(function () { wc.add("played"); if (fig) fig.classList.add("is-played"); }, 2220);
        return;
      }
      var ch = text.charAt(i);
      done.textContent += ch;
      rest.textContent = text.slice(i + 1);
      if (ch !== " " && i > 0 && text.charAt(i - 1) === " ") count.textContent = ++n;
      later(function () { type(i + 1, n); }, 30 + ((i * 37) % 19) + (/[,.;:]/.test(ch) ? 110 : 0));
    };
    var play = function () {
      clear();
      count.textContent = start;
      wc.add("typing");
      type(0, start);
    };
    wc.add("armed");
    count.textContent = start;
    once(w, 0.5, function () { later(play, 400); });
    var replay = fig && fig.querySelector(".replay");
    if (replay) replay.addEventListener("click", function () {
      try { play(); } catch (x) { stopHero(); }
    });
  }

  /* On screen already: shown, not played. */
  function reveals() {
    var items = document.querySelectorAll("[data-reveal]");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (onScreen(el)) el.classList.add("is-in", "no-anim");
      else once(el, 0.35, el.classList.add.bind(el.classList, "is-in"));
    }
  }

  /* Swap the active candidate (a <picture> ignores img.src while a <source>
     matches); a new #fragment restarts the play-once clip. */
  function clip(fig) {
    var img = fig.querySelector("picture img");
    if (!img) return;
    var button = fig.querySelector(".clip-replay"), timer;
    var play = function () {
      var sources = img.parentNode.querySelectorAll("source"), hit = null;
      for (var j = 0; j < sources.length && !hit; j++) {
        var q = sources[j].getAttribute("media");
        if (!q || matchMedia(q).matches) hit = sources[j];
      }
      var still = (hit ? hit.getAttribute("srcset") : img.getAttribute("src")) || "";
      var anim = still.split(/\s+/)[0].replace(/(\.anim)?\.webp(#.*)?$/, ".anim.webp") + "#" + Date.now();
      if (hit) hit.setAttribute("srcset", anim);
      else { img.removeAttribute("srcset"); img.setAttribute("src", anim); }
      clearTimeout(timer);
      timer = setTimeout(function () { fig.classList.add("is-played"); }, +fig.getAttribute("data-clip-ms") || 3800);
    };
    /* Pinned, the desk figures share one spot: the caption decides. */
    var step = fig.closest(".step"), pinned = step && getComputedStyle(step).display === "contents";
    once(pinned ? step.querySelector(".step-text") : fig, pinned ? 0.6 : 0.5, play);
    if (button) button.addEventListener("click", play);
  }

  function halt() {
    if (stopHero) stopHero();
    html.classList.remove("ink", "motion");
  }

  counter();
  if (!html.classList.contains("ink") || !window.IntersectionObserver) return html.classList.remove("ink");
  try {
    hero();
    reveals();
    Array.prototype.forEach.call(document.querySelectorAll("[data-clip]"), clip);
    html.classList.add("motion");
  } catch (x) {
    halt();
  }

  /* Motion turned off mid-visit. */
  var still = matchMedia("(prefers-reduced-motion: reduce)");
  var off = function () { if (still.matches) halt(); };
  if (still.addEventListener) still.addEventListener("change", off);
  else if (still.addListener) still.addListener(off);
})();
