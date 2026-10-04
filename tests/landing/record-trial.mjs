// Trial: record the real app (mocked IPC) typing a sentence, as a frame
// sequence, to measure what a short honest loop costs in each format.
// Seeding, the sample novel and the typed sentence are capture.mjs's and
// novel.mjs's own, imported, so the trial and the shipped assets agree.
// Usage: node tests/landing/record-trial.mjs [es|en] ; frames -> /tmp/versorium-redesign/rec/<lang>/
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { boot, catalogue } from "./capture.mjs";
import { typed } from "./novel.mjs";

const lang = process.argv[2] ?? "es";
const OUT = `/tmp/versorium-redesign/rec/${lang}`;
await mkdir(OUT, { recursive: true });
const line = typed[lang];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const { context, page } = await boot(browser, lang, "needle-light", await catalogue(), false, {
  reducedMotion: "no-preference",
});
// Cursor at the end of the second paragraph of the hero chapter.
await page.locator(".cm-content").evaluate((el) => {
  const view = (el.cmTile?.root?.view ?? el.cmTile?.view);
  const doc = view.state.doc.toString();
  const end = doc.indexOf("\n\n", doc.indexOf("\n\n") + 2);
  view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
  view.focus();
});
await page.mouse.move(1276, 300);
const editorBox = await page.locator(".cm-scroller").boundingBox();
const clip = { x: Math.round(editorBox.x), y: 0, width: Math.round(Math.min(editorBox.width, 1280 - editorBox.x)), height: 800 };
let n = 0;
const shot = () => page.screenshot({ path: `${OUT}/f${String(n++).padStart(4, "0")}.png`, clip, animations: "allow", caret: "initial" });
for (let i = 0; i < 6; i++) await shot();            // hold
for (const ch of line) { await page.keyboard.type(ch); await page.waitForTimeout(16); await shot(); }
await page.waitForTimeout(1600);                       // let autosave settle
for (let i = 0; i < 18; i++) { await page.waitForTimeout(60); await shot(); }
await writeFile(`${OUT}/clip.json`, JSON.stringify({ clip, frames: n, scale: 2 }));
console.log("frames", n, "clip", JSON.stringify(clip));
await context.close(); await browser.close();
