import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// Settings' rail: pages under labelled categories, every page in the Tab
// order, arrows that only move focus, and a "you are here" that is not the
// accent fill (Settings redesign SPEC §2, §8). Runs against the mocked IPC.

const THEMES = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];

/** The rail, in order: each category's label and its pages, then the footer. */
const TREE: [string, string[]][] = [
  ["Writing", ["Editor", "Appearance"]],
  ["Your novel", ["Author", "History & backup"]],
  ["AI", ["Tasks", "Models", "Assistants"]],
  ["Other apps", ["Access to your novel", "Activity"]],
];
const FOOTER = ["Application"];
const PAGES = [...TREE.flatMap(([, pages]) => pages), ...FOOTER];

async function openSettings(page: Page, title = "Settings") {
  await page.goto("/?mock=tauri");
  if (title !== "Settings") await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: title }).click();
  const settings = page.getByRole("region", { name: title });
  await expect(settings).toBeVisible();
  return settings;
}

const navOf = (settings: Locator, name = "Settings sections") => settings.getByRole("navigation", { name });

/** The page-level heading, which takes focus when a page opens. */
const pageTitle = (page: Page) => page.locator("#settings-page-title");

test("the rail groups ten pages under four labels, with Application after the separator", async ({ page }) => {
  const nav = navOf(await openSettings(page));
  expect(PAGES).toHaveLength(10);
  await expect(nav.getByRole("heading", { level: 3 })).toHaveText(TREE.map(([label]) => label));
  for (const [label, pages] of TREE) {
    const list = nav.getByRole("list", { name: label });
    await expect(list.getByRole("button")).toHaveText(pages);
  }
  // Application stands apart, after the rule, in a list of its own.
  const lists = nav.getByRole("list");
  await expect(lists).toHaveCount(TREE.length + 1);
  await expect(lists.last().getByRole("button")).toHaveText(FOOTER);
  await expect(nav.locator("hr + ul")).toHaveCount(1);
  // Destinations, not tab panels.
  await expect(nav.getByRole("tab")).toHaveCount(0);
  await expect(nav.locator("[aria-selected]")).toHaveCount(0);
});

test("every page is reachable with Tab, and arrows only move focus", async ({ page }) => {
  const nav = navOf(await openSettings(page));
  const editor = nav.getByRole("button", { name: "Editor", exact: true });
  await editor.focus();

  // Down moves focus and nothing else: the page you are on does not change.
  await page.keyboard.press("ArrowDown");
  const appearance = nav.getByRole("button", { name: "Appearance", exact: true });
  await expect(appearance).toBeFocused();
  await expect(editor).toHaveAttribute("aria-current", "page");
  await expect(appearance).not.toHaveAttribute("aria-current", "page");
  await expect(pageTitle(page)).toHaveText("Editor");

  // Home and End reach the ends; neither wraps past them.
  await page.keyboard.press("End");
  await expect(nav.getByRole("button", { name: "Application", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(nav.getByRole("button", { name: "Application", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(editor).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(editor).toBeFocused();

  // Enter opens the page and puts focus on its title, which names it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(appearance).toHaveAttribute("aria-current", "page");
  await expect(pageTitle(page)).toBeFocused();
  await expect(pageTitle(page)).toHaveText("Appearance");

  // Tab walks every page, then the way back, without a roving tabindex.
  await editor.focus();
  const stops: string[] = [];
  for (let i = 0; i < PAGES.length; i += 1) {
    stops.push((await page.evaluate(() => document.activeElement?.textContent?.trim())) ?? "");
    await page.keyboard.press("Tab");
  }
  expect(stops).toEqual(PAGES);
  await expect(page.getByRole("button", { name: "← Back to the manuscript" })).toBeFocused();
});

test("the page you are on is marked with the selection colour and a bar, not the accent fill", async ({ page }) => {
  // The fill eases in; with reduced motion it is there at once to be read.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nav = navOf(await openSettings(page));
  await nav.getByRole("button", { name: "Author", exact: true }).click();
  await page.mouse.move(900, 600);
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveText("Author");
  const look = await current.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--sel)";
    document.body.append(probe);
    const sel = getComputedStyle(probe).backgroundColor;
    probe.style.background = "var(--accent)";
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, shadow: style.boxShadow, sel, accent };
  });
  expect(look.background).toBe(look.sel);
  expect(look.background).not.toBe(look.accent);
  expect(look.shadow).toContain("inset");
});

/**
 * WCAG contrast of an element's text against what is painted under it: the
 * computed backgrounds from the root down, composited (as m5-formats.spec.ts).
 */
function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const rgb = css.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [r, g, b, a];
      }
      const srgb = css.match(/^color\(srgb ([^)]+)\)$/);
      if (srgb) {
        const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [r * 255, g * 255, b * 255, a];
      }
      throw new Error(`a colour this does not read: ${css}`);
    };
    const over = ([r, g, b, a]: Rgba, under: number[]): number[] => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    let bg = [255, 255, 255];
    for (const node of chain) bg = over(parse(getComputedStyle(node).backgroundColor), bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  });
}

test("the rail's title, labels and pages hold AA contrast in every theme", async ({ page }) => {
  // No colour transitions to wait out between a change and its measurement.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nav = navOf(await openSettings(page));
  await page.mouse.move(900, 600);
  const texts = [
    nav.getByRole("heading", { level: 2 }),
    ...TREE.map(([label]) => nav.getByRole("heading", { level: 3, name: label })),
    nav.locator('[aria-current="page"]'),
    nav.getByRole("button", { name: "Author", exact: true }),
  ];
  for (const theme of THEMES) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const text of texts) {
      const ratio = await contrastOf(text);
      expect(ratio, `${await text.textContent()}, ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("the words on the new pages hold AA contrast in every theme", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoMock(page);
  await page.evaluate(() => {
    // Rewrite on a model that is gone, so a warning line is on the page too,
    // and Continuity free, so the one-click offer and its meta are.
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "ollama", id: "llama3:8b" };
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  const nav = navOf(settings);
  await page.mouse.move(1200, 700);

  const measure = async (texts: Locator[]) => {
    for (const theme of THEMES) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      for (const text of texts) {
        const ratio = await contrastOf(text);
        expect(ratio, `${(await text.textContent())?.trim()}, ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = "folio-light"));
  };

  await nav.getByRole("button", { name: "Tasks", exact: true }).click();
  await measure([
    settings.getByText("Small · 819 MB · fits this computer"),
    page.locator("#tasks-rewrite-status"),
    page.locator("#tasks-continuity-status"),
    settings.getByRole("button", { name: "Run it from Manuscript › Continuity" }),
    settings.getByText("Rewrites a passage you select. You see the change before it is applied."),
  ]);

  await nav.getByRole("button", { name: "Models", exact: true }).click();
  await measure([
    settings.getByText("Recommended", { exact: true }),
    settings.getByText("Too large for this computer: you can still download it"),
    settings.getByText("Running · 1 model"),
    settings.getByText("In Versorium · Small · 819 MB · Not used by a task"),
  ]);

  await nav.getByRole("button", { name: "Activity", exact: true }).click();
  await measure([
    settings.getByText("Refused: Codex can only read"),
    settings.getByText("read_document · manuscript/ch-01-the-long-winter.md"),
  ]);
});

test("the rail is translated", async ({ page }) => {
  const nav = navOf(await openSettings(page, "Ajustes"), "Secciones de ajustes");
  const words = await nav.locator(".v-rail-label, .v-rail-item").allTextContents();
  expect(words.map((w) => w.trim())).toEqual([
    "Escritura",
    "Editor",
    "Apariencia",
    "Tu novela",
    "Autor",
    "Historial y respaldo",
    "IA",
    "Tareas",
    "Modelos",
    "Asistentes",
    "Otras apps",
    "Acceso a tu novela",
    "Actividad",
    "Aplicación",
  ]);
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText("Ajustes");
  await expect(nav.getByRole("button", { name: "← Volver al manuscrito" })).toBeVisible();
});
