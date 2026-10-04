import { beforeEach, expect, it, vi } from "vitest";
import { api } from "$lib/tauri";
import { store } from "$lib/binder/store.svelte";
import { detectAgents } from "$lib/ai/agents";
import {
  OnboardingStore,
  STEPS,
  TEMPLATES,
  isLastStep,
  templateChapterKeys,
} from "./state.svelte";

vi.mock("$lib/tauri", () => ({
  api: { modelsView: vi.fn(), setSettings: vi.fn() },
  isTauri: () => true,
}));
vi.mock("$lib/ai/agents", () => ({ detectAgents: vi.fn() }));
vi.mock("$lib/binder/store.svelte", () => ({
  store: { createProject: vi.fn(), createChapter: vi.fn(), loading: false },
}));

let onboarding: OnboardingStore;

beforeEach(() => {
  vi.clearAllMocks();
  store.loading = false;
  vi.mocked(api.modelsView).mockResolvedValue({
    hardware: { totalRamGb: 36, recommendedTier: "midPlus" },
  } as never);
  vi.mocked(api.setSettings).mockResolvedValue({} as never);
  vi.mocked(store.createProject).mockResolvedValue(null);
  vi.mocked(store.createChapter).mockResolvedValue(null);
  vi.mocked(detectAgents).mockResolvedValue([]);
  onboarding = new OnboardingStore();
});

it("walks the steps spec §14 lists, in order", async () => {
  await onboarding.start();
  expect(onboarding.step).toBe("machine");
  expect(STEPS).toEqual(["machine", "agents", "project", "template", "firstScene"]);

  onboarding.next();
  expect(onboarding.step).toBe("agents");
  onboarding.back();
  expect(onboarding.step).toBe("machine");

  // The ends are walls, not wrap-arounds.
  onboarding.back();
  expect(onboarding.step).toBe("machine");
  for (let i = 0; i < 10; i++) onboarding.next();
  expect(onboarding.step).toBe("firstScene");
  expect(isLastStep(onboarding.step)).toBe(true);
});

it("reads the machine and the agents without downloading anything", async () => {
  await onboarding.start();
  expect(onboarding.hardware?.recommendedTier).toBe("midPlus");
  // Nothing that writes or fetches a model may be called by the tour.
  expect(api.setSettings).not.toHaveBeenCalled();
  expect(store.createProject).not.toHaveBeenCalled();
});

it("creates nothing until the project step is confirmed", async () => {
  await onboarding.start();
  onboarding.next();
  onboarding.next();
  expect(onboarding.step).toBe("project");
  expect(store.createProject).not.toHaveBeenCalled();

  // An unnamed project is not a project.
  await onboarding.createProject();
  expect(store.createProject).not.toHaveBeenCalled();
  expect(onboarding.created).toBe(false);

  onboarding.title = "  The Long Winter  ";
  onboarding.language = "es";
  await onboarding.createProject();
  expect(store.createProject).toHaveBeenCalledWith("The Long Winter", "es");
  expect(onboarding.created).toBe(true);
  expect(onboarding.step).toBe("template");
});

it("does not move on while the binder is still opening something, having made nothing", async () => {
  await onboarding.start();
  onboarding.step = "project";
  onboarding.title = "The Long Winter";
  // The binder answers null both when it made the project and when it was
  // busy and did nothing; only the second may not move the tour on.
  store.loading = true;
  await onboarding.createProject();
  expect(store.createProject).not.toHaveBeenCalled();
  expect(onboarding.created).toBe(false);
  expect(onboarding.step).toBe("project");

  store.loading = false;
  await onboarding.createProject();
  expect(onboarding.created).toBe(true);
  expect(onboarding.step).toBe("template");

  store.loading = true;
  await onboarding.applyTemplate(["Act One", "Act Two"]);
  expect(store.createChapter).not.toHaveBeenCalled();
  expect(onboarding.step, "the structure is still to be made").toBe("template");
});

it("does not create the same project twice", async () => {
  await onboarding.start();
  onboarding.title = "Once";
  await onboarding.createProject();
  await onboarding.createProject();
  expect(store.createProject).toHaveBeenCalledTimes(1);
});

it("keeps the writer on the project step when creating fails, and says why in their words", async () => {
  await onboarding.start();
  onboarding.step = "project";
  // What the binder hands back is a sentence already: read as an error code
  // it became "Something went wrong.".
  vi.mocked(store.createProject).mockResolvedValue("A project with that name already exists.");

  onboarding.title = "Taken";
  await onboarding.createProject();
  expect(onboarding.created).toBe(false);
  expect(onboarding.step).toBe("project");
  expect(onboarding.error).toBe("A project with that name already exists.");
});

it("stops seeding at the first chapter that cannot be made, and says why", async () => {
  await onboarding.start();
  onboarding.title = "Structured";
  await onboarding.createProject();
  vi.mocked(store.createChapter).mockResolvedValueOnce(null).mockResolvedValueOnce("A title cannot be blank.");

  await onboarding.applyTemplate(["Act One", "", "Act Three"]);
  expect(store.createChapter).toHaveBeenCalledTimes(2);
  expect(onboarding.error).toBe("A title cannot be blank.");
  expect(onboarding.step, "still on the structure, to pick again").toBe("template");
});

it("seeds chapter titles for a structure and nothing for blank", async () => {
  // Blank is the default and the single-keystroke path.
  expect(onboarding.template).toBe("blank");
  expect(templateChapterKeys("blank")).toEqual([]);

  expect(templateChapterKeys("threeAct")).toHaveLength(3);
  expect(templateChapterKeys("kishotenketsu")).toHaveLength(4);
  expect(templateChapterKeys("saveTheCat")).toHaveLength(15);

  // Keys, not prose: the titles live in the locale files so a Spanish writer
  // does not open a manuscript full of English beat names.
  expect(templateChapterKeys("threeAct")[0]).toBe("onboarding.templates.threeAct.1");
  for (const template of TEMPLATES) {
    for (const key of templateChapterKeys(template)) {
      expect(key.startsWith(`onboarding.templates.${template}.`)).toBe(true);
    }
  }
});

it("writes one chapter per seeded title, and none for blank", async () => {
  await onboarding.start();
  onboarding.title = "Structured";
  await onboarding.createProject();

  await onboarding.applyTemplate(["Act One", "Act Two", "Act Three"]);
  expect(store.createChapter).toHaveBeenCalledTimes(3);
  expect(store.createChapter).toHaveBeenNthCalledWith(2, "Act Two");
  expect(onboarding.step).toBe("firstScene");
});

it("seeds nothing when the template is blank", async () => {
  await onboarding.start();
  onboarding.title = "Bare";
  await onboarding.createProject();

  await onboarding.applyTemplate([]);
  expect(store.createChapter).not.toHaveBeenCalled();
  expect(onboarding.step).toBe("firstScene");
});

it("marks the run done when skipped from any step", async () => {
  for (const step of STEPS) {
    vi.clearAllMocks();
    vi.mocked(api.setSettings).mockResolvedValue({} as never);
    const tour = new OnboardingStore();
    tour.open = true;
    tour.step = step;

    await tour.skip();
    expect(tour.open, `skipping from ${step} closes the tour`).toBe(false);
    expect(api.setSettings).toHaveBeenCalledWith({ onboarded: true });
  }
});

it("finishing marks the run done the same way", async () => {
  await onboarding.start();
  await onboarding.finish();
  expect(onboarding.open).toBe(false);
  expect(api.setSettings).toHaveBeenCalledWith({ onboarded: true });
});

it("a failure to remember never traps the writer in the tour", async () => {
  vi.mocked(api.setSettings).mockRejectedValue("io");
  await onboarding.start();
  await onboarding.skip();
  expect(onboarding.open).toBe(false);
});

it("only the project step gates advancing", async () => {
  await onboarding.start();
  expect(onboarding.canAdvance).toBe(true);

  onboarding.step = "project";
  expect(onboarding.canAdvance).toBe(false);
  onboarding.title = "Named";
  expect(onboarding.canAdvance).toBe(true);
});
