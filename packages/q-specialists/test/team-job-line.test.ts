import { describe, expect, it } from "vitest";

import { teamJobLine, waitingWork } from "../src/team-job.js";

/**
 * Live 2026-10-23 (founder.maji-loop): "Something like this is already
 * waiting for you: Q's team: Prepare for the first call with Savanna Seed
 * Partners …without booking it.. Shall I plan this one anyway?" -- an
 * internal name and a double full stop.
 */
describe("the line about work already waiting", () => {
  const summary =
    "Q's team: Prepare for the first call with Savanna Seed Partners by reviewing their waiting messages, researching the firm, and identifying a suitable meeting time without booking it.";

  it("never names Q's internals and ends each sentence once", () => {
    const line = teamJobLine({
      status: "ALREADY_WAITING",
      waiting: [summary],
    } as never);
    expect(line).not.toContain("Q's team");
    expect(line).not.toMatch(/\.\./u);
    expect(line).toContain(
      "already waiting for you: Prepare for the first call with Savanna Seed Partners",
    );
  });

  it("keeps the work's own words, without the label or end punctuation", () => {
    expect(waitingWork(summary)).toBe(
      "Prepare for the first call with Savanna Seed Partners by reviewing their waiting messages, researching the firm, and identifying a suitable meeting time without booking it",
    );
    expect(waitingWork("Q’s team: Send the memo!")).toBe("Send the memo");
    expect(waitingWork("Send Ledgerfold these 5 questions")).toBe(
      "Send Ledgerfold these 5 questions",
    );
  });
});
