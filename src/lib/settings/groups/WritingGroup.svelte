<script lang="ts">
  import TypographySection from "$lib/settings/TypographySection.svelte";
</script>

<!-- Only typography for now. Focus mode and the typewriter line are writing
     settings too and are already persisted, but they are reachable solely as
     TopBar toggles; bringing them here is the next step, not this one. -->
<TypographySection />
