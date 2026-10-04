import { api, isTauri, type ChapterMeta,
  type ChapterStatus, type Project } from "$lib/tauri";
import { t } from "$lib/i18n";
import { notices } from "$lib/notices/state.svelte";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** All navigation drains the current document before changing its identity. */
export class BinderStore {
  projects = $state<Project[]>([]);
  project = $state<Project | null>(null);
  currentChapter = $state<ChapterMeta | null>(null);
  chapterBody = $state("");
  loading = $state(false);
  saveState = $state<SaveState>("idle");
  beforeLeave: (() => Promise<void>) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private savedBody = "";
  private writes = Promise.resolve();

  get canOpen(): boolean { return this.project !== null; }

  /**
   * Run an operation, surfacing a failure as a notice rather than a rejection.
   *
   * The same try/catch the older methods write inline; the editing operations
   * below all need it, and four more copies would be four chances to forget the
   * error. One id per binder action: the same failure twice is one notice, and
   * the same action working takes it away. Another action working leaves it,
   * since what failed has still not happened.
   */
  private async run(id: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      notices.dismiss(id);
    } catch (e) {
      notices.fail(this.codeMessagePublic(e), id);
    }
  }

  /** Rename a novel, or set its author. The folder does not move. */
  async renameProject(path: string, title: string): Promise<void> {
    await this.run("binder.renameProject", async () => {
      const meta = await api.updateProject(path, title);
      if (this.project?.path === path) this.project = { ...this.project, meta };
      await this.refreshProjects();
    });
  }

  /**
   * Move a novel to the system trash.
   *
   * Git cannot recover this — the repository goes with the folder — so the
   * recovery is the writer's own desktop trash.
   */
  async deleteProject(path: string): Promise<void> {
    await this.run("binder.deleteProject", async () => {
      this.projects = await api.deleteProject(path, await api.defaultProjectsDir());
      if (this.project?.path === path) {
        this.project = null;
        this.currentChapter = null;
        this.chapterBody = "";
      }
    });
  }

  /** Retitle a chapter, or change its status. The file does not move. */
  async updateChapter(file: string, title?: string, status?: ChapterStatus): Promise<void> {
    const path = this.project?.path;
    if (!path) return;
    // Two menu items, two actions: a status set does not undo a failed rename.
    await this.run(title === undefined ? "binder.chapterStatus" : "binder.renameChapter", async () => {
      const meta = await api.updateChapter(path, file, title, status);
      if (!this.project) return;
      this.project = {
        ...this.project,
        chapters: this.project.chapters.map((c) => (c.file === meta.file ? meta : c)),
      };
      if (this.currentChapter?.file === meta.file) this.currentChapter = meta;
    });
  }

  /**
   * Move a chapter one place up or down.
   *
   * Up and down rather than drag-and-drop: a binder is a keyboard surface, the
   * novel this exists for has forty chapters and not four hundred, and a drop
   * target that is one row tall is a worse way to move one chapter than a menu
   * item that says which way it is going.
   */
  async moveChapter(file: string, delta: -1 | 1): Promise<void> {
    const path = this.project?.path;
    const chapters = this.project?.chapters;
    if (!path || !chapters) return;
    const from = chapters.findIndex((c) => c.file === file);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= chapters.length) return;

    const ids = chapters.map((c) => c.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await this.run("binder.moveChapter", async () => {
      const reordered = await api.reorderChapters(path, ids);
      if (!this.project) return;
      this.project = { ...this.project, chapters: reordered };
    });
  }

  /**
   * Whether exports of this novel carry a title page and a colophon.
   *
   * Takes a path rather than assuming the open project: the binder offers this
   * from the menu of every novel in the sidebar, not only the one being edited.
   * Both the open project and the sidebar list are updated, so a dialog reading
   * either sees the result.
   *
   * Returns why it failed, or null, and posts nothing: the Project dialog that
   * asked is modal, and a notice would sit behind its backdrop, unread.
   */
  async setExportMatter(path: string, cover: boolean, colophon: boolean): Promise<string | null> {
    try {
      const meta = await api.updateProject(path, undefined, undefined, cover, colophon);
      this.projects = this.projects.map((p) => (p.path === path ? { ...p, meta } : p));
      if (this.project?.path === path) this.project = { ...this.project, meta };
      return null;
    } catch (e) {
      return this.codeMessagePublic(e);
    }
  }

  /** Delete a chapter. A git snapshot is taken first, so it can come back. */
  async deleteChapter(file: string): Promise<void> {
    const path = this.project?.path;
    if (!path) return;
    await this.run("binder.deleteChapter", async () => {
      const chapters = await api.deleteChapter(path, file);
      if (!this.project) return;
      this.project = { ...this.project, chapters };
      if (this.currentChapter?.file === file) {
        // Land somewhere real rather than on a chapter that no longer exists.
        this.currentChapter = null;
        this.chapterBody = "";
        if (chapters[0]) await this.openChapter(chapters[0]);
      }
    });
  }

  async refreshProjects(): Promise<void> {
    try {
      this.projects = await api.listProjects(await api.defaultProjectsDir());
      notices.dismiss("binder.list");
    } catch (e) {
      notices.fail(this.codeMessagePublic(e), "binder.list");
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
        // A failed save stays on screen until one goes through; the status
        // bar's "Unsaved" says the same, until then.
        notices.dismiss("binder.save");
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
        notices.fail(this.codeMessagePublic(e), "binder.save");
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

  /**
   * Returns why it failed, or null. `report` false is for a caller that shows
   * the failure itself, in its own dialog, where a notice would sit behind the
   * backdrop.
   *
   * Null also when it did nothing because another navigation is still
   * running: a caller that must tell the two apart checks `loading` first, as
   * the dialogs and the tour do.
   */
  private async navigate(action: () => Promise<void>, report = true): Promise<string | null> {
    if (this.loading) return null;
    this.loading = true;
    try {
      await this.flushAll();
      await action();
      notices.dismiss("binder.navigate");
      return null;
    } catch (e) {
      const message = this.codeMessagePublic(e);
      if (report) notices.fail(message, "binder.navigate");
      return message;
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

  /** Why it could not be made, or null. The dialog that asked shows it. */
  async createProject(title: string, language: string): Promise<string | null> {
    return this.navigate(async () => {
      const project = await api.createProject(await api.defaultProjectsDir(), title, language);
      await this.selectProject(project);
      await this.refreshProjects();
    }, false);
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

  /** Why it could not be made, or null. The dialog that asked shows it. */
  async createChapter(title: string): Promise<string | null> {
    return this.navigate(async () => {
      if (!this.project) return;
      const chapter = await api.createChapter(this.project.path, title);
      const doc = await api.readChapter(this.project.path, chapter.file);
      this.project = { ...this.project, chapters: [...this.project.chapters, chapter] };
      this.currentChapter = chapter;
      this.chapterBody = doc.body;
      this.savedBody = doc.body;
      this.saveState = "idle";
    }, false);
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
