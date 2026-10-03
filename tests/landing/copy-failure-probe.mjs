// The macOS copy button when the clipboard refuses: the failure has to be
// seen, not only announced. Forces writeText to reject, presses Copy, and
// checks that the message is visible, in AA contrast, inside the notice, and
// that a later successful copy hides it again (the status goes back to being
// for screen readers only).
//
//   python3 -m http.server 8730 -d docs   (in another shell)
//   node tests/landing/copy-failure-probe.mjs [baseUrl]
// Screenshots go to /tmp/versorium-landing/copy.

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:8730";
const OUT = "/tmp/versorium-landing/copy";
await mkdir(OUT, { recursive: true });

function contrastOf() {
  const el = document.querySelector(".copy-failed");
  const parse = (v) => v.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let node = el;
  let bg = "rgba(0, 0, 0, 0)";
  while (node && parse(getComputedStyle(node).backgroundColor)[3] === 0) node = node.parentElement;
  if (node) bg = getComputedStyle(node).backgroundColor;
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(parse(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const browser = await chromium.launch({ channel: "chrome" });
let problems = 0;
for (const [lang, route] of [["es", "/"], ["en", "/en/"]]) {
  for (const [width, variant] of [[360, "folio-light"], [1280, "needle-dark"], [1280, "quarry-light"], [375, "quarry-dark"]]) {
    const [theme, mode] = variant.split("-");
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode });
    await context.addInitScript(([t, m]) => {
      localStorage.setItem("versorium.site.theme", t);
      localStorage.setItem("versorium.site.mode", m);
      // The clipboard refuses, as it does without permission or focus.
      let refuse = true;
      window.__allowCopy = () => (refuse = false);
      const real = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (text) => (refuse ? Promise.reject(new Error("denied")) : real ? real(text).catch(() => undefined) : Promise.resolve()) },
      });
    }, [theme, mode]);
    const page = await context.newPage();
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    const button = page.locator("button[data-copy]");
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const failed = await page.evaluate(() => {
      const status = document.getElementById(document.querySelector("button[data-copy]").dataset.status);
      const r = status.getBoundingClientRect();
      const notice = status.closest(".notice").getBoundingClientRect();
      return {
        text: status.textContent,
        visible: getComputedStyle(status).position !== "absolute" && r.width > 20 && r.height > 10,
        inside: r.left >= notice.left && r.right <= notice.right + 0.5,
        role: status.getAttribute("role"),
        button: document.querySelector("button[data-copy]").textContent,
      };
    });
    const ratio = failed.visible ? await page.evaluate(contrastOf) : 0;
    await page.locator(".notice").first().screenshot({ path: `${OUT}/${lang}-${width}-${variant}-failed.png` });
    await page.evaluate(() => window.__allowCopy());
    await button.click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const status = document.getElementById(document.querySelector("button[data-copy]").dataset.status);
      return { hidden: status.classList.contains("sr-only"), text: status.textContent, button: document.querySelector("button[data-copy]").textContent };
    });
    const bad = [];
    if (!failed.visible) bad.push("failure not visible");
    if (!failed.inside) bad.push("failure outside its notice");
    if (failed.role !== "status") bad.push("status lost its role");
    if (ratio < 4.5) bad.push(`contrast ${ratio.toFixed(2)}`);
    if (!after.hidden) bad.push("message still visible after a successful copy");
    problems += bad.length;
    console.log(`${lang} ${width} ${variant}: failed "${failed.text}" (button "${failed.button}") contrast ${ratio.toFixed(2)}; then "${after.button}"${bad.length ? "  <-- " + bad.join("; ") : ""}`);
    await context.close();
  }
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : "the failure shows, reads, and goes away");
process.exitCode = problems ? 1 : 0;
