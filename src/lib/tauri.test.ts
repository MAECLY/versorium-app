import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
it("wraps structured Rust command arguments", async () => {
  await api.createProject("/novels", "Test", "es");
  expect(invoke).toHaveBeenLastCalledWith("create_project", { args: { path: "/novels", title: "Test", language: "es" } });
  await api.readChapter("/novels/test", "manuscript/ch-01.md");
  expect(invoke).toHaveBeenLastCalledWith("read_chapter", { args: { path: "/novels/test", file: "manuscript/ch-01.md" } });
});
