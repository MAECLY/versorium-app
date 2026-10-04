import { api, isTauri, type AgentInfo, type Hardware } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";
import { detectAgents } from "$lib/ai/agents";
import { store } from "$lib/binder/store.svelte";

/** The first-run steps, in the order spec §14 lists them. */
export const STEPS = ["machine", "agents", "project", "template", "firstScene"] as const;
export type Step = (typeof STEPS)[number];

export type TemplateId = "blank" | "threeAct" | "saveTheCat" | "kishotenketsu";

export const TEMPLATES: readonly TemplateId[] = [
  "blank",
  "threeAct",
  "saveTheCat",
  "kishotenketsu",
] as const;

/**
 * How many chapters each structure seeds. A template seeds **titles only** —
 * Versorium never writes prose the author did not ask for, and Creative Mode
 * has no engine in v1.
 */
const TEMPLATE_LENGTHS: Record<TemplateId, number> = {
  blank: 0,
  threeAct: 3,
  saveTheCat: 15,
  kishotenketsu: 4,
};

/**
 * The i18n keys holding a template's chapter titles. They live in the locale
 * files rather than here because they end up as chapter titles in the writer's
 * own project, and a Spanish writer should not open a manuscript full of
 * English beat names.
 */
export function templateChapterKeys(template: TemplateId): string[] {
  return Array.from(
    { length: TEMPLATE_LENGTHS[template] },
    (_, i) => `onboarding.templates.${template}.${i + 1}`,
  );
}

export function isLastStep(step: Step): boolean {
  return step === STEPS[STEPS.length - 1];
}

/**
 * First-run state. Nothing here touches disk until {@link createProject}: the
 * machine and agent steps only read what is already known, so a writer who
 * backs out at any point leaves no project behind.
 */
export class OnboardingStore {
  open = $state(false);
  step = $state<Step>(STEPS[0]);
  busy = $state(false);
  error = $state<string | null>(null);

  hardware = $state<Hardware | null>(null);
  agents = $state<AgentInfo[]>([]);

  title = $state("");
  language = $state("en");
  template = $state<TemplateId>("blank");
  /** True once the project exists on disk. */
  created = $state(false);

  get stepIndex(): number {
    return STEPS.indexOf(this.step);
  }

  get canAdvance(): boolean {
    // The project step is the one gate: a project needs a name.
    if (this.step === "project") return this.title.trim().length > 0 || this.created;
    return true;
  }

  /** Open the tour. Reads hardware and agents; downloads nothing. */
  async start(): Promise<void> {
    this.open = true;
    this.step = STEPS[0];
    this.error = null;
    this.created = false;
    if (!isTauri()) return;
    await this.run(async () => {
      const [view, agents] = await Promise.all([
        Promise.resolve(api.modelsView()).catch(() => null),
        Promise.resolve(detectAgents()).catch(() => [] as AgentInfo[]),
      ]);
      this.hardware = view?.hardware ?? null;
      this.agents = agents ?? [];
    });
  }

  next(): void {
    const at = this.stepIndex;
    if (at < STEPS.length - 1) this.step = STEPS[at + 1];
  }

  back(): void {
    const at = this.stepIndex;
    if (at > 0) this.step = STEPS[at - 1];
  }

  /**
   * Leave the tour from wherever they are. Spec §14 ends on "sin signup" — the
   * whole thing has to be abandonable without consequence, so this marks the
   * run done rather than asking again on the next launch.
   */
  async skip(): Promise<void> {
    await this.markDone();
  }

  async finish(): Promise<void> {
    await this.markDone();
  }

  /**
   * The only step that writes. Creating a project git-inits it, as always.
   * The binder hands back a sentence already in the writer's language, so it
   * is shown as it is: run() would read it as an error code and say
   * "Something went wrong." instead.
   *
   * Not while the binder is opening something: it would answer null without
   * making the project, and the tour would go on as if it had.
   */
  async createProject(): Promise<void> {
    const title = this.title.trim();
    if (!title || this.created || store.loading) return;
    await this.run(async () => {
      const failed = await store.createProject(title, this.language);
      if (failed) this.error = failed;
      else this.created = true;
    });
    if (!this.error) this.step = "template";
  }

  /** Seed the chapter titles for the chosen structure. Blank seeds nothing. */
  async applyTemplate(titles: string[]): Promise<void> {
    if (!this.created || titles.length === 0) {
      this.step = "firstScene";
      return;
    }
    if (store.loading) return;
    await this.run(async () => {
      for (const title of titles) {
        const failed = await store.createChapter(title);
        if (failed) {
          this.error = failed;
          return;
        }
      }
    });
    if (!this.error) this.step = "firstScene";
  }

  private async markDone(): Promise<void> {
    this.open = false;
    if (!isTauri()) return;
    try {
      await api.setSettings({ onboarded: true });
    } catch {
      // Failing to remember is not worth blocking on; the tour is skippable
      // anyway and will simply offer itself again.
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      await work();
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
}

export const onboarding = new OnboardingStore();
