import en from "../../../locales/en/ui.json";
import es from "../../../locales/es/ui.json";
import { api, isTauri } from "$lib/tauri";

export type Locale = "en" | "es";

const dicts: Record<Locale, unknown> = { en, es };

/** Reactive current UI locale. Independent of the manuscript language. */
let locale = $state<Locale>("en");

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate a dot-key. Missing keys fall back to EN, then to the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = lookup(dicts[locale], key) ?? lookup(dicts.en, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function getLocale(): Locale {
  return locale;
}

export async function setLocale(l: Locale): Promise<void> {
  locale = l;
  document.documentElement.lang = l;
  if (isTauri()) {
    try {
      await api.setSettings({ uiLocale: l });
    } catch {
      // web preview: non-fatal
    }
  }
}

export function toggleLocale(): void {
  void setLocale(locale === "en" ? "es" : "en");
}

/** Load persisted locale at startup (Tauri settings; localStorage in web preview). */
export async function initLocale(): Promise<void> {
  let l: string | null = null;
  if (isTauri()) {
    try {
      l = (await api.getSettings()).uiLocale;
    } catch {
      l = null;
    }
  } else {
    l = localStorage.getItem("versorium.locale");
  }
  if (l === "en" || l === "es") locale = l;
  document.documentElement.lang = locale;
}

if (!isTauri()) {
  const stored = localStorage.getItem("versorium.locale");
  if (stored === "en" || stored === "es") locale = stored;
}
