<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n";
  import { openExternal } from "$lib/external";

  /**
   * A link to a web page, opened in the system browser (`openExternal`) and
   * never in Versorium's window. A real `<a href>`, so it is announced as a
   * link and its address can be read; every way a webview would follow it by
   * itself is cancelled: a click (a modified one and Enter included), the
   * middle button and a drag. The right-click policy treats it as a control
   * (`NOT_TEXT` in src/lib/contextmenu/policy.ts), so the engine's own "Open
   * Link" is never offered either.
   *
   * Its accessible name begins with the words on screen and ends by saying
   * the link leaves the app: "(opens in your browser)", or "(opens {where} in
   * your browser)" when those words do not name the place.
   */
  let {
    href,
    where,
    onopen,
    onfail,
    children,
  }: {
    href: string;
    /** The place, for a link whose words are a name rather than an address. */
    where?: string;
    onopen?: (url: string) => void;
    /** The browser could not be opened; the page says so, with the address. */
    onfail?: (url: string) => void;
    children: Snippet;
  } = $props();

  function follow(event: MouseEvent): void {
    event.preventDefault();
    openExternal(href).then(
      () => onopen?.(href),
      () => onfail?.(href),
    );
  }

  /** The middle button means "open it somewhere else", and the browser is that place. */
  function followAux(event: MouseEvent): void {
    event.preventDefault();
    if (event.button === 1) follow(event);
  }

  let leaves = $derived(where ? t("links.opensPlaceInBrowser", { place: where }) : t("links.opensInBrowser"));
</script>

<a class="v-link" {href} rel="noopener noreferrer" draggable="false" onclick={follow} onauxclick={followAux}
  >{@render children()}<span class="sr-only">{` ${leaves}`}</span></a
>
