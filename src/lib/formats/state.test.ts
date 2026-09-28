import { beforeEach, expect, it, vi } from "vitest";
import { api, type ExportResult, type Imported, type Project } from "$lib/tauri";
import { FormatsStore, bodyWords } from "./state.svelte";
import { warningMessage } from "$lib/i18n/errors";

vi.mock("$lib/tauri", () => ({
  api: {
    exportManuscript: vi.fn(),
    importPreview: vi.fn(),
    importApply: vi.fn(),
    setAuthor: vi.fn(),
    pickExportTarget: vi.fn(),
    pickImportFile: vi.fn(),
    pickImportProject: vi.fn(),
  },
  isTauri: () => true,
}));

const written: ExportResult = { path: "/out/novel.docx", bytes: 40_960, format: "docx" };
const preview: Imported = {
  title: "The Long Winter",
  chapters: [{ title: "One", body: "## Scene\n\nUna frase corta.", synopsis: null }],
  warnings: ["import_docx_formatting_dropped"],
};

let formats: FormatsStore;
beforeEach(() => {
  vi.clearAllMocks();
  formats = new FormatsStore();
});

it("keeps the result of an export the user chose a destination for", async () => {
  vi.mocked(api.pickExportTarget).mockResolvedValue("/out/novel.docx");
  vi.mocked(api.exportManuscript).mockResolvedValue(written);

  await formats.exportAs("/novel", "docx", "The Long Winter");

  expect(api.pickExportTarget).toHaveBeenCalledWith("The Long Winter.docx", "Word", "docx");
  expect(api.exportManuscript).toHaveBeenCalledWith("/novel", "docx", "/out/novel.docx");
  expect(formats.result).toEqual(written);
  expect(formats.busy).toBe(false);
  expect(formats.error).toBeNull();
});

it("backing out of the save dialog is not a failure", async () => {
  vi.mocked(api.pickExportTarget).mockResolvedValue(null);

  await formats.exportAs("/novel", "md", "Novel");

  expect(api.exportManuscript).not.toHaveBeenCalled();
  expect(formats.error).toBeNull();
  expect(formats.result).toBeNull();
});

it("a failed export surfaces a localized error and stops being busy", async () => {
  vi.mocked(api.pickExportTarget).mockResolvedValue("/out/novel.pdf");
  vi.mocked(api.exportManuscript).mockRejectedValue("no_author");

  await formats.exportAs("/novel", "pdf", "Novel");

  expect(formats.error).toBe("This format needs an author for its running heads.");
  expect(formats.busy).toBe(false);
  expect(formats.result).toBeNull();
});

it("previewing an import reads the source and writes nothing", async () => {
  vi.mocked(api.pickImportFile).mockResolvedValue("/in/novel.md");
  vi.mocked(api.importPreview).mockResolvedValue(preview);

  await formats.pickAndPreview("file");

  expect(formats.preview).toEqual(preview);
  expect(formats.source).toBe("/in/novel.md");
  expect(api.importApply).not.toHaveBeenCalled();
});

it("a Scrivener import picks a bundle directory rather than a file", async () => {
  vi.mocked(api.pickImportProject).mockResolvedValue("/in/Novel.scriv");
  vi.mocked(api.importPreview).mockResolvedValue(preview);

  await formats.pickAndPreview("project");

  expect(api.pickImportProject).toHaveBeenCalled();
  expect(api.pickImportFile).not.toHaveBeenCalled();
  expect(formats.source).toBe("/in/Novel.scriv");
});

it("applying an import uses the previewed source and the title the writer confirmed", async () => {
  vi.mocked(api.pickImportFile).mockResolvedValue("/in/novel.md");
  vi.mocked(api.importPreview).mockResolvedValue(preview);
  vi.mocked(api.importApply).mockResolvedValue({ path: "/novels/renamed" } as Project);

  await formats.pickAndPreview("file");
  const path = await formats.applyImport("Renamed");

  expect(api.importApply).toHaveBeenCalledWith("/in/novel.md", "Renamed");
  expect(path).toBe("/novels/renamed");
  // The preview is spent once it has become a project.
  expect(formats.preview).toBeNull();
  expect(formats.source).toBeNull();
});

it("applying without a preview does nothing", async () => {
  expect(await formats.applyImport("Whatever")).toBeNull();
  expect(api.importApply).not.toHaveBeenCalled();
});

it("a failed import keeps the preview so the writer can retry", async () => {
  vi.mocked(api.pickImportFile).mockResolvedValue("/in/novel.md");
  vi.mocked(api.importPreview).mockResolvedValue(preview);
  vi.mocked(api.importApply).mockRejectedValue("project_exists");

  await formats.pickAndPreview("file");
  const path = await formats.applyImport("The Long Winter");

  expect(path).toBeNull();
  expect(formats.error).toBe("A project with that name already exists.");
  expect(formats.preview).toEqual(preview);
});

it("counts prose words without counting scene headings", () => {
  expect(bodyWords("## Scene\n\nUna frase corta.")).toBe(3);
  expect(bodyWords("")).toBe(0);
  expect(bodyWords("# Chapter\n## Scene")).toBe(0);
});

it("renders a warning code as copy, and an unknown one as itself", () => {
  // Rust sends codes, never prose — but a code added after this build must
  // still show something rather than nothing.
  expect(warningMessage("import_title_guessed")).toBe("The title was taken from the first heading.");
  expect(warningMessage("import_from_a_future_format")).toBe("import_from_a_future_format");
});
