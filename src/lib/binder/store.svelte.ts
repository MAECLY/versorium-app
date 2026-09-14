import { api, type ChapterMeta, type Project } from "$lib/tauri";
import { t } from "$lib/i18n";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Reactive app store (Svelte 5 runes module). */
class BinderStore {
  projects = $state<Project[]>([]);
  project = $state<Project | null>(null);
  currentChapter = $state<ChapterMeta | null>(null);
  chapterBody = $state("");
  loading = $state(false);
  saveState = $state<SaveState>("idle");
  error = $state<string | null>(null);

  get canOpen(): boolean {
    return this.project !== null;
  }

  async refreshProjects(): Promise<void> {
    this.loading = true;
    try {
      const dir = await api.defaultProjectsDir();
      try {
        await (await import("node:fs")).promises.mkdir(dir, { recursive: true });
      } catch {
        // outside Tauri; Rust creates it on demand
      }
      this.projects = await api.listProjects(dir);
      this.error = null;
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }

  async createProject(title: string, language: string): Promise<void> {
    this.loading = true;
    try {
      const dir = await api.defaultProjectsDir();
      const p = await api.createProject(dir, title, language);
      await this.refreshProjects();
      this.project = p;
      await this.openChapter(p.chapters[0]);
      this.error = null;
    } catch (e) {
      this.error = this.codeMessage(e);
    } finally {
      this.loading = false;
    }
  }

  async openProject(path: string): Promise<void> {
    this.loading = true;
    try {
      const p = await api.openProject(path);
      this.project = p;
      if (p.chapters.length > 0) await this.openChapter(p.chapters[0]);
      this.error = null;
    } catch (e) {
      this.error = this.codeMessage(e);
    } finally {
      this.loading = false;
    }
  }

  async openChapter(chapter: ChapterMeta): Promise<void> {
    if (!this.project) return;
    this.currentChapter = chapter;
    const doc = await api.readChapter(this.project.path, chapter.file);
    this.chapterBody = doc.body;
    this.saveState = "idle";
  }

  async createChapter(title: string): Promise<void> {
    if (!this.project) return;
    this.loading = true;
    try {
      const ch = await api.createChapter(this.project.path, title);
      const fresh = await api.listChapters(this.project.path);
      this.project = { ...this.project, chapters: fresh };
      await this.openChapter(ch);
      this.error = null;
    } catch (e) {
      this.error = this.codeMessage(e);
    } finally {
      this.loading = false;
    }
  }

  /** Debounced autosave of the open chapter. Returns true on success. */
  async saveChapter(body: string): Promise<boolean> {
    if (!this.project || !this.currentChapter) return false;
    this.saveState = "saving";
    try {
      const updated = await api.saveChapter(this.project.path, this.currentChapter.file, body);
      this.currentChapter = updated;
      const fresh = await api.listChapters(this.project.path);
      this.project = { ...this.project, chapters: fresh };
      this.saveState = "saved";
      return true;
    } catch (e) {
      this.saveState = "error";
      this.error = this.codeMessage(e);
      return false;
    }
  }

  closeProject(): void {
    this.project = null;
    this.currentChapter = null;
    this.chapterBody = "";
    this.saveState = "idle";
  }

  private codeMessage(e: unknown): string {
    const raw = String(e ?? "");
    const code = raw.split(" ").pop() ?? raw;
    return t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : raw;
  }

  /** Public variant for components outside the store. */
  codeMessagePublic(e: unknown): string {
    return this.codeMessage(e);
  }
}

export const store = new BinderStore();
