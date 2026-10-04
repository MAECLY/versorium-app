/* The download section's two jobs.

   Now, before any release: on a phone, "Send it to your computer" hands the
   page's own address to the system share sheet, or opens an email to oneself
   where there is none. The email and copy links beside it are plain HTML and
   work without this.

   Later, with the release: once #descargar / #download holds download links
   marked a[data-os], the one for the visitor's system becomes the primary
   button, the others move under "Other platforms", and a click opens the
   first-run notes. Until then this part does nothing. */

(function () {
  "use strict";

  var html = document.documentElement;
  var section = document.getElementById("descargar") || document.getElementById("download");

  function wireShare() {
    var buttons = document.querySelectorAll("[data-share]");
    if (!buttons.length) return;
    var canonical = document.querySelector('link[rel="canonical"]');
    var url = (canonical ? canonical.href : location.href.split("#")[0]) + "#" + (section ? section.id : "");
    var mail = document.querySelector('a[href^="mailto:?"]');
    var fallback = function () {
      if (mail) location.href = mail.getAttribute("href");
    };
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        if (!navigator.share) {
          fallback();
          return;
        }
        navigator.share({ title: document.title, url: url }).catch(function (error) {
          if (!error || error.name !== "AbortError") fallback();
        });
      });
    }
  }

  function wireRelease() {
    if (!section) return;
    var links = section.querySelectorAll("a[data-os]");
    if (!links.length) return;
    var os = html.getAttribute("data-os");
    var mine = null;
    for (var i = 0; i < links.length && !mine; i += 1) if (links[i].getAttribute("data-os") === os) mine = links[i];
    var others = section.querySelector(".other-platforms");
    if (mine) {
      var row = mine.parentNode;
      for (var j = 0; j < links.length; j += 1) {
        var link = links[j];
        if (link === mine) continue;
        link.classList.remove("btn-primary");
        if (others && link.parentNode === row) others.appendChild(link);
      }
      mine.classList.add("btn-primary");
      if (row.firstChild !== mine) row.insertBefore(mine, row.firstChild);
    }
    var firstRun = document.getElementById("primera-vez") || document.getElementById("first-run");
    var star = section.querySelector(".star-line");
    for (var k = 0; k < links.length; k += 1) {
      links[k].addEventListener("click", function () {
        if (firstRun) {
          firstRun.open = true;
          firstRun.scrollIntoView({ block: "start" });
        }
        if (star) star.hidden = false;
      });
    }
  }

  wireShare();
  wireRelease();
})();
