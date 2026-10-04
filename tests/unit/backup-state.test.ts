import { describe, expect, it } from "vitest";
import { UNKNOWN_STATE, newerState } from "$lib/backup/state";
import type { BackupState } from "$lib/tauri";

const running: BackupState = { running: { project: "/novels/el-faro", startedAt: 1_790_553_600 }, seq: 3 };
const finished: BackupState = { running: null, seq: 4 };

describe("which report about the backup in progress to believe", () => {
  it("keeps a newer event over an older answer that arrives after it", () => {
    // The panel asked while the run was going; the run ended and said so;
    // then the answer to the question arrived.
    expect(newerState(finished, running)).toBe(finished);
  });

  it("takes a newer report over an older one", () => {
    expect(newerState(running, finished)).toBe(finished);
  });

  it("takes the first report over knowing nothing", () => {
    expect(newerState(UNKNOWN_STATE, running)).toBe(running);
    expect(newerState(UNKNOWN_STATE, { running: null, seq: 0 }).seq).toBe(0);
  });
});
