<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import { api, isTauri, AUTHOR_ROLES, type AuthorProfile, type AuthorProfiles } from "$lib/tauri";
  import { store } from "$lib/binder/store.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import Select from "$lib/components/forms/Select.svelte";
  import TextField from "$lib/components/forms/TextField.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";

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

  /**
   * Said in passing, and gone: every field writes on leaving it, so a "Saved."
   * that stayed would sit there from the first field to the last. One id for
   * both outcomes, so a save that works replaces the error of one that did not.
   */
  async function save(): Promise<void> {
    if (!isTauri()) return;
    try {
      await api.setSettings({ authorProfiles: profiles, authorProfile: active });
      notices.inform(t("author.saved"), "settings.author");
    } catch (e) {
      notices.fail(store.codeMessagePublic(e), "settings.author");
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
        {#if field === "role"}
          <Select
            label={t("author.fields.role")}
            hint={t("author.where.role")}
            value={current.role}
            minWidth="280px"
            options={[
              { value: "", label: t("author.roles.none") },
              ...AUTHOR_ROLES.map((code) => ({ value: code, label: t(`author.roles.${code}`) })),
            ]}
            onChange={(next) => edit("role", next, true)}
          />
        {:else}
          <TextField
            label={t(`author.fields.${field}`)}
            hint={t(`author.where.${field}`)}
            value={current[field]}
            placeholder={field === "sortAs" ? sortGuess : undefined}
            onInput={(next) => edit(field, next, false)}
            onCommit={(next) => edit(field, next, true)}
          />
        {/if}
      {/each}

    </div>

    <div class="mt-3">
      <Checkbox
        label={t("author.useForExports", { profile: t(`author.profiles.${editing}`) })}
        checked={active === editing}
        disabled={active === editing}
        onChange={() => {
          active = editing;
          void save();
        }}
      />
    </div>

    <p class="v-muted m-0 mt-3" style="font-size: 11.5px; line-height: 1.6;">{t("author.privacy")}</p>
  {/if}
</section>
