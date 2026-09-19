import { expect, it } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import App from "./App.svelte";
import { setLocale } from "$lib/i18n";
import { setTheme, setThemeMode } from "$lib/themes";

it("renders the app and switches reactive language and Folio theme", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(App, { target });
  flushSync();
  // The create CTA needs Tauri; the empty-state copy is what web preview shows.
  expect(target.textContent).toContain("Create a project to start writing");
  expect(target.textContent).toContain("No projects yet.");
  await setLocale("es");
  flushSync();
  expect(target.textContent).toContain("Crea un proyecto para empezar a escribir");
  expect(target.textContent).toContain("Aún no hay proyectos.");
  expect(document.documentElement.lang).toBe("es");
  setTheme("folio");
  setThemeMode("dark");
  expect(document.documentElement.dataset.theme).toBe("folio-dark");
  await unmount(app);
  target.remove();
});
