import { expect, it, vi } from "vitest";
import { answerQuit } from "./quit";

it("saves before saying quitting is safe", async () => {
  const order: string[] = [];
  await answerQuit(
    async () => { order.push("save"); },
    async (saved) => { order.push(`reply:${saved}`); },
    () => order.push("failure"),
  );
  expect(order).toEqual(["save", "reply:true"]);
});

it("a save that fails cancels the quit and says why", async () => {
  const reply = vi.fn(async () => {});
  const onFailure = vi.fn();
  await answerQuit(async () => { throw "write_failed"; }, reply, onFailure);
  expect(onFailure).toHaveBeenCalledWith("write_failed");
  expect(reply).toHaveBeenCalledWith(false);
});
