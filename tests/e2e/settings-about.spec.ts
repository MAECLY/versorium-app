import { expect, test, type Locator, type Page } from "@playwright/test";

// Settings › About against the mocked IPC: the page in both languages, the
// version the app itself reports (`app_info`, "0.1.0-mock" in the mock, which
// the updater's own record, "0.1.0", is not), links that open the system
// browser through the opener and never the webview, and the way to the
// updater on Application.
//
// The mock's opener answers as the real plugin would under the app's
// capabilities (tests/e2e/opener-acl.ts): an address the capability's scope
// does not allow is refused and never reaches `__VERSORIUM_MOCK__.browser`.
// So these tests fail when the capability would make the real app refuse a
// link, which a check on the IPC call alone did not.

declare global {
  interface Window {
    __menus: { prevented: boolean }[];
  }
}

const REPO = "https://github.com/MAECLY/versorium-app";

/** In page order. Written out, so a changed address or name fails here. */
const LINKS = [
  {
    href: "https://www.maecly.com/about",
    en: "Miguel Angel Esparza Calero (opens www.maecly.com/about in your browser)",
    es: "Miguel Angel Esparza Calero (abre www.maecly.com/about en tu navegador)",
  },
  { href: "https://www.maecly.com", en: "www.maecly.com (opens in your browser)", es: "www.maecly.com (se abre en tu navegador)" },
  {
    href: REPO,
    en: "github.com/MAECLY/versorium-app (opens in your browser)",
    es: "github.com/MAECLY/versorium-app (se abre en tu navegador)",
  },
  {
    href: `${REPO}/blob/main/LICENSE`,
    en: "Read the license on GitHub (opens in your browser)",
    es: "Lee la licencia en GitHub (se abre en tu navegador)",
  },
  {
    href: `${REPO}/blob/main/CLA.md`,
    en: "Read the CLA on GitHub (opens in your browser)",
    es: "Lee el CLA en GitHub (se abre en tu navegador)",
  },
  {
    href: `${REPO}/blob/main/THIRD-PARTY-NOTICES.md`,
    en: "Read the third-party notices on GitHub (opens in your browser)",
    es: "Lee los avisos de terceros en GitHub (se abre en tu navegador)",
  },
  {
    href: `${REPO}/releases`,
    en: "See the releases on GitHub (opens in your browser)",
    es: "Mira las versiones en GitHub (se abre en tu navegador)",
  },
];

const WORDS = {
  en: {
    settings: "Settings",
    about: "About",
    app: "Application",
    purpose: "The version you have, who makes Versorium, the terms it is shared under, and where its updates come from.",
    version: "Installed version",
    sections: ["Versorium", "License", "Where updates come from"],
    check: "Check for updates in Application ›",
    failed: "Your browser could not be opened. The address is:",
  },
  es: {
    settings: "Ajustes",
    about: "Acerca de",
    app: "Aplicación",
    purpose: "La versión que tienes, quién hace Versorium, en qué términos se comparte y de dónde vienen sus actualizaciones.",
    version: "Versión instalada",
    sections: ["Versorium", "Licencia", "De dónde vienen las actualizaciones"],
    check: "Busca actualizaciones en Aplicación ›",
    failed: "No se pudo abrir el navegador. La dirección es:",
  },
} as const;

async function openAbout(page: Page, lang: "en" | "es" = "en") {
  await page.goto("/?mock=tauri");
  const words = WORDS[lang];
  if (lang === "es") await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: words.settings }).click();
  const settings = page.getByRole("region", { name: words.settings });
  await settings.getByRole("button", { name: words.about, exact: true }).click();
  await expect(page.locator("#settings-page-title")).toHaveText(words.about);
  return settings;
}

/** Every URL the system browser was given, oldest first: what the opener accepted, not only what it was asked. */
function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__VERSORIUM_MOCK__.browser]);
}

/** Every URL the opener was asked to open, accepted or not. */
function asked(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls
      .filter((call) => call.cmd === "plugin:opener|open_url")
      .map((call) => String((call.args as { url?: unknown }).url)),
  );
}

/** The page's own content, under its title: the rail's category headings are not part of it. */
const content = (page: Page) => page.locator("#settings-page-title").locator("xpath=../..");

/** The section each link sits in, by its heading, in page order (LINKS). */
const SECTION_OF = [0, 0, 0, 1, 1, 1, 2];

const link = (settings: Locator, href: string) => settings.locator(`a[href="${href}"]`);

for (const lang of ["en", "es"] as const) {
  test(`About is the last page of the rail, and says what it is for (${lang})`, async ({ page }) => {
    const words = WORDS[lang];
    const settings = await openAbout(page, lang);
    const nav = settings.getByRole("navigation");
    await expect(nav.getByRole("list").last().getByRole("button")).toHaveText([words.app, words.about]);
    await expect(nav.getByRole("button", { name: words.about, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#settings-page-title")).toHaveText(words.about);
    await expect(settings.getByText(words.purpose)).toBeVisible();
    for (const name of words.sections) await expect(settings.getByRole("region", { name, exact: true })).toBeVisible();
    // A heading per section, under the page's own: a screen reader's list of
    // headings is the page's outline.
    await expect(content(page).getByRole("heading", { level: 2 })).toHaveText([words.about]);
    await expect(content(page).getByRole("heading", { level: 3 })).toHaveText([...words.sections]);
  });

  test(`About shows the version the app reports, and names every link by where it goes (${lang})`, async ({ page }) => {
    const words = WORDS[lang];
    const settings = await openAbout(page, lang);
    const card = settings.getByRole("region", { name: "Versorium", exact: true });
    await expect(card.getByText(words.version)).toBeVisible();
    await expect(card.locator('[data-about="version"]')).toHaveText("0.1.0-mock");
    await expect(settings.getByRole("link")).toHaveCount(LINKS.length);
    const all = await settings.getByRole("link").all();
    for (const [i, expected] of LINKS.entries()) {
      await expect(all[i]).toHaveAttribute("href", expected.href);
      await expect(all[i]).toHaveAccessibleName(expected[lang]);
    }
  });
}

test("every link opens the browser through the opener, and the window stays on Versorium", async ({ page, context }) => {
  const settings = await openAbout(page);
  const at = page.url();
  for (const { href } of LINKS) {
    const before = (await opened(page)).length;
    await link(settings, href).click();
    await expect.poll(async () => (await opened(page)).slice(before)).toEqual([href]);
    expect(page.url()).toBe(at);
  }
  // Each was asked once, and none was refused: no failure line anywhere.
  expect(await asked(page)).toEqual(LINKS.map((l) => l.href));
  await expect(settings.getByRole("alert")).toHaveCount(0);
  // The ways a browser opens a link in a tab of its own: the middle button,
  // and Ctrl or ⌘ with a click. Each still goes to the system browser.
  const before = (await opened(page)).length;
  await link(settings, LINKS[3].href).click({ button: "middle" });
  await link(settings, LINKS[4].href).click({ modifiers: ["ControlOrMeta"] });
  await link(settings, LINKS[5].href).click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await opened(page)).slice(before)).toEqual([LINKS[3].href, LINKS[4].href, LINKS[5].href]);
  expect(page.url()).toBe(at);
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator("#settings-page-title")).toHaveText("About");
});

test("the keyboard reaches every link in order, sees where it is, and opens with Enter", async ({ page }) => {
  const settings = await openAbout(page);
  const nav = settings.getByRole("navigation");
  // From the rail: Enter opens About and puts focus on its title.
  await nav.getByRole("button", { name: "About", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#settings-page-title")).toBeFocused();

  const stops: string[] = [];
  for (let i = 0; i < LINKS.length + 1; i += 1) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el.getAttribute("href") ?? el.textContent?.trim() ?? "";
      }),
    );
    if (i === 0) {
      // A focused link is ringed like every other control: 2px, the accent.
      const ring = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement!);
        return { style: style.outlineStyle, width: style.outlineWidth };
      });
      expect(ring).toEqual({ style: "solid", width: "2px" });
    }
  }
  expect(stops).toEqual([...LINKS.map((l) => l.href), "Check for updates in Application ›"]);

  // Enter on a link opens it, as a click does.
  await link(settings, LINKS[0].href).focus();
  const before = (await opened(page)).length;
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await opened(page)).slice(before)).toEqual([LINKS[0].href]);

  // The way to the updater lands on Application's Check now, ready to press.
  await settings.getByRole("button", { name: "Check for updates in Application ›" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Application", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settings.getByRole("region", { name: "Updates", exact: true }).getByRole("button", { name: "Check now" })).toBeFocused();
});

for (const lang of ["en", "es"] as const) {
  test(`a browser that does not open is said in the link's own section, with the address to copy (${lang})`, async ({
    page,
  }) => {
    const words = WORDS[lang];
    const settings = await openAbout(page, lang);
    for (const [i, { href }] of LINKS.entries()) {
      await page.evaluate(() => (window.__VERSORIUM_MOCK__.failures["plugin:opener|open_url"] = "denied"));
      await link(settings, href).click();
      const section = settings.getByRole("region", { name: words.sections[SECTION_OF[i]], exact: true });
      await expect(section.getByRole("alert"), href).toHaveText(`${words.failed} ${href}`);
      // Only there: one line on the page, beside the link that failed.
      await expect(settings.getByRole("alert")).toHaveCount(1);
      await expect(page.locator("#settings-page-title")).toHaveText(words.about);

      // Once the browser opens again, the line goes.
      await page.evaluate(() => delete window.__VERSORIUM_MOCK__.failures["plugin:opener|open_url"]);
      await link(settings, LINKS[(i + 1) % LINKS.length].href).click();
      await expect(settings.getByRole("alert")).toHaveCount(0);
    }
    expect(await opened(page)).toEqual(LINKS.map((_, i) => LINKS[(i + 1) % LINKS.length].href));
  });
}

test("an address the app's capability does not allow is refused like the real opener refuses it", async ({ page }) => {
  // The mock's opener applies src-tauri/capabilities: it refuses what the
  // plugin's scope refuses, in the plugin's words, and the browser gets nothing.
  await openAbout(page);
  const answers = await page.evaluate(async () => {
    const ask = (url: string, program?: string) =>
      window.__TAURI_INTERNALS__.invoke("plugin:opener|open_url", { url, with: program }).then(
        () => "opened",
        (e: unknown) => String(e),
      );
    return {
      https: await ask("https://www.maecly.com/about"),
      http: await ask("http://www.maecly.com"),
      file: await ask("file:///etc/passwd"),
      mail: await ask("mailto:someone@example.com"),
      program: await ask("https://www.maecly.com/about", "Safari"),
    };
  });
  expect(answers).toEqual({
    https: "opened",
    http: "Not allowed to open url http://www.maecly.com",
    file: "Not allowed to open url file:///etc/passwd",
    mail: "Not allowed to open url mailto:someone@example.com",
    program: "Not allowed to open url https://www.maecly.com/about with Safari",
  });
  expect(await opened(page)).toEqual(["https://www.maecly.com/about"]);
});

test("a right-click on a selected link never gets the engine's menu, which would open it in this window", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__menus = [];
    window.addEventListener("contextmenu", (event) => window.__menus.push({ prevented: event.defaultPrevented }));
  });
  const settings = await openAbout(page);
  const license = settings.getByRole("region", { name: "License", exact: true });
  // Select the section's words, the link among them, as a writer dragging over it would.
  await license.evaluate((section) => {
    const range = document.createRange();
    range.selectNodeContents(section);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await link(settings, LINKS[3].href).click({ button: "right" });
  await expect.poll(() => page.evaluate(() => window.__menus.length)).toBe(1);
  expect(await page.evaluate(() => window.__menus[0].prevented)).toBe(true);
  // The words around it are still text, with the engine's own menu.
  await license.getByText("Contributions are accepted under the Contributor License Agreement (CLA).").click({
    button: "right",
  });
  await expect.poll(() => page.evaluate(() => window.__menus.length)).toBe(2);
  expect(await page.evaluate(() => window.__menus[1].prevented)).toBe(false);
  // Nor did the right button open the link: the next one clicked is the first
  // address the opener hears. (No Escape to dismiss the engine's menu: a real
  // one takes that key itself, and here the page would read it as closing
  // Settings.)
  await link(settings, LINKS[4].href).click();
  await expect.poll(() => opened(page)).toEqual([LINKS[4].href]);
});
