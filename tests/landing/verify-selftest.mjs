// Proves that verify.mjs's gates can fail. For each mutation: copy docs/ to a
// temporary folder, break one thing the spec forbids, serve the copy, run
// verify.mjs with only the gate that should catch it, and require exit 1 and
// the expected complaint. The same gate on an untouched copy must not make
// that complaint, so the mutation (not something already wrong) is what
// failed. docs/ itself is never written.
//
//   node tests/landing/verify-selftest.mjs            # every mutation
//   node tests/landing/verify-selftest.mjs words,cls   # some of them
//
// Uses ports 8744 (mutant) and 8745 (untouched copy).

import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DOCS = path.join(ROOT, "docs");
const PORTS = { mutant: 8744, base: 8745 };
const pick = process.argv[2]?.split(",");

/** Replace `from` with `to` in a file of the copy; the mutation fails loudly if `from` is not there. */
async function edit(dir, file, from, to) {
  const p = path.join(dir, file);
  const text = await readFile(p, "utf8");
  if (!text.includes(from)) throw new Error(`${file}: "${from.slice(0, 60)}" not found`);
  await writeFile(p, text.replace(from, to));
}

const ONE = { ROUTES: "/", VARIANTS: "needle-light", WIDTHS: "1280" };

const MUTATIONS = [
  {
    name: "off-origin",
    what: "an image from another server, with the CSP meta removed (so the browser really asks for it)",
    env: { ONLY: "pages,links", ...ONE },
    async mutate(d) {
      await edit(d, "index.html", /<meta http-equiv="Content-Security-Policy"[^>]*>\n/.exec(await readFile(path.join(d, "index.html"), "utf8"))[0], "");
      await edit(d, "index.html", "</main>", '<img src="https://third-party.invalid/pixel.png" width="1" height="1" alt="a pixel from a server that is not this site">\n</main>');
    },
    expect: [/third-party request https:\/\/third-party\.invalid\/pixel\.png/, /loads https:\/\/third-party\.invalid\/pixel\.png from another server/],
  },
  {
    name: "off-origin-css",
    what: "a stylesheet @import from another server",
    env: { ONLY: "links" },
    async mutate(d) {
      await edit(d, "assets/details.css", "", '@import url("https://fonts.invalid/serif.css");\n');
    },
    expect: [/links assets\/details\.css: loads https:\/\/fonts\.invalid\/serif\.css from another server/],
  },
  {
    name: "csp",
    what: "a style attribute, which the page's CSP refuses",
    env: { ONLY: "pages", ...ONE },
    async mutate(d) {
      await edit(d, "index.html", '<p class="sub">', '<p class="sub" style="color: red">');
    },
    expect: [/CSP violation style-src-attr/, /inline styles present/],
  },
  {
    name: "contrast-dom",
    what: "the subtitle's colour too faint in Quarry Dark only",
    env: { ONLY: "pages", ROUTES: "/", VARIANTS: "needle-light,quarry-dark", WIDTHS: "1280" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/site.css"), '\n[data-theme="quarry-dark"] .sub { color: #3b4644; }\n');
    },
    expect: [/\/ quarry-dark 1280: contrast [\d.]+ < 4\.5 for .*\(p\.sub\)/],
    absent: [/needle-light 1280: contrast .*p\.sub/],
  },
  {
    name: "contrast-pixels",
    what: "the same faint subtitle, seen by the pixel check",
    env: { ONLY: "contrast", ROUTES: "/" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/site.css"), '\n[data-theme="quarry-dark"] .sub { color: #3b4644; }\n');
    },
    expect: [/quarry-dark \d+ \.sub .*< 4\.5/],
  },
  {
    name: "reduced-motion",
    what: "reveals left at opacity 0 under reduced motion",
    env: { ONLY: "reduced", ROUTES: "/" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/site.css"), "\n@media (prefers-reduced-motion: reduce) { .tile { opacity: 0; } }\n");
    },
    expect: [/in the HTML, lost under reduced motion: /],
  },
  {
    name: "no-script",
    what: "the tiles' text hidden until script marks the page",
    env: { ONLY: "noscript", ROUTES: "/" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/site.css"), "\nhtml:not(.js) .tile p { visibility: hidden; }\n");
    },
    expect: [/shown with script, lost without it: /],
  },
  {
    name: "motion",
    what: "the tiles hidden while motion runs (motion-safety, Chrome)",
    env: { ONLY: "motion", ROUTES: "/", ENGINES: "chrome" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/site.css"), "\nhtml.motion .tile p { opacity: 0; }\n");
    },
    expect: [/chrome \/ motion js \d+: not shown: p/],
  },
  {
    name: "words",
    what: "thirty more words in S3",
    env: { ONLY: "words", ROUTES: "/" },
    async mutate(d) {
      const thirty = "Una frase más para comprobar que el límite de palabras visibles salta cuando alguien añade texto de más a la página sin quitar otro texto que sobre ahora.";
      await edit(d, "index.html", "</main>", `<p>${thirty} ${thirty.split(" ").slice(0, 2).join(" ")}</p>\n</main>`);
    },
    expect: [/\/ words: \d+ visible words, over 680/, /\/ words \(audit-wordcount\.py\): \d+ visible words, over 680/],
  },
  {
    name: "js-budget",
    what: "4 KB of incompressible bytes in motion.js",
    env: { ONLY: "budget", STATIC: "1" },
    async mutate(d) {
      await appendFile(path.join(d, "assets/motion.js"), `\n/* ${randomBytes(3072).toString("base64")} */\n`);
    },
    expect: [/assets\/motion\.js is [\d.]+ KB raw \(6\)/, /the scripts are [\d.]+ KB gzipped \(9\)/],
  },
  {
    name: "asset-budget",
    what: "the History still padded past its 26 kB",
    env: { ONLY: "budget", STATIC: "1" },
    async mutate(d) {
      const p = path.join(d, "assets/shots/es/history-needle-light.webp");
      await writeFile(p, Buffer.concat([await readFile(p), Buffer.alloc(12 * 1024)]));
    },
    expect: [/asset over its §9\.3 budget: es\/history-needle-light\.webp/],
  },
  {
    name: "cls",
    what: "a paragraph pushed in at the top of main a second after load",
    env: { ONLY: "pages", ...ONE },
    async mutate(d) {
      await appendFile(
        path.join(d, "assets/motion.js"),
        '\nsetTimeout(function () { var p = document.createElement("p"); p.textContent = "Late news."; document.querySelector("main").prepend(p); }, 1000);\n',
      );
    },
    expect: [/\/ needle-light 1280: layout shift 0\.\d+/],
  },
  {
    name: "links",
    what: "a header link to a missing anchor, an in-page link to a missing id, a dead page in llms.txt, a relative path in the 404",
    env: { ONLY: "links" },
    async mutate(d) {
      await edit(d, "index.html", 'href="detalles/#limites"', 'href="detalles/#limits"');
      await edit(d, "en/index.html", 'href="#questions"', 'href="#question"');
      await edit(d, "llms.txt", "https://versorium.maecly.com/en/details/", "https://versorium.maecly.com/en/detail/");
      await edit(d, "404.html", 'href="/en/"', 'href="en/"');
    },
    expect: [
      /links index\.html: detalles\/#limits → no id "limits" in detalles\/index\.html/,
      /links en\/index\.html: #question → no id "question"/,
      /links llms\.txt: https:\/\/versorium\.maecly\.com\/en\/detail\/ → no such file/,
      /links 404\.html: en\/ is relative/,
    ],
  },
  {
    name: "parity",
    what: "one limit dropped from the English page",
    env: { ONLY: "parity" },
    async mutate(d) {
      const p = path.join(d, "en/index.html");
      const html = await readFile(p, "utf8");
      const list = html.indexOf('class="limits');
      const li = html.indexOf("<li", list);
      const end = html.indexOf("</li>", li) + "</li>".length;
      await writeFile(p, html.slice(0, li) + html.slice(end));
    },
    expect: [/\/ ↔ \/en\/: limits 5 vs 4/],
  },
  {
    name: "replica",
    what: "a renamed status-bar button, two swapped ones, and a chapter given another chapter's status",
    env: { ONLY: "replica" },
    async mutate(d) {
      await edit(d, "index.html", '<span class="r-bar-btn">Historial</span>', '<span class="r-bar-btn">Versiones</span>');
      await edit(d, "en/index.html", '<span class="r-bar-btn">Corkboard</span><span class="r-bar-btn">Focus</span>', '<span class="r-bar-btn">Focus</span><span class="r-bar-btn">Corkboard</span>');
      await edit(d, "index.html", '<span class="r-id">ch-01</span><span class="r-title">El inventario</span><span class="r-meta">final</span>', '<span class="r-id">ch-01</span><span class="r-title">El inventario</span><span class="r-meta">revisado</span>');
    },
    expect: [/"Versiones" is neither the app's string/, /\/en\/ script: status bar: "(Focus|Corkboard)" is out of the app's order/, /chapter row ch-01 reads El inventario \/ revisado, not El inventario \/ final/],
  },
  {
    name: "tokens",
    what: "one colour changed inside the copied token block",
    env: { ONLY: "files" },
    async mutate(d) {
      const p = path.join(d, "assets/site.css");
      const css = await readFile(p, "utf8");
      const begin = css.indexOf("tokens:begin");
      const at = css.indexOf("--accent:", begin);
      const hex = css.slice(at).match(/#[0-9a-fA-F]{6}/);
      await writeFile(p, css.slice(0, at) + css.slice(at).replace(hex[0], hex[0] === "#000000" ? "#000001" : "#000000"));
    },
    expect: [/tokens: docs\/assets\/site\.css tokens differ from src\/styles\.css/],
  },
  {
    name: "keyboard",
    what: "the sticky header's scroll padding taken away",
    env: { ONLY: "keyboard", ROUTES: "/" },
    async mutate(d) {
      await edit(d, "assets/site.css", " scroll-padding-top: 72px;", "");
    },
    expect: [/\/ keyboard \d+x\d+: ".*" focused (wholly|partly) under the header/],
  },
  {
    name: "download-url",
    what: "the Spanish JSON-LD's first downloadUrl and first file link moved to the releases page",
    env: { ONLY: "pages", ...ONE },
    async mutate(d) {
      await edit(d, "index.html", '"downloadUrl":["https://github.com/MAECLY/versorium-app/releases/download/v0.1.1/Versorium_0.1.1_apple_silicon.dmg"', '"downloadUrl":["https://github.com/MAECLY/versorium-app/releases/latest"');
      await edit(d, "index.html", '<a class="file" href="https://github.com/MAECLY/versorium-app/releases/download/v0.1.1/Versorium_0.1.1_apple_silicon.dmg"', '<a class="file" href="https://github.com/MAECLY/versorium-app/releases/latest"');
    },
    expect: [/downloadUrl \["https:\/\/github\.com\/MAECLY\/versorium-app\/releases\/latest"/, /the download list is not the release's installers/, /a download button points at https:\/\/github\.com\/MAECLY\/versorium-app\/releases\/latest/],
  },
  {
    name: "compare-source",
    what: "one source dropped from the Spanish comparison page's list",
    env: { ONLY: "compare" },
    async mutate(d) {
      await edit(d, "comparar/index.html", '<a href="https://www.dabblewriter.com/terms">Términos: todos los derechos reservados</a> · ', "");
    },
    expect: [/source dab-terms \(https:\/\/www\.dabblewriter\.com\/terms\) is listed 0 times/],
  },
  {
    name: "compare-price",
    what: "Dabble's three years changed in the Spanish landing only",
    env: { ONLY: "compare" },
    async mutate(d) {
      await edit(d, "index.html", '<span class="vs-num">547,20&nbsp;$</span>', '<span class="vs-num">574,20&nbsp;$</span>');
    },
    expect: [/\/ comparison: Dabble · three: “574,20 \$”, the data says “547,20 \$”/],
    absent: [/\/en\/ comparison: Dabble · three/],
  },
  {
    name: "compare-dash",
    what: "Scrivener's unstated AI turned into a “No” on the English landing",
    env: { ONLY: "compare" },
    async mutate(d) {
      const from = '<td><span class="vs-dash" aria-hidden="true">—</span><span class="sr-only">Not stated on its website</span></td><td>Its own, on credits</td>';
      await edit(d, "en/index.html", from, "<td>No</td><td>Its own, on credits</td>");
    },
    expect: [/\/en\/ comparison: Scrivener 3 · ai: “No”, the data says “—”/],
  },
  {
    name: "compare-words",
    what: "six more words in the Spanish comparison",
    env: { ONLY: "words", ROUTES: "/" },
    async mutate(d) {
      await edit(d, "index.html", "<b>Donde otras van por delante:</b> ", "<b>Donde otras van por delante:</b> y seis palabras más para probar: ");
    },
    expect: [/\/ words: \d+ visible words in #comparar, over 237/, /\/ words \(audit-wordcount\.py\): \d+ visible words in #comparar, over 237/],
  },
  {
    name: "compare-overflow",
    what: "the comparison's scroller without position: relative (its screen-reader words widen the page)",
    env: { ONLY: "pages", ROUTES: "/", VARIANTS: "needle-light", WIDTHS: "375" },
    async mutate(d) {
      await edit(d, "assets/site.css", ".vs-scroll { position: relative; margin-top", ".vs-scroll { margin-top");
    },
    expect: [/\/ needle-light 375: horizontal overflow \d+px at 375/],
  },
  {
    name: "compare-stale",
    what: "the comparison read 200 days ago (today pretended to be 2027-04-22)",
    env: { ONLY: "compare" },
    // Only the mutant run pretends; the untouched copy is checked today.
    mutantEnv: { COMPARE_TODAY: "2027-04-22" },
    async mutate() {},
    expect: [/read on 2026-10-04, 200 days ago: re-read the sources/],
  },
  {
    name: "compare-count",
    what: "the first three weeks' changes miscounted on the Spanish landing",
    env: { ONLY: "compare" },
    async mutate(d) {
      await edit(d, "index.html", "<b>Sigue mejorando:</b> 229 cambios", "<b>Sigue mejorando:</b> 230 cambios");
    },
    expect: [/\/ comparison: says 230 changes; git rev-list --count v0\.1\.0 gives 229/],
  },
  {
    name: "compare-snap",
    what: "the full comparison's snap padding 20 px short of its pinned names (each column rests partly under them)",
    env: { ONLY: "compare", COMPARE_WIDTHS: "390" },
    async mutate(d) {
      await edit(d, "assets/details.css", "scroll-padding-inline-start: var(--vs-app);", "scroll-padding-inline-start: calc(var(--vs-app) - 20px);");
    },
    expect: [/\/comparar\/ at 390px: table\.vs\.vs-a: the pinned columns end at 112px but the snap padding is 92px/, /\/en\/compare\/ at 390px: table\.vs\.vs-b loads scrolled 20px sideways/],
  },
  {
    name: "compare-split",
    what: "the landing table's phone columns back to 104 px, narrower than “Novelcrafter”",
    env: { ONLY: "compare", COMPARE_WIDTHS: "360" },
    async mutate(d) {
      await edit(d, "assets/site.css", "--vs-col: max(122px,", "--vs-col: max(104px,");
    },
    expect: [/\/ at 360px: table\.vs: “Novelcrafter” breaks in the middle/],
  },
  {
    name: "compare-series",
    what: "Versorium's column naming a release series other than the hero pill's",
    env: { ONLY: "compare", COMPARE_WIDTHS: "1280" },
    async mutate(d) {
      await edit(d, "index.html", "<small>v0.1 · probada en macOS, Windows y Linux</small>", "<small>v0.2 · probada en macOS, Windows y Linux</small>");
    },
    expect: [/\/ comparison: Versorium's note names v0\.2, the hero pill v0\.1\.\d+/],
    absent: [/\/en\/ comparison: Versorium's note/],
  },
  {
    name: "ring",
    what: "the hero's ring drawn tight round its label",
    env: { ONLY: "replica" },
    async mutate(d) {
      await edit(d, "assets/site.css", "  left: calc(-6 * var(--px));\n  width: calc(100% + 12 * var(--px));", "  left: 0;\n  width: 100%;");
    },
    expect: [/ring: [\d.-]+ app px from the label left/],
  },
];

function serve(dir, port) {
  const child = spawn("python3", ["-m", "http.server", String(port), "-d", dir], { stdio: "ignore" });
  return child;
}

async function waitFor(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on ${port} did not start`);
}

/** A clone of docs/ (APFS copy-on-write where it can). */
async function copyDocs() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "versorium-selftest-"));
  const target = path.join(dir, "docs");
  const r = spawnSync("cp", ["-cR", DOCS, target]);
  if (r.status !== 0) spawnSync("cp", ["-R", DOCS, target]);
  return { dir, docs: target };
}

function verify(docs, port, env) {
  const res = spawnSync("node", [path.join(ROOT, "tests/landing/verify.mjs")], {
    env: { ...process.env, SHOTS: "0", SITE_URL: `http://localhost:${port}`, DOCS_DIR: docs, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const base = await copyDocs();
const baseServer = serve(base.docs, PORTS.base);
await waitFor(PORTS.base);
const baseRuns = new Map();
const results = [];
try {
  for (const m of MUTATIONS) {
    if (pick && !pick.includes(m.name)) continue;
    const t0 = Date.now();
    const key = JSON.stringify(m.env);
    if (!baseRuns.has(key)) baseRuns.set(key, verify(base.docs, PORTS.base, m.env));
    const untouched = baseRuns.get(key);
    const copy = await copyDocs();
    await m.mutate(copy.docs);
    const server = serve(copy.docs, PORTS.mutant);
    let run;
    try {
      await waitFor(PORTS.mutant);
      run = verify(copy.docs, PORTS.mutant, { ...m.env, ...(m.mutantEnv ?? {}) });
    } finally {
      server.kill();
      await rm(copy.dir, { recursive: true, force: true });
    }
    const problems = [];
    if (run.status !== 1) problems.push(`verify exited ${run.status}, not 1`);
    for (const re of m.expect) {
      if (!re.test(run.out)) problems.push(`no complaint matching ${re}`);
      if (re.test(untouched.out)) problems.push(`the untouched copy already matches ${re}`);
    }
    for (const re of m.absent ?? []) if (re.test(run.out)) problems.push(`complained beyond the mutation: ${re}`);
    const caught = run.out.split("\n").filter((l) => l.startsWith(" - ") && m.expect.some((re) => re.test(l))).map((l) => l.slice(3));
    results.push({ name: m.name, ok: problems.length === 0, problems, caught, seconds: Math.round((Date.now() - t0) / 1000) });
    console.log(`${problems.length ? "NOT CAUGHT" : "caught"}  ${m.name} (${m.env.ONLY}): ${m.what} [${Math.round((Date.now() - t0) / 1000)} s]`);
    for (const c of caught.slice(0, 4)) console.log(`    ${c.slice(0, 160)}`);
    for (const p of problems) console.log(`    !! ${p}`);
    if (problems.length && process.env.VERBOSE) console.log(run.out);
  }
} finally {
  baseServer.kill();
  await rm(base.dir, { recursive: true, force: true });
}

const missed = results.filter((r) => !r.ok);
console.log(`\n${results.length - missed.length} of ${results.length} mutations caught by their gate`);
if (missed.length) process.exitCode = 1;
