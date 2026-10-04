import { expect, it } from "vitest";
import en from "../../locales/en/ui.json";
import es from "../../locales/es/ui.json";
import { CATEGORIES, FOOTER, PAGES, focusKey } from "$lib/settings/pages";

// The rail is data (src/lib/settings/pages.ts). These hold it to its rules:
// every page once, in a category or the footer, and named in both languages.

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
}

it("every page appears exactly once, Application then About in the footer", () => {
  expect(new Set(PAGES).size).toBe(PAGES.length);
  expect(PAGES).toEqual([...CATEGORIES.flatMap((c) => c.pages), ...FOOTER]);
  expect(FOOTER).toEqual(["app", "about"]);
  for (const category of CATEGORIES) expect(category.pages.length).toBeGreaterThan(0);
});

it("a link can land on Application's Check now; About has nothing to land on but its title", () => {
  expect(focusKey({ page: "app", focus: "updates" })).toBe("app:updates");
  expect(focusKey({ page: "app" })).toBeNull();
  expect(focusKey({ page: "about" })).toBeNull();
  expect(focusKey({ page: "tasks", focus: "rewrite" })).toBe("tasks:rewrite");
});

it("every category, page and purpose line is written in English and Spanish", () => {
  const keys = [
    ...CATEGORIES.map((c) => `settings.categories.${c.id}`),
    ...PAGES.flatMap((page) => [`settings.groups.${page}`, `settings.purpose.${page}`]),
  ];
  for (const key of keys) {
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      const value = lookup(dict, key);
      expect(typeof value === "string" && value.trim() !== "", `${lang} ${key}`).toBe(true);
    }
  }
});
