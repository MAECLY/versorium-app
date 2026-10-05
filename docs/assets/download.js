/* The download section's two jobs.

   Every a[data-dl] (hero, download section, closing) points at the release
   page as the HTML ships it. Here it gets the file for the visitor's system:
   the a[data-file] of the list that matches html[data-os] (theme.js). A Mac
   needs its processor too, which only Chromium tells (html[data-arch], set
   here); until then, and for good in Safari and Firefox, the buttons point
   at the list, where both Mac files are, so an Intel Mac is never handed the
   Apple silicon file. Phones and unknown systems keep the release page (the
   buttons are hidden on phones anyway). The labels are the stylesheet's,
   from data-os alone, so nothing here changes text.

   On a phone, "Send it to your computer" hands the page's own address to
   the system share sheet, or opens an email to oneself where there is none.
   The email and copy links beside it are plain HTML and work without this. */

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

  function pointDownloads() {
    var os = html.getAttribute("data-os");
    var arch = html.getAttribute("data-arch");
    var href;
    if (os === "mac") {
      var mac = arch && document.querySelector('a[data-file="mac-' + (arch === "x86" ? "intel" : "arm") + '"]');
      href = mac ? mac.href : section ? "#" + section.id : "";
    } else {
      var file = document.querySelector('a[data-file="' + os + '"]');
      href = file ? file.href : "";
    }
    if (!href) return;
    var links = document.querySelectorAll("a[data-dl]");
    for (var i = 0; i < links.length; i += 1) links[i].href = href;
  }

  wireShare();
  pointDownloads();
  var ua = navigator.userAgentData;
  if (html.getAttribute("data-os") === "mac" && ua && ua.getHighEntropyValues) {
    ua.getHighEntropyValues(["architecture"]).then(function (v) {
      var arch = v.architecture === "x86" ? "x86" : v.architecture === "arm" ? "arm" : "";
      if (!arch) return;
      html.setAttribute("data-arch", arch);
      pointDownloads();
    }, function () {});
  }
})();
