import { api, isTauri, type AppSettings } from "$lib/tauri";

export type ThemeName = "folio" | "quarry" | "needle";
export type ThemeMode = "light" | "dark" | "follow";

export const THEME_NAMES: ThemeName[] = ["folio", "quarry", "needle"];
export const THEME_MODES: ThemeMode[] = ["light", "dark", "follow"];

let theme = $state<ThemeName>("folio");
let mode = $state<ThemeMode>("follow");

let media: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function isSystemDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(): void {
  const resolvedMode = mode === "follow" ? (isSystemDark() ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = `${theme}-${resolvedMode}`;
}

function syncMedia(): void {
  if (typeof matchMedia === "undefined") return;
  media?.removeEventListener?.("change", mediaListener as EventListener);
  media = matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    if (mode === "follow") apply();
  };
  media.addEventListener?.("change", mediaListener as EventListener);
}

export function setTheme(name: ThemeName): void {
  theme = name;
  apply();
  if (isTauri()) void api.setSettings({ theme: name });
}

export function setThemeMode(m: ThemeMode): void {
  mode = m;
  syncMedia();
  apply();
  if (isTauri()) void api.setSettings({ themeMode: m });
}

/**
 * Apply the persisted theme at startup.
 *
 * A fresh install is Folio following the system, which is spec §5's default
 * pair. What the writer picks afterwards is what they get: the theme is never
 * substituted for another one behind their back.
 */
export async function initTheme(): Promise<void> {
  if (isTauri()) {
    try {
      const s: AppSettings = await api.getSettings();
      if (THEME_NAMES.includes(s.theme as ThemeName)) theme = s.theme as ThemeName;
      if (THEME_MODES.includes(s.themeMode as ThemeMode)) mode = s.themeMode as ThemeMode;
    } catch {
      // keep defaults
    }
  } else {
    const t = localStorage.getItem("versorium.theme");
    const m = localStorage.getItem("versorium.themeMode");
    if (t && THEME_NAMES.includes(t as ThemeName)) theme = t as ThemeName;
    if (m && THEME_MODES.includes(m as ThemeMode)) mode = m as ThemeMode;
  }
  syncMedia();
  apply();
}

export function getTheme(): ThemeName {
  return theme;
}

export function getThemeMode(): ThemeMode {
  return mode;
}
