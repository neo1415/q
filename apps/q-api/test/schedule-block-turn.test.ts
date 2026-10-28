import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  answer,
  buildTurn,
  last,
  offered,
  ok,
  toolCalls,
} from "./q-turn-harness.js";

/**
 * Live 2026-10-28 (founder Ajopot): "What's on my schedule today?" was
 * answered in words alone. When the model reads their schedule through
 * list_schedule, the read's own result becomes a SCHEDULE block on the
 * answer: their calls (with whether the prep brief is ready), their
 * reminders, and what waits for their approval, in their zone when it is
 * known (UTC, said as such, when it is not).
 */

const RELATIONSHIP = "91000000-0000-4000-8000-000000000001";
// A fixed morning clock: the test schedules a call 2 h ahead and a reminder
// 5 h ahead and expects both on today's card. On the real clock, run late
// in the day, the reminder fell on tomorrow and the card dropped it (CI
// 2026-10-28 21:16 UTC).
const FIXED_NOW = Date.parse("2026-10-28T09:00:00.000Z");
beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
});

const soon = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

const OFFERED = [
  offered("list_schedule", "calendar.schedule"),
  offered("list_pending_approvals", "approvals.list"),
];

describe("a schedule question carries the SCHEDULE block (live 2026-10-28)", () => {
  it("builds the block from list_schedule's own result, approvals beside it", async () => {
    const callAt = soon(2);
    const { seam, request, stored } = buildTurn({
      said: "What's on my schedule today?",
      script: [
        toolCalls([{ name: "list_schedule", arguments: {} }]),
        answer("You have one call today and one reminder."),
      ],
      offered: OFFERED,
      world: (proposal) => {
        if (proposal.name === "list_schedule") {
          return ok(proposal, "calendar.schedule", {
            meetings: [
              {
                id: "m-1",
                relationshipId: RELATIONSHIP,
                purpose: "Intro call with Savanna Seed Partners",
                startsAt: callAt,
                local: "today",
                organisedByYou: true,
                with: ["Amara Diallo-Benson"],
                brief: "Prep brief: ask about their cheque size.",
              },
            ],
            reminders: [
              {
                id: "r-1",
                title: "Send the deck to Zino Aviation",
                dueAt: soon(5),
                relationshipId: null,
              },
            ],
          });
        }
        if (proposal.name === "list_pending_approvals") {
          return ok(proposal, "approvals.list", {
            items: [{ summary: "Message Savanna Seed Partners" }],
          });
        }
        return null;
      },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const final = last(stored);
    const block = final.blocks.find((one) => one.kind === "SCHEDULE") as
      | {
          kind: "SCHEDULE";
          span: string;
          timeZone: string | null;
          calls: readonly { purpose: string; briefReady: boolean }[];
          reminders: readonly { title: string }[];
          approvals: readonly string[];
        }
      | undefined;
    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(block.timeZone).toBeNull();
    expect(block.calls).toEqual([
      expect.objectContaining({
        purpose: "Intro call with Savanna Seed Partners",
        briefReady: true,
      }),
    ]);
    expect(block.reminders.map((one) => one.title)).toEqual([
      "Send the deck to Zino Aviation",
    ]);
    expect(block.approvals).toEqual(["Message Savanna Seed Partners"]);
  });

  it("carries no SCHEDULE block when the schedule was not read for the answer", async () => {
    const { seam, request, stored } = buildTurn({
      said: "Who has expressed interest?",
      script: [answer("Zino Aviation has expressed interest.")],
      offered: OFFERED,
      world: (proposal) =>
        proposal.name === "list_schedule"
          ? ok(proposal, "calendar.schedule", { meetings: [], reminders: [] })
          : null,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(last(stored).kinds).not.toContain("SCHEDULE");
  });
});
