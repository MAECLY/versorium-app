import { t } from "$lib/i18n";

/**
 * The languages a novel can be written in here.
 *
 * Mirrors `LANGUAGES` in src-tauri/src/commands/project.rs, which refuses any
 * other code, and both are held to the names under `languages` in the locale
 * files (tests/unit/novel-languages.test.ts, and a Rust test beside the list):
 * a code nobody can name would reach the picker as a bare tag.
 */
export const NOVEL_LANGUAGES = ["en", "es"] as const;

export type NovelLanguage = (typeof NOVEL_LANGUAGES)[number];

export function isNovelLanguage(code: string): code is NovelLanguage {
  return (NOVEL_LANGUAGES as readonly string[]).includes(code);
}

/**
 * The language a tag names when a novel can be written in it, or null.
 *
 * Mirrors `language_code` in src-tauri/src/commands/project.rs: only the
 * primary subtag decides, so `es-MX` and `ES` are `es`, and something not
 * shaped like a tag (`español`, `en-`) names nothing.
 */
export function novelLanguageOf(tag: string): NovelLanguage | null {
  const clean = tag.trim().toLowerCase().replaceAll("_", "-");
  if (!/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(clean)) return null;
  const primary = clean.split("-")[0];
  return isNovelLanguage(primary) ? primary : null;
}

/**
 * The options of a language picker that currently shows `current`.
 *
 * A project whose `versorium.json` holds a code outside the list (edited by
 * hand, or written before the list was enforced) gets that code as one more
 * option, so the control shows what the project holds rather than silently
 * showing the first language, which would read as already chosen. A region or
 * a capital (`es-MX`, `ES`) is still a language on the list, and every export
 * reads it as one, so it is labelled by that language's name, not as one
 * Versorium does not offer.
 */
export function languageOptions(current: string): { value: string; label: string }[] {
  const options = NOVEL_LANGUAGES.map((code) => ({ value: code, label: t(`languages.${code}`) }));
  if (!current || isNovelLanguage(current)) return options;
  const named = novelLanguageOf(current);
  const label = named
    ? t("project.languageRegion", { language: t(`languages.${named}`), code: current })
    : t("project.languageOther", { code: current });
  return [...options, { value: current, label }];
}
