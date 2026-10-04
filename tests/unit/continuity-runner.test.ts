import { beforeEach, expect, it, vi } from "vitest";
import { api, type ContinuityReport } from "$lib/tauri";
import { ContinuityRunner } from "$lib/continuity/state.svelte";

// Manuscript › Continuity's runner. A check takes minutes and outlives the
// dialog that started it; the next dialog may be over another novel, so a
// check that was running when the dialog closed answers nobody.

vi.mock("$lib/tauri", () => ({ api: { continuityCheck: vi.fn() }, isTauri: () => true }));

/** A check still on its way, and the hand that answers it. */
function pending(): { answer: (report: ContinuityReport) => void; fail: (code: string) => void } {
  let answer: (report: ContinuityReport) => void = () => {};
  let fail: (code: string) => void = () => {};
  vi.mocked(api.continuityCheck).mockReturnValueOnce(
    new Promise<ContinuityReport>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    }),
  );
  return { answer: (report) => answer(report), fail: (code) => fail(code) };
}

const found = (detail: string): ContinuityReport => ({
  ran: true,
  reason: null,
  findings: [{ kind: "contradiction", chapter: "ch-02", detail }],
});

let runner: ContinuityRunner;
beforeEach(() => {
  vi.clearAllMocks();
  runner = new ContinuityRunner();
});

it("a check still running when the dialog closed shows nothing in the next one", async () => {
  const a = pending();
  const running = runner.run("/novels/A");
  expect(runner.busy).toBe(true);

  // Closed mid-run; the next dialog (over novel B) starts clean...
  runner.reset();
  expect(runner.busy).toBe(false);
  // ...and A's answer, when it comes, lands nowhere.
  a.answer(found("Ana's eyes change colour."));
  await running;
  expect(runner.report).toBeNull();
  expect(runner.busy).toBe(false);
});

it("an old check that ends late does not touch the one running now", async () => {
  const a = pending();
  const first = runner.run("/novels/A");
  runner.reset();

  const b = pending();
  const second = runner.run("/novels/B");
  expect(api.continuityCheck).toHaveBeenLastCalledWith("/novels/B");

  // A ends first, with an error: B is still running, and nothing is said.
  a.fail("io");
  await first;
  expect(runner.busy).toBe(true);
  expect(runner.error).toBeNull();

  b.answer(found("B's own finding."));
  await second;
  expect(runner.busy).toBe(false);
  expect(runner.report?.findings[0].detail).toBe("B's own finding.");
});

it("a check that fails outright says why, until the dialog opens again", async () => {
  vi.mocked(api.continuityCheck).mockRejectedValueOnce("io");
  await runner.run("/novels/A");
  expect(runner.error).toBe("File system error.");
  runner.reset();
  expect(runner.error).toBeNull();
  expect(runner.report).toBeNull();
});
