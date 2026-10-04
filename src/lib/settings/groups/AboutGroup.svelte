<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri } from "$lib/tauri";
  import { ABOUT, shortAddress } from "$lib/about";
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { useSettingsNav } from "$lib/settings/nav";

  /**
   * About: which Versorium this is, who makes it, the terms it is shared
   * under and where its updates come from. The version is the one the running
   * app reports (`app_info`), not the updater's record of it. Every address
   * opens in the browser; the updater itself stays on Application, where the
   * last link goes.
   */
  const nav = useSettingsNav();
  const { links } = ABOUT;

  /** Null until the app answers, and in the browser preview, which has no app. */
  let version = $state<string | null>(null);
  /** The address the browser would not open; its section says so. */
  let failed = $state<string | null>(null);

  onMount(() => {
    if (!isTauri()) return;
    api.appInfo().then(
      (info) => (version = info.version),
      () => (version = null),
    );
  });

  const opened = (): void => {
    failed = null;
  };
  const notOpened = (url: string): void => {
    failed = url;
  };
</script>

<!-- The address stays on screen, and selectable, so it can still be copied. -->
{#snippet failure(urls: readonly string[])}
  {#if failed && urls.includes(failed)}
    <p role="alert" class="m-0 mt-2" style="font-size: 12px; line-height: 1.6; color: var(--warn);">
      {t("links.openFailed")} <span class="v-mono-select">{failed}</span>
    </p>
  {/if}
{/snippet}

<section class="mb-6" aria-labelledby="about-versorium-title">
  <div class="v-card p-4">
    <h3 id="about-versorium-title" class="v-h3 m-0">{ABOUT.name}</h3>
    <p class="v-muted m-0 mt-1" style="font-size: 12.5px;">{t("app.tagline")}</p>
    <dl class="v-facts m-0 mt-3" style="font-size: 13px; line-height: 1.9;">
      <dt>{t("updates.currentVersion")}</dt>
      <dd><span class="v-mono-select" style="font-size: 12.5px;" data-about="version">{version ?? "—"}</span></dd>
      <dt>{t("settings.about.madeBy")}</dt>
      <dd>
        <ExternalLink href={links.author} where={shortAddress(links.author)} onopen={opened} onfail={notOpened}
          >{ABOUT.author}</ExternalLink
        >
      </dd>
      <dt>{t("settings.about.website")}</dt>
      <dd>
        <ExternalLink href={links.website} onopen={opened} onfail={notOpened}>{shortAddress(links.website)}</ExternalLink>
      </dd>
      <dt>{t("settings.about.source")}</dt>
      <dd>
        <ExternalLink href={links.repository} onopen={opened} onfail={notOpened}
          >{shortAddress(links.repository)}</ExternalLink
        >
      </dd>
    </dl>
    {@render failure([links.author, links.website, links.repository])}
  </div>
</section>

<section class="mb-6" aria-labelledby="about-license-title">
  <h3 id="about-license-title" class="v-h3 m-0 mb-2">{t("settings.about.licenseTitle")}</h3>
  <p class="m-0" style="font-size: 13px; line-height: 1.6;">{t("settings.about.license")}</p>
  <p class="m-0 mt-1" style="font-size: 12.5px;">
    <ExternalLink href={links.license} onopen={opened} onfail={notOpened}>{t("settings.about.readLicense")}</ExternalLink>
  </p>
  <p class="m-0 mt-3" style="font-size: 13px; line-height: 1.6;">{t("settings.about.cla")}</p>
  <p class="m-0 mt-1" style="font-size: 12.5px;">
    <ExternalLink href={links.cla} onopen={opened} onfail={notOpened}>{t("settings.about.readCla")}</ExternalLink>
  </p>
  {@render failure([links.license, links.cla])}
</section>

<!-- Outside the desktop app there is no updater, and Application says so. -->
{#if isTauri()}
  <section class="mb-6" aria-labelledby="about-updates-title">
    <h3 id="about-updates-title" class="v-h3 m-0 mb-2">{t("settings.about.updatesTitle")}</h3>
    <p class="m-0" style="font-size: 13px; line-height: 1.6;">{t("settings.about.updatesFrom")}</p>
    <p class="m-0 mt-1" style="font-size: 12.5px; line-height: 1.9;">
      <ExternalLink href={links.releases} onopen={opened} onfail={notOpened}
        >{t("settings.about.seeReleases")}</ExternalLink
      >
      <br />
      <button class="v-link" onclick={() => nav.navigate({ page: "app", focus: "updates" })}>
        {t("settings.about.checkUpdates")}
      </button>
    </p>
    {@render failure([links.releases])}
  </section>
{/if}
