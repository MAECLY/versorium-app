// Writes the comparison into docs/ from comparison-data.mjs: section IV of
// the landing pages (#comparar / #compare), the full pages (/comparar/,
// /en/compare/, on the details pages' shell), the "Por qué existe" / "Why it
// exists" section of the details pages, and the header and footer links. The
// pages stay static HTML; run this again only when the data is re-dated, and
// compare-parity.mjs (a verify.mjs gate) holds the pages to the data between
// runs. It never touches the release's parts of the pages (download block,
// pill, notices).
//
//   node tests/landing/compare-build.mjs                 # writes docs/
//   node tests/landing/compare-build.mjs --docs /tmp/x   # writes a copy
//
// Facts it takes from the repository, not from this file: the first release's
// commit count (git rev-list --count of the oldest v* tag).

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { APPS, AS_OF, FOUNDING, GROUPS, LANDING, LANDING_ROWS, SOURCES, TABLE_A, TABLE_B } from "./comparison-data.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const args = process.argv.slice(2);
const DOCS = args.includes("--docs") ? path.resolve(args[args.indexOf("--docs") + 1]) : path.join(ROOT, "docs");
const REPO = "https://github.com/MAECLY/versorium-app";

/** The first release: its tag, its date and how many changes led to it. */
export function firstRelease() {
  const tags = execFileSync("git", ["-C", ROOT, "tag", "--list", "v*", "--sort=creatordate"]).toString().split("\n").filter(Boolean);
  const tag = tags[0];
  const commits = Number(execFileSync("git", ["-C", ROOT, "rev-list", "--count", tag]).toString().trim());
  const date = execFileSync("git", ["-C", ROOT, "log", "-1", "--format=%cs", tag]).toString().trim();
  const first = execFileSync("git", ["-C", ROOT, "log", "--reverse", "--format=%cs", tag]).toString().split("\n")[0];
  return { tag, commits, date, first };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// "547,20 $" keeps its sign beside the number.
const money = (s) => s.replace(/(\d) \$/g, "$1&nbsp;$");
const DASH = { es: "Su web no lo dice", en: "Not stated on its website" };
export const dash = (lang) => `<span class="vs-dash" aria-hidden="true">—</span><span class="sr-only">${DASH[lang]}</span>`;
/** A cell's text as HTML: a dash where its website doesn't say (the whole cell, or a part of it). */
export function cellHtml(c, lang) {
  if (!c || c.s === "ns" || c[lang] == null) return dash(lang);
  return money(esc(c[lang])).replace(/(^|\s)—(?=$|[\s.,;])/g, (m, pre) => `${pre}${dash(lang)}`);
}
const byId = Object.fromEntries(APPS.map((a) => [a.id, a]));
// Spanish rayas stay with the words they enclose: a word joiner after an
// opening one and before a closing one (lines break outside the pair only).
const joinRayas = (html) => html.replace(/(\s)—(?=\p{L})/gu, "$1—&#8288;").replace(/(\p{L})—(?=[\s,.;:])/gu, "$1&#8288;—");

// ---------------------------------------------------------------- landing (IV)

const V = '<svg class="vmark" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><use class="v-ink" href="#v-s"/><use class="v-ink hair" href="#v-h"/></svg>';
// The ring around Versorium's price: a loop drawn by hand, closing past its start.
const RING = '<svg class="vs-ring" data-reveal viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path pathLength="1" d="M70 5C50 1 22 3 10 13C1 21 2 40 14 49C27 58 62 59 81 51C96 44 99 27 92 16C86 7 74 3 58 4"/></svg>';
const nib = '<svg class="ink-under" aria-hidden="true" focusable="false"><use href="#nib-stroke"/></svg>';

export const LANDING_COPY = {
  es: {
    id: "comparar", titleId: "comparar-titulo", page: "comparar/",
    title: `Las cartas sobre la <span class="ink-word">${nib}mesa</span>.`,
    cap: "Precios de lista en USD y funciones según la web de cada una en octubre de 2026. Un guion: su web no lo dice.",
    hint: "Desliza la tabla para ver las cinco alternativas",
    corner: "Qué se compara",
    rows: ["Tres años<small>lo más barato</small>", "Dónde vive tu novela", "Historial", "IA", "Cuenta y conexión", "En el móvil"],
    ahead: "<b>Donde otras van por delante:</b> sincronizar equipos, escribir a varias manos y volver a una versión desde la app.",
    better: (n) => `<b>Sigue mejorando:</b> ${n} cambios en tres semanas, y su <a href="${REPO}/blob/main/TODO.md">lista pública</a> incluye restaurar versiones desde la app y respaldos programados.`,
    more: '<a href="comparar/">La comparación completa, con sus fuentes <span aria-hidden="true">→</span></a><a href="detalles/#por-que">Por qué existe <span aria-hidden="true">→</span></a>',
  },
  en: {
    id: "compare", titleId: "compare-title", page: "compare/",
    title: `Cards on the <span class="ink-word">${nib}table</span>.`,
    cap: "List prices in USD and features from each one’s own website, as of October 2026. A dash: the site doesn’t say.",
    hint: "Swipe the table to see all five alternatives",
    corner: "What is compared",
    rows: ["Three years<small>cheapest way</small>", "Where your novel lives", "History", "AI", "Account, offline", "On your phone"],
    ahead: "<b>Where others are ahead:</b> syncing devices, writing with other people, and going back to a version inside the app.",
    better: (n) => `<b>It keeps improving:</b> ${n} changes in its first three weeks, and its <a href="${REPO}/blob/main/TODO.md">public to-do list</a> includes going back to a version inside the app and scheduled backups.`,
    more: '<a href="compare/">The full comparison, with sources <span aria-hidden="true">→</span></a><a href="details/#why">Why it exists <span aria-hidden="true">→</span></a>',
  },
};

/** One landing cell: the row's text, its price set like a ledger, its second line. */
function landingCell(app, row, lang) {
  const l = app.landing;
  const c = l[row];
  if (row === "three") {
    const us = app.id === "versorium";
    const note = l.threeNote ? `<small>${money(esc(l.threeNote[lang]))}</small>` : "";
    return `<span class="vs-num">${money(esc(c[lang]))}${us ? RING : ""}</span>${note}`;
  }
  const note = row === "ai" && l.aiNote ? `<small>${money(esc(l.aiNote[lang]))}</small>` : "";
  return `${cellHtml(c, lang)}${note}`;
}

export function landingSection(lang, { commits }) {
  const t = LANDING_COPY[lang];
  const [us, ...them] = LANDING.map((id) => byId[id]);
  const heads = them.map((a) => `<th scope="col"><a href="${t.page}#${a.id}">${esc(a.name.replace(/ \d+$/, ""))}</a></th>`).join("");
  const body = LANDING_ROWS.map((row, i) => `<tr><th scope="row">${t.rows[i]}</th><td class="is-us">${landingCell(us, row, lang)}</td>${them.map((a) => `<td>${landingCell(a, row, lang)}</td>`).join("")}</tr>`).join("\n");
  return `<section class="section s-vs" id="${t.id}" aria-labelledby="${t.titleId}">
<div class="ink-rule" aria-hidden="true"><svg><use href="#rule"/></svg></div>
<div class="wrap">
<div class="s-head">
<span class="chapter-mark" aria-hidden="true">IV</span>
<h2 id="${t.titleId}">${t.title}</h2>
<p class="vs-cap" id="vs-cap">${t.cap}</p>
</div>
<p class="vs-hint">${t.hint} <span aria-hidden="true">→</span></p>
<div class="vs-scroll">
<table class="vs" aria-labelledby="vs-cap">
<thead><tr><td class="vs-corner"><span class="sr-only">${t.corner}</span></td><th scope="col" class="is-us" abbr="Versorium"><span class="vs-us-name">${V}Versorium</span><small>${esc(us.landing.note[lang])}</small></th>${heads}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>
<div class="vs-notes">
<p>${t.ahead}</p>
<p>${t.better(commits)}</p>
</div>
<p class="vs-more">${t.more}</p>
</div>
</section>
`;
}

// ---------------------------------------------------------------- the short why (FAQ)

// `from`: the answers this one replaces (the original, then earlier wordings).
const FAQ = {
  es: {
    from: [
      "Es código abierto (AGPL-3.0) y lo hace una persona. No hay versión de pago ni anuncios, y la app no recoge datos.",
      "La hizo una persona, Miguel Esparza, para escribir con calma y no perder nunca un borrador sin pagar por ello cada mes. Es código abierto (AGPL-3.0): no hay versión de pago ni anuncios, y la app no recoge datos.",
    ],
    to: "La hizo una persona, Miguel Esparza, para escribir con calma y no perder nunca un borrador, sin pagar una cuota cada mes. Es código abierto (AGPL-3.0): no hay versión de pago ni anuncios, y la app no recoge datos.",
  },
  en: {
    from: [
      "It’s open source (AGPL-3.0) and made by one person. There’s no paid tier and no ads, and the app collects no data.",
      "One person, Miguel Esparza, made it to write calmly and never lose a draft without paying for it every month. It’s open source (AGPL-3.0): there’s no paid tier and no ads, and the app collects no data.",
    ],
    to: "One person, Miguel Esparza, made it so he could write calmly and never lose a draft, without a monthly fee. It’s open source (AGPL-3.0): there’s no paid tier and no ads, and the app collects no data.",
  },
};
const nobreak = (s) => s.replace("(AGPL-3.0)", '(<span class="nobreak">AGPL-3.0</span>)');

/** Section IV, the nav and footer links, and the FAQ answer (page and JSON-LD alike). */
export function applyLanding(html, lang, facts) {
  const t = LANDING_COPY[lang];
  const section = landingSection(lang, facts);
  const at = html.indexOf('<section class="section s-vs"');
  if (at >= 0) {
    const end = html.indexOf("</section>", at) + "</section>\n".length;
    html = html.slice(0, at) + section + html.slice(end).replace(/^\n?/, "\n");
  } else {
    const anchor = '<section class="section s-get"';
    if (!html.includes(anchor)) throw new Error(`no download section in the ${lang} landing`);
    html = html.replace(anchor, () => `${section}\n${anchor}`);
  }
  const nav = lang === "es" ? ['<a href="#como">Cómo funciona</a>', '<a href="#comparar">Comparar</a>'] : ['<a href="#how">How it works</a>', '<a href="#compare">Compare</a>'];
  if (!html.includes(nav[1])) html = html.replace(nav[0], () => `${nav[0]}\n${nav[1]}`);
  const foot = lang === "es" ? ['<li><a href="detalles/">Límites y detalles</a></li>', '<li><a href="comparar/">Comparación</a></li>'] : ['<li><a href="details/">Limits and details</a></li>', '<li><a href="compare/">Comparison</a></li>'];
  if (!html.includes(foot[1])) html = html.replace(foot[0], () => `${foot[0]}\n${foot[1]}`);
  const f = FAQ[lang];
  for (const [froms, to] of [
    [f.from.map((s) => `"text":"${s}"`), `"text":"${f.to}"`],
    [f.from.map((s) => `<p>${nobreak(s)}</p>`), `<p>${nobreak(f.to)}</p>`],
  ]) {
    const from = froms.find((s) => html.includes(s));
    if (from) html = html.replace(from, () => to);
    else if (!html.includes(to)) throw new Error(`the ${lang} free-question answer moved: ${froms[0].slice(0, 50)}`);
  }
  return html;
}

// ---------------------------------------------------------------- the full page

const PAGE = {
  es: {
    lang: "es", self: "comparar/", details: "detalles/", twin: "../en/compare/", main: "contenido", sources: "fuentes", whyHref: "../detalles/#por-que",
    title: "Comparación con las alternativas · Versorium | MAECLY",
    h1: "Versorium y las alternativas",
    desc: (n) => `Versorium al lado de Scrivener, Dabble, Notion, Novelcrafter, Sudowrite y otras ${n - 5}: precios en USD y funciones, cada dato con su fuente, a octubre de 2026.`,
    lead: (n) => `Precio, dónde vive tu novela, historial, IA y más, de ${n} alternativas, tal como lo decía la web de cada una el 4 de octubre de 2026. Cada dato lleva su fuente, y donde otra va por delante, también está aquí.`,
    legend: "Un guion (—) significa que su web no lo dice, no que no lo tenga. Un «No» sobre otra app solo aparece donde su propia web lo dice.",
    tocTitle: "En esta página",
    toc: [["precio", "Precio e IA"], ["tu-novela", "Tu novela"], ["delante", "Donde otras van por delante"], ["versorium", "Donde va por delante Versorium"], ["origen", "La pregunta de origen"], ["mejora", "Sigue mejorando"], ["fuentes", "Fuentes"], ["metodo", "Cómo se hizo"]],
    a: {
      h: "Precio e IA",
      note: "«Tres años»: lo más barato para usarla tres años, a precio de lista y sin impuestos. La IA de otro —tu suscripción, tu clave de API— se paga aparte.",
      cols: ["App", "Precio", "Tres años", "IA", "Cuenta"],
      after: "Con Versorium, la IA puede no costar nada: el modelo de la propia app y Ollama son gratis, Codex entra incluso en el plan gratuito de ChatGPT, con sus límites, y OpenCode trae modelos gratis o entra con tu cuenta de ChatGPT Plus o de GitHub Copilot. Si ya pagas Claude Pro (20 $ al mes, o 17 $ pagando al año) o ChatGPT Plus (20 $), Versorium usa eso y no cobra nada encima.",
    },
    b: { h: "Tu novela: dónde vive y cómo vuelve", cols: ["App", "Dónde vive", "Historial", "Sin conexión", "Móvil", "Código abierto", "Exporta"] },
    srcLink: "fuentes",
    ahead: { h: "Donde otras van por delante", items: [
      "<b>Volver a una versión desde la propia app:</b> Scrivener (instantáneas), Dabble y Google Docs (versiones), Novelcrafter (revisiones), Notion (historial), Obsidian (recuperación de archivos), Novel Engine, Siming y Denova. En Versorium, hoy, hace falta git.",
      "<b>El móvil:</b> Scrivener (iOS), Dabble (como app web), Notion, Sudowrite, Obsidian, iA Writer, Google Docs, Word, bibisco (con Everywhere), yWriter, Plottr (con Pro) y Siming (Android). Versorium no tiene app para el móvil.",
      "<b>Sincronizar equipos:</b> Dabble, Obsidian Sync, Scrivener con Dropbox, bibisco Everywhere, Ulysses con iCloud, Plottr Pro, Siming (entre escritorio y Android, con un Gateway propio) y las apps en la nube. Versorium se apoya en GitHub y en copias a una carpeta sincronizada.",
      "<b>Escribir a varias manos:</b> Google Docs, Notion, Dabble (coautoría), Novelcrafter (plan Specialist), Plottr Pro (en tiempo real) y Obsidian Sync (bóvedas compartidas). Versorium es para una persona.",
      "<b>Años de uso y más sistemas probados:</b> Scrivener, Obsidian, novelWriter y bibisco (desde 2014, en 15 idiomas). Versorium salió el 4 de octubre de 2026 y solo se ha probado en macOS; sus instaladores no van firmados.",
      "<b>Maquetar para imprimir:</b> Atticus, Reedsy Studio y la compilación de Scrivener.",
      "<b>Planificar la trama:</b> Plottr y el Plot Grid de Dabble.",
      "<b>Más IA:</b> Sudowrite (más de 30 modelos; chat y dictado en su app), Novelcrafter (muchos proveedores), Notion (agentes), Novel Engine (de la idea al libro), Siming y Denova (agentes y tareas). La IA de Versorium reescribe y revisa la continuidad: no tiene chat, búsqueda por significado ni dictado, y no detecta Grok ni Gemini CLI.",
    ] },
    us: { h: "Donde va por delante Versorium", items: [
      "<b>Precio:</b> 0&nbsp;$, sin planes. No revende IA: usa la que ya pagas o un modelo gratis en tu equipo.",
      "<b>Tu novela, en archivos tuyos:</b> Markdown en una carpeta que se abre sin la app, como en Obsidian, iA Writer, novelWriter, Novel Engine u OpenWriter.",
      "<b>Historial sin caducidad,</b> como las instantáneas de Scrivener; lo distinto es una instantánea git cada minuto sin que la pidas, otra antes de que la IA escriba, y el registro de cada cambio. Notion guarda de 7 a 90 días según el plan (sin límite, solo en Enterprise); Reedsy, 30 días gratis; Obsidian, 7 días en tu equipo o, con Sync, 1 o 12 meses; Novel Engine, 50 versiones por archivo.",
      "<b>Sin cuenta y sin conexión.</b> Novelcrafter, Reedsy y NovelAI, según sus webs, necesitan conexión.",
      "<b>La IA a tu medida:</b> ninguna, un modelo en tu equipo o la herramienta que ya pagas. Novelcrafter, según su web, no puede usar una suscripción a Claude Pro.",
      "<b>Su propio MCP:</b> solo lee hasta que le des permiso, y hace una instantánea antes de cada escritura.",
      "<b>Los formatos del oficio, de ida y vuelta:</b> exporta DOCX con formato de manuscrito, EPUB 3 (pasa epubcheck), PDF y Scrivener; importa DOCX, EPUB, Scrivener y Markdown.",
      '<b>Código abierto (<span class="nobreak">AGPL-3.0</span>),</b> como novelWriter, bibisco, Novel Engine o Siming.',
    ], label: "Octubre de 2026", close: "No hemos encontrado otra app que lo junte todo." },
    origin: { h: "La pregunta de origen", p: [
      "Versorium empezó con una pregunta, el 11 de septiembre de 2026: ¿hay alguna app para escribir novelas que detecte las IA que ya pagas o ya tienes en tu ordenador —Claude Code, Codex, OpenCode, Ollama—, las use con tu propia suscripción y tenga su propio MCP? La respuesta fue que no: unas apps cobran la IA o piden tu clave de API, y otras herramientas viven en la terminal, sin un escritorio para escribir. Lo más parecido era Novel Engine.",
      "Revisado el 4 de octubre de 2026: Novel Engine usa Claude Code con tu suscripción, Codex y Ollama, y guarda Markdown en tu disco sin nube ni cuentas; su repositorio no menciona un MCP propio. Hay dos más, de código abierto, que entonces no aparecieron: Siming (司命), para Windows y Android, usa Claude Code, Codex y OpenCode, modelos locales con llama.cpp y su propio MCP, y guarda la novela en una base de datos con copia en Markdown; Denova trabaja con sus agentes, Codex o Claude Code, y guarda versiones locales. También han llegado herramientas que viven de MCP —OpenWriter, scrivener-mcp y el MCP oficial de Notion, alojado en su nube— y nuevas herramientas de terminal, como Grok Build, que Versorium aún no detecta.",
    ], tableCap: "Qué junta cada una (Versorium y las más cercanas)", tool: "Herra&shy;mienta", why: "Por qué existe" },
    better: { h: "Sigue mejorando", p: (r) => `La 0.1.0, la primera versión, salió el 4 de octubre de 2026: ${r.commits} cambios en tres semanas, el primero el 14 de septiembre. La 0.1.1 llegó horas después, con sus primeros arreglos. Lo que viene se escribe a la vista:`, items: [
      "<b>En la lista, ya pensado:</b> ver qué cambió entre dos versiones, como en un editor de código; volver a una versión desde la app; elegir cuándo se hacen los respaldos; notas ancladas en cualquier punto del texto; y escribir las sinopsis.",
      "<b>Especificado, sin empezar:</b> un chat sobre el proyecto, buscar por significado y dictado.",
    ], tail: `Es la lista de trabajo pendiente, no una promesa con fechas: <a href="${REPO}/blob/main/TODO.md">TODO.md</a> · <a href="${REPO}/releases">versiones</a> · <a href="${REPO}/issues">cuéntanos qué te falta</a>.` },
    src: { h: "Fuentes", p: "Todas leídas el 4 de octubre de 2026 en la web de cada fabricante o en su repositorio.", ai: "La IA que quizá ya pagas o usas", date: "4 oct. 2026" },
    method: { h: "Cómo se hizo", p: [
      "Cada precio y cada función salen de la web del fabricante o de su repositorio, leídos el 4 de octubre de 2026 con un navegador: algunas tiendas solo muestran el precio después de cargar. Los precios están en dólares (USD), tal como los mostraba cada tienda, y cambian con el país, los impuestos y las promociones. «Tres años» es nuestra cuenta, con precios de lista.",
      'Un guion significa que su web no lo dice; un «No» sobre otra app solo aparece donde su propia web lo dice. Las herramientas de código abierto se buscaron en GitHub. Si falta alguna, o algo cambió o está mal, escribe a <a href="mailto:hola@maecly.com">hola@maecly.com</a> o abre una <a href="https://github.com/MAECLY/versorium-app/issues">incidencia</a>, y se corrige con su fecha. Los nombres son de sus dueños y aquí solo sirven para comparar; no hay logotipos.',
    ] },
    nav: ['<a href="../#como">Cómo funciona</a>', "Comparar"],
    footer: "Comparación",
    marks: "Octubre de 2026",
  },
  en: {
    lang: "en", self: "compare/", details: "details/", twin: "../../comparar/", main: "content", sources: "sources", whyHref: "../details/#why",
    title: "Compared with the alternatives · Versorium | MAECLY",
    h1: "Versorium and the alternatives",
    desc: (n) => `Versorium beside Scrivener, Dabble, Notion, Novelcrafter, Sudowrite and ${n - 5} more: prices in USD and features, each with its source, as of October 2026.`,
    lead: (n) => `Price, where your novel lives, history, AI and more for ${n} alternatives, as each one’s own website gave them on 4 October 2026. Every fact has its source, and where another app is ahead, that is here too.`,
    legend: "A dash (—) means its website doesn’t say, not that it lacks it. A “No” about another app appears only where that app’s own website says so.",
    tocTitle: "On this page",
    toc: [["price", "Price and AI"], ["your-novel", "Your novel"], ["ahead", "Where others are ahead"], ["versorium", "Where Versorium is ahead"], ["origin", "The founding question"], ["improving", "It keeps improving"], ["sources", "Sources"], ["method", "How this was made"]],
    a: {
      h: "Price and AI",
      note: "“Three years”: the cheapest way to use it for three years, at list price, before tax. AI that comes from someone else (your subscription, your API key) is paid for separately.",
      cols: ["App", "Price", "Three years", "AI", "Account"],
      after: "With Versorium, AI can cost nothing: the app’s own model and Ollama are free, Codex comes even with ChatGPT’s free plan, within its limits, and OpenCode brings free models or signs in with your ChatGPT Plus or GitHub Copilot account. If you already pay for Claude Pro ($20 a month, or $17 paid yearly) or ChatGPT Plus ($20), Versorium uses that and charges nothing on top.",
    },
    b: { h: "Your novel: where it lives and how it comes back", cols: ["App", "Where it lives", "History", "Offline", "Phone", "Open source", "Exports"] },
    srcLink: "sources",
    ahead: { h: "Where others are ahead", items: [
      "<b>Going back to a version inside the app:</b> Scrivener (snapshots), Dabble and Google Docs (versions), Novelcrafter (revisions), Notion (history), Obsidian (file recovery), Novel Engine, Siming and Denova. In Versorium, today, that needs git.",
      "<b>Your phone:</b> Scrivener (iOS), Dabble (as a web app), Notion, Sudowrite, Obsidian, iA Writer, Google Docs, Word, bibisco (with Everywhere), yWriter, Plottr (with Pro) and Siming (Android). Versorium has no phone app.",
      "<b>Syncing devices:</b> Dabble, Obsidian Sync, Scrivener through Dropbox, bibisco Everywhere, Ulysses through iCloud, Plottr Pro, Siming (between desktop and Android, through a Gateway you run), and the cloud apps. Versorium relies on GitHub and on backups to a synced folder.",
      "<b>Writing with other people:</b> Google Docs, Notion, Dabble (co-authoring), Novelcrafter (Specialist plan), Plottr Pro (in real time) and Obsidian Sync (shared vaults). Versorium is for one writer.",
      "<b>Years of use and more systems tried:</b> Scrivener, Obsidian, novelWriter and bibisco (since 2014, in 15 languages). Versorium came out on 4 October 2026 and has only been tried on macOS; its installers are unsigned.",
      "<b>Formatting for print:</b> Atticus, Reedsy Studio and Scrivener’s Compile.",
      "<b>Plotting:</b> Plottr and Dabble’s Plot Grid.",
      "<b>More AI:</b> Sudowrite (30+ models; chat and dictation in its app), Novelcrafter (many providers), Notion (agents), Novel Engine (from pitch to book), Siming and Denova (agents and tasks). Versorium’s AI rewrites and checks continuity: no chat, no search by meaning, no dictation, and it doesn’t detect Grok or Gemini CLI.",
    ] },
    us: { h: "Where Versorium is ahead", items: [
      "<b>Price:</b> $0, no plans. It resells no AI: it uses what you already pay for, or a free model on your computer.",
      "<b>Your novel, in your own files:</b> Markdown in a folder that opens without the app, as in Obsidian, iA Writer, novelWriter, Novel Engine or OpenWriter.",
      "<b>History with no expiry,</b> like Scrivener’s snapshots; what’s different is a git snapshot every minute without your asking, another before AI writes, and a log of every change. Notion keeps 7 to 90 days by plan (unlimited only on Enterprise); Reedsy, 30 days free; Obsidian, 7 days on your device or, with Sync, 1 or 12 months; Novel Engine, 50 versions per file.",
      "<b>No account, and it works offline.</b> Novelcrafter, Reedsy and NovelAI, according to their own websites, need a connection.",
      "<b>AI on your terms:</b> none, a model on your computer, or the tool you already pay for. Novelcrafter, according to its own website, can’t use a Claude Pro subscription.",
      "<b>Its own MCP:</b> read-only until you allow writing, with a snapshot before every write.",
      "<b>The trade’s formats, both ways:</b> it exports manuscript-format DOCX, EPUB 3 (it passes epubcheck), PDF and Scrivener, and imports DOCX, EPUB, Scrivener and Markdown.",
      '<b>Open source (<span class="nobreak">AGPL-3.0</span>),</b> like novelWriter, bibisco, Novel Engine or Siming.',
    ], label: "October 2026", close: "We haven’t found another app that brings all of this together." },
    origin: { h: "The founding question", p: [
      "Versorium began with a question, on 11 September 2026: is there a novel-writing app that detects the AIs you already pay for or already run (Claude Code, Codex, OpenCode, Ollama), uses them through your own subscription, and has its own MCP? The answer was no: some apps charge for AI or ask for your API key, and other tools live in the terminal, with no desk to write at. The closest was Novel Engine.",
      "Checked again on 4 October 2026: Novel Engine drives Claude Code on your subscription, Codex and Ollama, and keeps Markdown on your disk with no cloud or accounts; its repository mentions no MCP of its own. Two more, both open source, didn’t come up then: Siming (司命), for Windows and Android, uses Claude Code, Codex and OpenCode, local models through llama.cpp and an MCP of its own, and keeps the novel in a database mirrored as Markdown; Denova works with its own agents, Codex or Claude Code, and keeps local versions. Tools built around MCP have arrived too (OpenWriter, scrivener-mcp, and Notion’s official MCP, hosted in its cloud), and new terminal tools such as Grok Build, which Versorium doesn’t detect yet.",
    ], tableCap: "What each one brings together (Versorium and the closest)", tool: "Tool", why: "Why it exists" },
    better: { h: "It keeps improving", p: (r) => `v0.1.0, the first release, came out on 4 October 2026: ${r.commits} changes in three weeks, the first on 14 September. v0.1.1 followed hours later, with its first fixes. What comes next is written in plain sight:`, items: [
      "<b>On the list, already thought through:</b> seeing what changed between two versions, as a code editor shows it; going back to a version inside the app; choosing when backups run; notes anchored anywhere in the text; and writing the synopses.",
      "<b>Specified, not started:</b> a chat about the project, search by meaning, and dictation.",
    ], tail: `It is the list of pending work, not a promise with dates: <a href="${REPO}/blob/main/TODO.md">TODO.md</a> · <a href="${REPO}/releases">releases</a> · <a href="${REPO}/issues">tell us what you miss</a>.` },
    src: { h: "Sources", p: "All read on 4 October 2026, on each maker’s own website or repository.", ai: "The AI you may already pay for or use", date: "4 Oct 2026" },
    method: { h: "How this was made", p: [
      "Every price and feature comes from the maker’s own website or repository, read on 4 October 2026 in a browser: some shops only show their prices once the page has loaded. Prices are in US dollars, as each shop showed them, and change with country, tax and promotions. “Three years” is our arithmetic, at list prices.",
      'A dash means the website doesn’t say; a “No” about another app appears only where that app’s own website says so. The open-source tools were found through GitHub. If one is missing, or something has changed or is wrong, write to <a href="mailto:hola@maecly.com">hola@maecly.com</a> or open an <a href="https://github.com/MAECLY/versorium-app/issues">issue</a>, and it is corrected with its date. Names belong to their owners and are used here only to compare; there are no logos.',
    ] },
    nav: ['<a href="../#how">How it works</a>', "Compare"],
    footer: "Comparison",
    marks: "October 2026",
  },
};
export { PAGE };

// The pinned name column is exactly as wide as the scroller's snap padding
// (details.css, --vs-app): a long name may break there, a CamelCase one
// between its words rather than anywhere.
const nameHtml = (name) => esc(name).replace(/[\p{L}\p{N}]{12,}/gu, (w) => w.replace(/(\p{Ll})(?=\p{Lu})/gu, "$1<wbr>"));

function table(t, cols, keys, cls, labelId) {
  const head = `<thead><tr>${cols.map((h, i) => `<th scope="col"${i === 0 ? ' class="vs-app"' : ""}>${h}</th>`).join("")}</tr></thead>`;
  const groups = Object.keys(GROUPS)
    .map((g) => {
      const rows = APPS.filter((a) => a.group === g)
        .map((a) => {
          const us = a.id === "versorium";
          const id = cls === "vs-a" && !us ? ` id="${a.id}"` : "";
          const name = `<th scope="row" class="vs-app"><span class="vs-name">${nameHtml(a.name)}</span><small>${esc(a.type[t.lang])}</small>${us ? "" : `<a class="vs-src" href="#${t.sources}-${a.id}">${t.srcLink}</a>`}</th>`;
          return `<tr${id}${us ? ' class="is-us"' : ""}>${name}${keys.map((k) => `<td>${cellHtml(a[k], t.lang)}</td>`).join("")}</tr>`;
        })
        .join("\n");
      // Each group's row repeats the column names, for the eye only (the
      // header cells above name every column for screen readers): 29 rows on,
      // a column of short answers would otherwise lose its name.
      const label = g === "us" ? "" : `<tr class="vs-group"><th scope="rowgroup" class="vs-app">${GROUPS[g][t.lang]}</th>${cols.slice(1).map((h) => `<td><span aria-hidden="true">${h}</span></td>`).join("")}</tr>\n`;
      return `<tbody>\n${label}${rows}\n</tbody>`;
    })
    .join("\n");
  return `<div class="vs-scroll vs-full"><table class="vs ${cls}" aria-labelledby="${labelId}">${head}\n${groups}\n</table></div>`;
}

function founding(t) {
  const cols = Object.keys(FOUNDING.columns);
  const head = `<thead><tr><th scope="col" class="vs-app">${t.origin.tool}</th>${cols.map((k) => `<th scope="col">${FOUNDING.columns[k][t.lang]}</th>`).join("")}</tr></thead>`;
  const rows = FOUNDING.rows
    .map((r) => {
      const app = byId[r.id];
      // Each name links to its row above: the links also make the table, when
      // it scrolls sideways, reachable by the keyboard without the scroller
      // itself becoming a tab stop taller than the screen.
      const name = r.id === "versorium" ? nameHtml(app.name) : `<a href="#${r.id}">${nameHtml(app.name)}</a>`;
      return `<tr${r.id === "versorium" ? ' class="is-us"' : ""}><th scope="row" class="vs-app">${name}</th>${cols.map((k) => `<td>${cellHtml(r[k], t.lang)}</td>`).join("")}</tr>`;
    })
    .join("\n");
  return `<div class="vs-scroll vs-full"><table class="vs vs-f" aria-label="${t.origin.tableCap}">${head}\n<tbody>\n${rows}\n</tbody></table></div>`;
}

function sources(t) {
  const byApp = {};
  for (const [id, s] of Object.entries(SOURCES)) (byApp[s.app] ??= []).push([id, s]);
  const item = (rows) => rows.map(([, s]) => `<a href="${((t.lang === "en" && s.urlEn) || s.url).replace(/&/g, "&amp;")}">${esc(s[t.lang])}</a>`).join(" · ");
  const time = `<time datetime="${AS_OF}">${t.src.date}</time>`;
  const apps = APPS.filter((a) => byApp[a.id])
    .map((a) => `<div id="${t.sources}-${a.id}"><dt>${esc(a.name)}</dt><dd>${item(byApp[a.id])} · ${time}</dd></div>`)
    .join("\n");
  const ai = `<div id="${t.sources}-ai"><dt>${t.src.ai}</dt><dd>${item(byApp.ai)} · ${time}</dd></div>`;
  return `<dl class="dl-plain vs-sources">\n${apps}\n${ai}\n</dl>`;
}

function main(t, release) {
  const n = APPS.length - 1;
  const sec = (id, h, body) => `<section id="${id}" aria-labelledby="${id}-t">\n<h2 id="${id}-t">${h}</h2>\n${body}\n</section>`;
  const [precio, novela, delante, versorium, origen, mejora, fuentes, metodo] = t.toc.map(([id]) => id);
  const list = (items) => `<ul class="limit-list">\n${items.map((i) => `<li>${i}</li>`).join("\n")}\n</ul>`;
  return `<main id="${t.main}" tabindex="-1">
<div class="wrap page-head">
<h1>${t.h1}</h1>
<p class="lead">${t.lead(n)}</p>
<p class="vs-legend">${t.legend}</p>
</div>
<div class="wrap doc-grid">
<nav class="toc" aria-label="${t.tocTitle}"><p class="toc-title" aria-hidden="true">${t.tocTitle}</p><ol>
${t.toc.map(([id, l]) => `<li><a href="#${id}">${l}</a></li>`).join("\n")}
</ol></nav>
<div class="prose">
${sec(precio, t.a.h, `<p id="vs-a-t">${t.a.note}</p>\n${table(t, t.a.cols, TABLE_A, "vs-a", "vs-a-t")}\n<p>${money(t.a.after)}</p>`)}

${sec(novela, t.b.h, table(t, t.b.cols, TABLE_B, "vs-b", `${novela}-t`))}

${sec(delante, t.ahead.h, list(t.ahead.items))}

${sec(versorium, t.us.h, `${list(t.us.items)}\n<p class="note"><span class="note-label">${t.us.label}</span> ${t.us.close}</p>`)}

${sec(origen, t.origin.h, `${t.origin.p.map((p) => `<p>${p}</p>`).join("\n")}\n${founding(t)}\n<p><a href="${t.whyHref}">${t.origin.why} <span aria-hidden="true">→</span></a></p>`)}

${sec(mejora, t.better.h, `<p>${t.better.p(release)}</p>\n${list(t.better.items)}\n<p>${t.better.tail}</p>`)}

${sec(fuentes, t.src.h, `<p>${t.src.p}</p>\n${sources(t)}`)}

${sec(metodo, t.method.h, t.method.p.map((p) => `<p>${p}</p>`).join("\n"))}
</div>
</div>
</main>`;
}

/** The full page, on the shell of the details page in the same language. */
export function comparePage(detailsHtml, lang, release) {
  const t = PAGE[lang];
  const isEs = lang === "es";
  const base = "https://versorium.maecly.com/";
  const self = `${base}${isEs ? "comparar/" : "en/compare/"}`;
  const es = `${base}comparar/`;
  const en = `${base}en/compare/`;
  const desc = t.desc(APPS.length - 1);
  const swap = (html, re, to) => {
    if (!re.test(html)) throw new Error(`compare page ${lang}: ${re} not found in the details shell`);
    return html.replace(re, () => to);
  };
  let html = detailsHtml;
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${t.title}</title>`);
  html = swap(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${desc}">`);
  html = swap(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${self}">`);
  html = swap(html, /<link rel="alternate" hreflang="es" href="[^"]*">/, `<link rel="alternate" hreflang="es" href="${es}">`);
  html = swap(html, /<link rel="alternate" hreflang="en" href="[^"]*">/, `<link rel="alternate" hreflang="en" href="${en}">`);
  html = swap(html, /<link rel="alternate" hreflang="x-default" href="[^"]*">/, `<link rel="alternate" hreflang="x-default" href="${es}">`);
  html = swap(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t.h1}">`);
  html = swap(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`);
  html = swap(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${self}">`);
  html = swap(html, /"@type":"WebPage","@id":"[^"]*","url":"[^"]*","name":"[^"]*","inLanguage":"(es|en)"/, `"@type":"WebPage","@id":"${self}#webpage","url":"${self}","name":"${t.h1}","inLanguage":"${lang}"`);
  html = swap(html, /<a class="lang" href="[^"]*"/, `<a class="lang" href="${t.twin}"`);
  html = swap(html, /<main id="(contenido|content)" tabindex="-1">[\s\S]*<\/main>/, lang === "es" ? joinRayas(main(t, release)) : main(t, release));
  // The header: the limits link points into the details page; this page is the current one.
  html = isEs ? swap(html, /<a href="#limites">Límites<\/a>/, '<a href="../detalles/#limites">Límites</a>') : swap(html, /<a href="#limits">Limits<\/a>/, '<a href="../details/#limits">Limits</a>');
  html = swap(html, new RegExp(`<a href="\\.\\./${isEs ? "comparar" : "compare"}/">${t.nav[1]}</a>`), `<a href="./" aria-current="page">${t.nav[1]}</a>`);
  // The footer: the details page is a link again, and this page is the current one.
  html = swap(html, /<li><a href="\.\/" aria-current="page">([^<]*)<\/a><\/li>/, `<li><a href="../${isEs ? "detalles" : "details"}/">${isEs ? "Límites y detalles" : "Limits and details"}</a></li>`);
  html = swap(html, new RegExp(`<li><a href="\\.\\./${isEs ? "comparar" : "compare"}/">${t.footer}</a></li>`), `<li><a href="./" aria-current="page">${t.footer}</a></li>`);
  // Both language links (header and footer) go to this page's twin.
  html = isEs ? html.split('href="../en/details/" hreflang="en"').join('href="../en/compare/" hreflang="en"') : html.split('href="../../detalles/" hreflang="es"').join('href="../../comparar/" hreflang="es"');
  return html;
}

// ---------------------------------------------------------------- "Por qué existe" (details pages)

// In the third person: the owner's reasons as he gave them (TODO.md, "The why,
// in the owner's words", 2026-10-04). A first-person, signed version waits for
// his own words (site spec G5: a maker's note ships only if he writes it).
export const WHY = {
  es: {
    id: "por-que", h: "Por qué existe", toc: "Por qué existe", compare: "La comparación, con sus fuentes", href: "../comparar/",
    p: [
      "Miguel Esparza la empezó para sí: quería escribir con calma, con la IA a su medida —de ninguna a las herramientas que ya pagaba— y, sobre todo, no perder nunca un borrador, porque para quien escribe una novela la copia de seguridad del manuscrito es lo más importante.",
      "Las apps que probó o no tenían lo que pide una novela, o cobraban demasiado por ello. Por eso Versorium es gratis y de código abierto. Y la sigue mejorando.",
      "En septiembre de 2026 buscó una app así y no encontró ninguna que juntara las IA que ya tienes, los modelos locales, un MCP propio y el historial de cada cambio en un escritorio tranquilo. La empezó el 14 de septiembre; la primera versión salió el 4 de octubre.",
    ],
  },
  en: {
    id: "why", h: "Why it exists", toc: "Why it exists", compare: "The comparison, with its sources", href: "../compare/",
    p: [
      "Miguel Esparza started it for himself: he wanted to write calmly, with AI on his own terms, from none at all to the tools he already paid for, and above all never to lose a draft, because when you write a novel the backup of the manuscript matters more than anything.",
      "The apps he tried either lacked what a novel needs or charged too much for it. That is why Versorium is free and open source. And he keeps improving it.",
      "In September 2026 he looked for an app like this and found none that brought together the AIs you already have, local models, its own MCP and the history of every change, on a quiet desk. He started it on 14 September; the first release came out on 4 October.",
    ],
  },
};

export function whySection(lang) {
  const w = WHY[lang];
  const html = `<section id="${w.id}" aria-labelledby="${w.id}-t">
<h2 id="${w.id}-t">${w.h}</h2>
${w.p.map((p, i) => `<p${i === 0 ? ' class="why-first"' : ""}>${p}</p>`).join("\n")}
<p><a href="${w.href}">${w.compare} <span aria-hidden="true">→</span></a></p>
</section>
`;
  return lang === "es" ? joinRayas(html) : html;
}

const CREDITS = {
  es: ["Los demás nombres que aparecen aquí son de sus dueños y solo describen compatibilidad.", "Los demás nombres que aparecen aquí son de sus dueños y solo describen compatibilidad o sirven para comparar."],
  en: ["Other names on this site belong to their owners and only describe compatibility.", "Other names on this site belong to their owners and only describe compatibility or serve to compare."],
};

/** The why section (before the credits), its TOC entry, the nav and footer links, the credits sentence. */
export function applyDetails(html, lang) {
  const w = WHY[lang];
  const section = whySection(lang);
  const open = `<section id="${w.id}"`;
  if (html.includes(open)) {
    const at = html.indexOf(open);
    const end = html.indexOf("</section>", at) + "</section>\n".length;
    html = html.slice(0, at) + section + html.slice(end);
  } else {
    const credits = lang === "es" ? '<section id="creditos"' : '<section id="credits"';
    if (!html.includes(credits)) throw new Error(`no credits section in the ${lang} details page`);
    html = html.replace(credits, () => `${section}\n${credits}`);
  }
  const tocItem = `<li><a href="#${w.id}">${w.toc}</a></li>`;
  if (!html.includes(tocItem)) html = html.replace(lang === "es" ? '<li><a href="#creditos">' : '<li><a href="#credits">', (m) => `${tocItem}\n${m}`);
  const nav = lang === "es" ? ['<a href="../#como">Cómo funciona</a>', '<a href="../comparar/">Comparar</a>'] : ['<a href="../#how">How it works</a>', '<a href="../compare/">Compare</a>'];
  if (!html.includes(nav[1])) html = html.replace(nav[0], () => `${nav[0]}\n${nav[1]}`);
  const foot = lang === "es" ? '<li><a href="../comparar/">Comparación</a></li>' : '<li><a href="../compare/">Comparison</a></li>';
  if (!html.includes(foot)) html = html.replace(/(<li><a href="\.\/" aria-current="page">[^<]*<\/a><\/li>)/, (m) => `${m}\n${foot}`);
  const [from, to] = CREDITS[lang];
  if (html.includes(from)) html = html.replace(from, () => to);
  else if (!html.includes(to)) throw new Error(`the ${lang} credits sentence moved`);
  return html;
}

// ---------------------------------------------------------------- run

if (import.meta.url === `file://${process.argv[1]}`) {
  const release = firstRelease();
  for (const [lang, file] of [["es", "index.html"], ["en", "en/index.html"]]) {
    const p = path.join(DOCS, file);
    await writeFile(p, applyLanding(await readFile(p, "utf8"), lang, release));
  }
  for (const [lang, file, out] of [["es", "detalles/index.html", "comparar/index.html"], ["en", "en/details/index.html", "en/compare/index.html"]]) {
    const p = path.join(DOCS, file);
    const details = applyDetails(await readFile(p, "utf8"), lang);
    await writeFile(p, details);
    await mkdir(path.dirname(path.join(DOCS, out)), { recursive: true });
    await writeFile(path.join(DOCS, out), comparePage(details, lang, release));
  }
  console.log(`comparison written to ${DOCS} (first release ${release.tag}, ${release.commits} changes, ${release.first} → ${release.date})`);
}
