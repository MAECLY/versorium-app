// The FAQPage JSON-LD must say exactly what the visible FAQ says, question by
// question, on both pages. Opens every <details> first: innerText of a closed
// one is empty, which is not a mismatch.
//
//   python3 -m http.server 8700 -d docs   (in another shell)
//   node tests/landing/faq-ld-parity.mjs [baseUrl]

import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:8700";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
let bad = 0;
for (const path of ["/", "/en/"]) {
  await page.goto(BASE + path, { waitUntil: "load" });
  const result = await page.evaluate(() => {
    document.querySelectorAll(".faq details").forEach((d) => (d.open = true));
    const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    const faq = ld["@graph"].find((n) => n["@type"] === "FAQPage").mainEntity;
    const dom = [...document.querySelectorAll(".faq details")].map((d) => ({
      // textContent, not innerText: an answer that is still opening has no rendered text yet.
      q: d.querySelector("summary").textContent.trim(),
      a: [...d.querySelectorAll(".answer p")].map((p) => p.textContent.replace(/\s+/g, " ").trim()).join(" "),
    }));
    return dom.map((d, i) => ({
      q: d.q,
      sameQuestion: faq[i]?.name === d.q,
      sameAnswer: faq[i]?.acceptedAnswer?.text === d.a,
      dom: d.a,
      ld: faq[i]?.acceptedAnswer?.text,
    }));
  });
  for (const r of result) {
    const ok = r.sameQuestion && r.sameAnswer;
    if (!ok) bad += 1;
    console.log(`${ok ? "same" : "DIFF"} ${path} ${r.q}`);
    if (!ok) console.log(`  dom: ${r.dom}\n  ld:  ${r.ld}`);
  }
}
await browser.close();
console.log(bad ? `${bad} FAQ entries differ` : "every FAQ answer matches its JSON-LD");
process.exitCode = bad ? 1 : 0;
