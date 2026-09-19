import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
it("wraps structured Rust command arguments", async () => {
  await api.createProject("/novels", "Test", "es");
  expect(invoke).toHaveBeenLastCalledWith("create_project", { args: { path: "/novels", title: "Test", language: "es" } });
  await api.readChapter("/novels/test", "manuscript/ch-01.md");
  expect(invoke).toHaveBeenLastCalledWith("read_chapter", { args: { path: "/novels/test", file: "manuscript/ch-01.md" } });
  const op = { seq: 0, ts: 1, author: "human", kind: "insert" as const, from: 0, to: 1, text: "a" };
  await api.opsAppend("/novels/test", "ch-01", "a", [op]);
  expect(invoke).toHaveBeenLastCalledWith("ops_append", { args: { path: "/novels/test", chapter: "ch-01", body: "a", ops: [op] } });
  await api.aiApplyRewrite({ path: "/novels/test", file: "manuscript/ch-01.md", from: 0, to: 1, text: "b", provider: "claude", expected: "a" });
  expect(invoke).toHaveBeenLastCalledWith("ai_apply_rewrite", { args: { path: "/novels/test", file: "manuscript/ch-01.md", from: 0, to: 1, text: "b", provider: "claude", expected: "a" } });
});
