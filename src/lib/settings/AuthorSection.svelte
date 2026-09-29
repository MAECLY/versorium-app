<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, AUTHOR_ROLES, type AuthorProfile, type AuthorProfiles } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";

  /**
   * Who the manuscript is by, as the exported file will say it.
   *
   * Two profiles because the same person writes under a contract and under a
   * pen name, and those differ by more than a name: a publisher, a copyright
   * line, sometimes a role. Two rather than a list because a third has no name
   * anybody agreed on, and a list turns a setting into a thing to manage.
   *
   * Every field states where it lands. A metadata field whose destination is
   * unstated is one somebody finds out about from a publisher.
   */
  type Which = "work" | "hobby";
  const WHICH: Which[] = ["work", "hobby"];
  const FIELDS = ["name", "sortAs", "role", "organization", "rights"] as const;

  const EMPTY: AuthorProfile = { name: "", sortAs: "", role: "", organization: "", rights: "" };

  let profiles = $state<AuthorProfiles>({ work: { ...EMPTY }, hobby: { ...EMPTY } });
  let active = $state<Which>("work");
  let editing = $state<Which>("work");
  let saved = $state(false);

  let current = $derived(profiles[editing]);

  onMount(() => {
    if (!isTauri()) return;
    api
      .getSettings()
      .then((s) => {
        profiles = s.authorProfiles ?? profiles;
        active = s.authorProfile === "hobby" ? "hobby" : "work";
        editing = active;
      })
      .catch(() => {});
  });

  async function save(): Promise<void> {
    if (!isTauri()) return;
    saved = false;
    try {
      await api.setSettings({ authorProfiles: profiles, authorProfile: active });
      saved = true;
    } catch (e) {
      store.error = store.codeMessagePublic(e);
    }
  }

  /**
   * Typing updates the profile; leaving the field writes it.
   *
   * Both halves matter. The sort-name placeholder is derived from the name, so
   * waiting for blur would leave it stale while somebody is looking straight at
   * it — and saving on every keystroke would write the settings file once per
   * letter.
   */
  function edit(field: (typeof FIELDS)[number], value: string, persist: boolean): void {
    profiles = { ...profiles, [editing]: { ...profiles[editing], [field]: value } };
    if (persist) void save();
  }

  /** What "leave it blank" will produce, so nobody has to guess. */
  let sortGuess = $derived.by(() => {
    const words = current.name.trim().split(/\s+/).filter(Boolean);
    const last = words.pop();
    return last && words.length > 0 ? `${last}, ${words.join(" ")}` : (last ?? "");
  });
</script>

<section class="mb-6" aria-label={t("author.title")}>
  <h3 class="v-section-title mb-1">{t("author.title")}</h3>
  <p class="v-muted m-0 mb-3" style="font-size: 12px; line-height: 1.6;">{t("author.intro")}</p>

  {#if !isTauri()}
    <p class="v-muted m-0" style="font-size: 13px;">{t("author.none")}</p>
  {:else}
    <div class="v-row mb-1" style="gap: 6px;" role="group" aria-label={t("author.which")}>
      {#each WHICH as which (which)}
        <button
          class="v-btn"
          style="padding: 2px 12px; font-size: 12.5px;"
          aria-pressed={editing === which}
          onclick={() => (editing = which)}
        >
          {t(`author.profiles.${which}`)}
          {#if active === which}
            <span class="v-muted" style="font-size: 11px;"> · {t("author.inUseShort")}</span>
          {/if}
        </button>
      {/each}
    </div>
    <p class="v-muted m-0 mb-3" style="font-size: 12px;">{t(`author.profiles.${editing}Hint`)}</p>

    <div class="flex flex-col gap-3">
      {#each FIELDS as field (field)}
        <!-- The destination is a description, not part of the name: inside the
             label it becomes the field's accessible name, and a screen reader
             announces a paragraph where a writer expects "Name". -->
        <div class="flex flex-col gap-1">
          <label class="flex flex-col gap-1" style="font-size: 13px;" for="author-{field}">
            {t(`author.fields.${field}`)}
          </label>
          {#if field === "role"}
            <span class="v-select" style="max-width: 280px;">
            <select
              id="author-{field}"
              aria-describedby="author-where-{field}"
              value={current.role}
              onchange={(e) => edit("role", (e.currentTarget as HTMLSelectElement).value, true)}
            >
              <option value="">{t("author.roles.none")}</option>
              {#each AUTHOR_ROLES as code (code)}
                <option value={code}>{t(`author.roles.${code}`)}</option>
              {/each}
            </select>
            </span>
          {:else}
            <input
              id="author-{field}"
              aria-describedby="author-where-{field}"
              type="text"
              value={current[field]}
              placeholder={field === "sortAs" ? sortGuess : ""}
              oninput={(e) => edit(field, (e.currentTarget as HTMLInputElement).value, false)}
              onchange={(e) => edit(field, (e.currentTarget as HTMLInputElement).value, true)}
              onblur={(e) => edit(field, (e.currentTarget as HTMLInputElement).value, true)}
            />
          {/if}
          <span id="author-where-{field}" class="v-muted" style="font-size: 11.5px; line-height: 1.5;">
            {t(`author.where.${field}`)}
          </span>
        </div>
      {/each}
    </div>

    <label class="v-row mt-3" style="gap: 8px; font-size: 13px;">
      <input
        type="checkbox"
        checked={active === editing}
        disabled={active === editing}
        onchange={() => {
          active = editing;
          void save();
        }}
      />
      {t("author.useForExports", { profile: t(`author.profiles.${editing}`) })}
    </label>

    <p class="v-muted m-0 mt-3" style="font-size: 11.5px; line-height: 1.6;">{t("author.privacy")}</p>
    {#if saved}
      <p class="m-0 mt-2" style="font-size: 12px; color: var(--accent);" aria-live="polite">
        {t("author.saved")}
      </p>
    {/if}
  {/if}
</section>
