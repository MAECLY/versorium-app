"""Visible words per section of the landing pages, from the static HTML, by the
rules of the site spec's Appendix B (the browser gate in verify.mjs counts the
same way on the rendered page).

A word is a run of non-space characters with a letter or a digit in it. Not
counted: <script>, <style>, <svg>, <template>, anything aria-hidden (the app
window included), .sr-only, [hidden], a closed <details> other than its
<summary>; and, since static HTML has no computed styles, what the stylesheet
hides by default: [data-phone] (a desktop is assumed), .no-picker, .proof-nojs.
"Your system" (.is-yours-label) shows on one platform chip at most, the
visitor's: it is counted once, as on a desktop whose system is listed.
The replay buttons are hidden until their scene has played; they are counted
apart, as the spec's totals leave them out.

    python3 tests/landing/audit-wordcount.py docs/index.html docs/en/index.html
"""

import re
import sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP_TAGS = {"script", "style", "svg", "template", "head"}
SKIP_CLASSES = {"sr-only", "no-picker", "proof-nojs"}
LATER_CLASSES = {"replay", "clip-replay"}
ONCE_CLASSES = {"is-yours-label"}


class Counter(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []  # (tag, skip, later, section, in_closed_details, in_summary)
        self.per = {}
        self.later = 0
        self.once = set()

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        classes = set((a.get("class") or "").split())
        parent = self.stack[-1] if self.stack else (None, False, False, "other", False, False)
        skip = parent[1] or tag in SKIP_TAGS or a.get("aria-hidden") == "true" or "hidden" in a or "data-phone" in a or bool(classes & SKIP_CLASSES)
        for c in classes & ONCE_CLASSES:
            skip = skip or c in self.once
            self.once.add(c)
        later = parent[2] or bool(classes & LATER_CLASSES)
        section = parent[3]
        if tag in ("section", "header", "footer") and (a.get("id") or tag != "section"):
            section = a.get("id") or tag
        if tag == "section" and "hero" in classes:
            section = "hero"
        closed = parent[4] or (tag == "details" and "open" not in a)
        summary = parent[5] or tag == "summary"
        self.stack.append((tag, skip, later, section, closed, summary))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        while self.stack:
            if self.stack.pop()[0] == tag:
                break

    def handle_data(self, data):
        if not self.stack:
            return
        tag, skip, later, section, closed, summary = self.stack[-1]
        if skip or (closed and not summary):
            return
        words = len([w for w in re.findall(r"\S+", data) if re.search(r"[^\W_]", w)])
        if not words:
            return
        if later:
            self.later += words
            return
        self.per[section] = self.per.get(section, 0) + words


for path in sys.argv[1:]:
    c = Counter()
    c.feed(open(path, encoding="utf-8").read())
    total = sum(c.per.values())
    print(f"== {path}")
    for k, v in c.per.items():
        print(f"  {k:12s} {v}")
    print(f"  TOTAL {total} (+{c.later} once the replay buttons show)")
