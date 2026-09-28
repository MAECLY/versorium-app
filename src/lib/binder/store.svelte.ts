import { api, isTauri, type ChapterMeta, type Project } from "$lib/tauri";
import { t } from "$lib/i18n";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** All navigation drains the current document before changing its identity. */
export class BinderStore {
  projects = $state<Project[]>([]);
  project = $state<Project | null>(null);
  currentChapter = $state<ChapterMeta | null>(null);
  chapterBody = $state("");
  loading = $state(false);
  saveState = $state<SaveState>("idle");
  error = $state<string | null>(null);
  beforeLeave: (() => Promise<void>) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private savedBody = "";
  private writes = Promise.resolve();

  get canOpen(): boolean { return this.project !== null; }

  async refreshProjects(): Promise<void> {
    try {
      this.projects = await api.listProjects(await api.defaultProjectsDir());
    } catch (e) {
      this.error = this.codeMessagePublic(e);
    }
  }

  updateBody(body: string): void {
    this.chapterBody = body;
    this.saveState = "idle";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), 800);
  }

  /** Capture both document identity and content before crossing an await. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const path = this.project?.path;
    const file = this.currentChapter?.file;
    const body = this.chapterBody;
    if (!path || !file) return;
    const run = this.writes.catch(() => {}).then(async () => {
      if (this.project?.path === path && this.currentChapter?.file === file && body === this.savedBody) return;
      this.saveState = "saving";
      try {
        const updated = await api.saveChapter(path, file, body);
        if (this.project?.path === path) {
          this.project = { ...this.project, chapters: this.project.chapters.map(c => c.file === file ? updated : c) };
          if (this.currentChapter?.file === file) {
            this.currentChapter = updated;
            this.savedBody = body;
            this.saveState = this.chapterBody === body ? "saved" : "idle";
          }
        }
      } catch (e) {
        this.saveState = "error";
        this.error = this.codeMessagePublic(e);
        throw e;
      }
    });
    this.writes = run;
    await run;
  }

  async saveChapter(body: string): Promise<boolean> {
    this.chapterBody = body;
    try { await this.flush(); return true; } catch { return false; }
  }

  /** Rust already wrote this body (e.g. an applied rewrite): adopt it as saved. */
  adoptSaved(body: string, meta: ChapterMeta): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.chapterBody = body;
    this.savedBody = body;
    this.currentChapter = meta;
    if (this.project) {
      this.project = { ...this.project, chapters: this.project.chapters.map(c => c.file === meta.file ? meta : c) };
    }
    this.saveState = "saved";
  }

  async flushAll(): Promise<void> {
    await this.beforeLeave?.();
    await this.flush();
  }

  private async navigate(action: () => Promise<void>): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      await this.flushAll();
      await action();
      this.error = null;
    } catch (e) {
      this.error = this.codeMessagePublic(e);
    } finally { this.loading = false; }
  }

  private async selectProject(project: Project): Promise<void> {
    const chapter = project.chapters[0] ?? null;
    const doc = chapter ? await api.readChapter(project.path, chapter.file) : null;
    this.project = project;
    this.currentChapter = chapter;
    this.chapterBody = doc?.body ?? "";
    this.savedBody = this.chapterBody;
    this.saveState = "idle";
    this.notifyMcp(project.path);
  }

  /**
   * `versorium mcp` is a separate process and learns which manuscript is open
   * only from what the app records. Fire-and-forget: failing to notify it is
   * never a reason to stop the writer from moving around.
   */
  private notifyMcp(path: string | null): void {
    if (!isTauri()) return;
    void api.mcpSetActiveProject(path).catch(() => undefined);
  }

  async createProject(title: string, language: string): Promise<void> {
    await this.navigate(async () => {
      const project = await api.createProject(await api.defaultProjectsDir(), title, language);
      await this.selectProject(project);
      await this.refreshProjects();
    });
  }

  async openProject(path: string): Promise<void> {
    await this.navigate(async () => this.selectProject(await api.openProject(path)));
  }

  async openChapter(chapter: ChapterMeta): Promise<void> {
    await this.navigate(async () => {
      if (!this.project) return;
      const doc = await api.readChapter(this.project.path, chapter.file);
      this.currentChapter = chapter;
      this.chapterBody = doc.body;
      this.savedBody = doc.body;
      this.saveState = "idle";
    });
  }

  async createChapter(title: string): Promise<void> {
    await this.navigate(async () => {
      if (!this.project) return;
      const chapter = await api.createChapter(this.project.path, title);
      const doc = await api.readChapter(this.project.path, chapter.file);
      this.project = { ...this.project, chapters: [...this.project.chapters, chapter] };
      this.currentChapter = chapter;
      this.chapterBody = doc.body;
      this.savedBody = doc.body;
      this.saveState = "idle";
    });
  }

  async closeProject(): Promise<void> {
    await this.navigate(async () => {
      this.project = null;
      this.currentChapter = null;
      this.chapterBody = "";
      this.savedBody = "";
      this.saveState = "idle";
      this.notifyMcp(null);
    });
  }

  codeMessagePublic(e: unknown): string {
    const raw = String(e ?? "");
    const code = raw.split(" ").pop() ?? raw;
    return t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t("errors.generic");
  }
}

export const store = new BinderStore();
