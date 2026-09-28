<script lang="ts">
  import { t, setLocale, getLocale } from "$lib/i18n";
  import {
    THEME_NAMES,
    THEME_MODES,
    setTheme,
    setThemeMode,
    getTheme,
    getThemeMode,
  } from "$lib/themes";

  /** Spec §5 names the three; the list is the source of truth, not this copy. */
  const THEME_HINT_KEY = "settings.themeHint";
</script>

<section class="mb-6" aria-label={t("settings.appearance")}>
  <h3 class="v-section-title mb-1">{t("settings.theme")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t(THEME_HINT_KEY)}</p>

  <div class="v-row mb-3" style="gap: 12px; flex-wrap: wrap;">
    <label class="v-row" style="gap: 8px; font-size: 13px;">
      {t("settings.theme")}
      <select
        value={getTheme()}
        onchange={(e) => setTheme((e.currentTarget as HTMLSelectElement).value as never)}
      >
        {#each THEME_NAMES as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>

    <label class="v-row" style="gap: 8px; font-size: 13px;">
      {t("settings.themeMode")}
      <select
        value={getThemeMode()}
        onchange={(e) => setThemeMode((e.currentTarget as HTMLSelectElement).value as never)}
      >
        {#each THEME_MODES as mode (mode)}
          <option value={mode}>
            {mode === "light"
              ? t("settings.modeLight")
              : mode === "dark"
                ? t("settings.modeDark")
                : t("settings.modeFollow")}
          </option>
        {/each}
      </select>
    </label>
  </div>
</section>

<section class="mb-6" aria-label={t("settings.language")}>
  <h3 class="v-section-title mb-1">{t("settings.language")}</h3>
  <p class="v-muted m-0 mb-2" style="font-size: 12px;">{t("settings.languageHint")}</p>
  <label class="v-row" style="gap: 8px; font-size: 13px;">
    {t("settings.language")}
    <select
      value={getLocale()}
      onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value === "es" ? "es" : "en")}
    >
      <option value="en">{t("languages.en")}</option>
      <option value="es">{t("languages.es")}</option>
    </select>
  </label>
</section>
