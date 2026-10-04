import {
  api,
  isTauri,
  type ExportLabels,
  type ExportFormat,
  type ExportResult,
  type Imported,
} from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";
import { tIn } from "$lib/i18n";

/** Extension and picker label per export format (spec §9). */
const TARGET: Record<ExportFormat, { extension: string; name: string }> = {
  md: { extension: "md", name: "Markdown" },
  docx: { extension: "docx", name: "Word" },
  epub: { extension: "epub", name: "EPUB" },
  pdf: { extension: "pdf", name: "PDF" },
  scriv: { extension: "scriv", name: "Scrivener" },
};

/** Formats written as a directory rather than a file. */
const BUNDLES: ExportFormat[] = ["scriv"];

/**
 * Export and import state for the Manuscript dialog.
 *
 * Importing is deliberately two steps: `pickAndPreview` only reads the source,
 * and nothing reaches disk until `applyImport`. A writer should see what a
 * lossy import is about to drop before it happens, not after.
 */
export class FormatsStore {
  busy = $state(false);
  error = $state<string | null>(null);
  result = $state<ExportResult | null>(null);
  preview = $state<Imported | null>(null);
  /** The file or bundle `preview` came from, carried into `applyImport`. */
  source = $state<string | null>(null);

  /** Ask for a destination, then write. A cancelled picker is not an error. */
  async exportAs(
    projectPath: string,
    format: ExportFormat,
    title: string,
    /** The manuscript's own language, which the colophon is written in. */
    language: string,
  ): Promise<void> {
    await this.run(async () => {
      const { extension, name } = TARGET[format];
      let dest: unknown;
      if (BUNDLES.includes(format)) {
        const parent = await api.pickDirectory();
        if (typeof parent !== "string") return;
        dest = `${parent}/${title}.${extension}`;
      } else {
        dest = await api.pickExportTarget(`${title}.${extension}`, name, extension);
      }
      if (typeof dest !== "string") return;
      this.result = await api.exportManuscript(projectPath, format, dest, exportLabels(language));
    });
  }

  /** Read a source and hold its preview. Writes nothing. */
  async pickAndPreview(kind: "file" | "project"): Promise<void> {
    await this.run(async () => {
      const source = await (kind === "file" ? api.pickImportFile() : api.pickImportProject());
      if (typeof source !== "string") return;
      this.preview = await api.importPreview(source);
      this.source = source;
    });
  }

  /**
   * Create the project the preview described, in the language the writer
   * settled on. Returns its path on success.
   */
  async applyImport(title: string, language: string): Promise<string | null> {
    const source = this.source;
    if (!source) return null;
    let path: string | null = null;
    await this.run(async () => {
      const project = await api.importApply(source, title, language);
      path = project.path;
      this.discardPreview();
    });
    return path;
  }

  discardPreview(): void {
    this.preview = null;
    this.source = null;
  }

  clearResult(): void {
    this.result = null;
  }

  private async run(body: () => Promise<void>): Promise<void> {
    if (!isTauri() || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      await body();
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
}

export const formats = new FormatsStore();

/** Words in an imported chapter body, for the preview list. */
export function bodyWords(body: string): number {
  return body
    .split("\n")
    // Scene headings are structure, not prose the writer counts.
    .filter((line) => !line.trimStart().startsWith("#"))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * The wording the colophon and the title page will carry.
 *
 * Built in the manuscript's language, not the interface's: a Spanish novel
 * exported by somebody running the app in English still says "Capítulos",
 * because the reader of the file is not the person who exported it.
 */
export function exportLabels(language: string): ExportLabels {
  const keys = ["title", "author", "publisher", "rights", "language", "chapters", "words"];
  const labels: ExportLabels = {
    heading: tIn(language, "project.colophonHeading"),
    thanks: tIn(language, "project.colophonThanks"),
  };
  for (const key of keys) labels[key] = tIn(language, `project.keys.${key}`);
  return labels;
}
