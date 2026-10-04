<script lang="ts">
  import { t, setLocale, getLocale } from "$lib/i18n";
  import {
    THEME_NAMES,
    THEME_MODES,
    setTheme,
    setThemeMode,
    getTheme,
    getThemeMode,
    type ThemeName,
  } from "$lib/themes";

  /**
   * The swatch colours, read off the stylesheet's own tokens.
   *
   * Duplicated here on purpose rather than computed: a swatch has to show what a
   * theme looks like *without* applying it, and reading a CSS variable only ever
   * returns the theme currently in force. A test pins these against
   * `styles.css` so the two cannot drift.
   */
  const SWATCHES: Record<ThemeName, Record<"light" | "dark", { page: string; ink: string; accent: string }>> = {
    folio: {
      light: { page: "#f3ecdd", ink: "#2c261c", accent: "#3d5a45" },
      dark: { page: "#242017", ink: "#e8e0d0", accent: "#a3b89a" },
    },
    quarry: {
      light: { page: "#f7f6f2", ink: "#1a1a18", accent: "#2a6f6a" },
      dark: { page: "#1c1c1a", ink: "#edece8", accent: "#7eb8b2" },
    },
    needle: {
      light: { page: "#f4f7f6", ink: "#1b2422", accent: "#2a6f6a" },
      dark: { page: "#121c1a", ink: "#e4ebe8", accent: "#7eb8b2" },
    },
  };

  let current = $state(getTheme());
  let mode = $state(getThemeMode());

  /** Which side of each swatch to show: the one the writer will actually get. */
  let shown = $derived.by<"light" | "dark">(() => {
    if (mode === "light") return "light";
    if (mode === "dark") return "dark";
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  function choose(name: ThemeName): void {
    current = name;
    setTheme(name);
  }

  function chooseMode(next: (typeof THEME_MODES)[number]): void {
    mode = next;
    setThemeMode(next);
  }
</script>

<section class="mb-6" aria-label={t("settings.theme")}>
  <h3 class="v-h3 mb-1">{t("settings.theme")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px; line-height: 1.6;">{t("settings.themeHint")}</p>

  <!-- A swatch, not a dropdown: a theme is a look, and a list of three words
       made the picker feel like it did nothing. -->
  <ul
    class="m-0 mb-4 flex list-none flex-wrap gap-3 p-0"
    role="radiogroup"
    aria-label={t("settings.theme")}
  >
    {#each THEME_NAMES as name (name)}
      {@const swatch = SWATCHES[name][shown]}
      <li>
        <button
          role="radio"
          aria-checked={current === name}
          aria-label={t(`settings.themes.${name}`)}
          onclick={() => choose(name)}
          style="
            display: block; cursor: pointer; padding: 0; text-align: left;
            border-radius: var(--radius-card);
            border: 2px solid {current === name ? 'var(--accent)' : 'var(--border)'};
            background: transparent; width: 132px;
          "
        >
          <!-- A miniature page: background, two lines of text, an accent mark.
               Enough to recognise the theme before choosing it. -->
          <span
            aria-hidden="true"
            style="
              display: block; height: 68px; border-radius: calc(var(--radius-card) - 2px) calc(var(--radius-card) - 2px) 0 0;
              background: {swatch.page}; padding: 10px 10px 0; overflow: hidden;
            "
          >
            <span style="display: block; height: 4px; width: 62%; border-radius: 2px; background: {swatch.ink}; opacity: 0.85;"></span>
            <span style="display: block; margin-top: 5px; height: 3px; width: 84%; border-radius: 2px; background: {swatch.ink}; opacity: 0.45;"></span>
            <span style="display: block; margin-top: 4px; height: 3px; width: 72%; border-radius: 2px; background: {swatch.ink}; opacity: 0.45;"></span>
            <span style="display: block; margin-top: 9px; height: 8px; width: 30%; border-radius: 999px; background: {swatch.accent};"></span>
          </span>
          <span
            style="
              display: flex; align-items: center; justify-content: space-between;
              gap: 6px; padding: 6px 9px; font-size: 12.5px;
            "
          >
            <span style="font-weight: 600;">{t(`settings.themes.${name}`)}</span>
            {#if current === name}
              <span aria-hidden="true" style="color: var(--accent); font-weight: 700;">✓</span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <fieldset class="m-0 p-0" style="border: 0;">
    <legend class="v-h4 mb-2" style="padding: 0;">{t("settings.themeMode")}</legend>
    <div class="v-row" style="gap: 6px;">
      {#each THEME_MODES as option (option)}
        <button
          class="v-btn"
          aria-pressed={mode === option}
          style="padding: 4px 12px; font-size: 12.5px;"
          onclick={() => chooseMode(option)}
        >
          {option === "light"
            ? t("settings.modeLight")
            : option === "dark"
              ? t("settings.modeDark")
              : t("settings.modeFollow")}
        </button>
      {/each}
    </div>
  </fieldset>
</section>

<section class="mb-6" aria-label={t("settings.language")}>
  <h3 class="v-h3 mb-1">{t("settings.language")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("settings.languageHint")}</p>
  <label class="v-row" style="gap: 8px; font-size: 13px;">
    {t("settings.language")}
    <span class="v-select">
    <select
      value={getLocale()}
      onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value === "es" ? "es" : "en")}
    >
      <option value="en">{t("languages.en")}</option>
      <option value="es">{t("languages.es")}</option>
    </select>
    </span>
  </label>
</section>
