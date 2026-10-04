<script lang="ts">
  import { untrack } from "svelte";
  import { t } from "$lib/i18n";
  import { keepFocusOnPress, restoreFocus } from "$lib/components/restoreFocus";
  import { notices, type Hold, type Shown } from "./state.svelte";

  /**
   * The notices, mounted once in App between the page and whatever sits under
   * it (History, the status bar). The stack hangs from that line, so it covers
   * neither, and the editor keeps the caret's line clear of it
   * (src/lib/notices/editor.ts).
   *
   * Nothing here takes focus on its own: a notice that grabbed it would pull
   * the caret out of the sentence being written. Keyboard focus reaches a
   * notice by Tab, right after the page, and goes back where it came from when
   * the notice closes.
   */

  const uid = $props.id();

  let list: HTMLUListElement | undefined = $state();
  /** Where keyboard focus came into the stack from. */
  let cameFrom: Element | null = null;
  /** The notice that held focus just before the stack changed, or -1. */
  let focusedAt = -1;

  $effect(() => {
    const el = list;
    if (!el) return;
    notices.attach(el);
    const moved = () => notices.moved();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(moved);
    observer?.observe(el);
    window.addEventListener("resize", moved);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", moved);
      notices.detach(el);
    };
  });

  function indexOfFocus(): number {
    const active = document.activeElement;
    if (!list || !active) return -1;
    return [...list.children].findIndex((item) => item.contains(active));
  }

  function landFocus(): void {
    const at = focusedAt;
    focusedAt = -1;
    if (at < 0) return;
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    const closers = list ? [...list.querySelectorAll<HTMLElement>(".v-note-close")] : [];
    if (restoreFocus(closers[Math.min(at, closers.length - 1)])) return;
    if (restoreFocus(cameFrom)) return;
    restoreFocus(document.querySelector("main .cm-content"));
  }

  // A notice can go while focus is on it: closed from the keyboard, or
  // cleared by the code that raised it. Focus would fall to <body>, so it
  // moves to the notice that took its place, or back where it came from.
  // Both run on the stack changing only, not on the list element coming and
  // going, which would overwrite what the first one saw.
  $effect.pre(() => {
    void notices.shown;
    focusedAt = untrack(indexOfFocus);
  });

  $effect(() => {
    void notices.shown;
    untrack(landFocus);
  });

  function noteOrigin(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof Element && !(event.currentTarget as Element).contains(from)) cameFrom = from;
  }

  function hold(notice: Shown, why: Hold): void {
    for (const id of notice.ids) notices.hold(id, why);
  }

  function release(notice: Shown, why: Hold): void {
    for (const id of notice.ids) notices.release(id, why);
  }

  function close(notice: Shown): void {
    for (const id of notice.ids) notices.close(id);
  }

  function leaveFocus(event: FocusEvent, notice: Shown): void {
    const to = event.relatedTarget;
    if (to instanceof Node && (event.currentTarget as Element).contains(to)) return;
    release(notice, "focus");
  }

  /**
   * Escape closes the notice focus is on, and nothing else: taken here, it
   * never reaches App, which would otherwise end Focus or close a peek.
   */
  function onKeydown(event: KeyboardEvent, notice: Shown): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(notice);
  }
</script>

<div class="v-notes-anchor">
  <!-- Always in the DOM, so the first notice is heard: a live region that
       appears with its words is often not announced at all. The notices
       themselves carry no live role, so an error that changes its words in
       place is not read out again. -->
  <div class="sr-only" role="status" data-notices="polite">{notices.polite}</div>
  <div class="sr-only" role="alert" data-notices="assertive">{notices.assertive}</div>

  {#if notices.shown.length > 0}
    <section class="v-notes" aria-label={t("notices.region")} onfocusin={noteOrigin}>
      <ul class="v-notes-list" bind:this={list}>
        {#each notices.shown as notice, index (notice.key)}
          <!-- The item hears the keys and the pointer of the buttons inside
               it: Escape on either closes it, and the pointer anywhere on it
               keeps it while it is read. -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="v-note"
            data-tier={notice.tier}
            onpointerenter={() => hold(notice, "pointer")}
            onpointerleave={() => release(notice, "pointer")}
            onfocusin={() => hold(notice, "focus")}
            onfocusout={(event) => leaveFocus(event, notice)}
            onkeydown={(event) => onKeydown(event, notice)}
          >
            <p class="v-note-text" id="{uid}-{index}">{notice.text}</p>
            {#if notice.action}
              {@const action = notice.action}
              <button
                type="button"
                class="v-btn v-btn-small v-note-action"
                onmousedown={keepFocusOnPress}
                onclick={() => action.run()}
              >
                {action.label}
              </button>
            {/if}
            <!-- A press keeps the caret in the text: closing a notice is not a
                 reason to stop writing. -->
            <button
              type="button"
              class="v-note-close"
              aria-label={t("notices.dismiss")}
              aria-describedby="{uid}-{index}"
              onmousedown={keepFocusOnPress}
              onclick={() => close(notice)}
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
