import { describe, expect, it, vi } from "vitest";

import type { QPlanStep, QPlanView } from "@capital-q/contracts";

vi.mock("server-only", () => ({}));
vi.mock("../src/features/q/context", () => ({
  qApiSession: vi.fn(() => Promise.resolve(null)),
  apiSession: vi.fn(() => Promise.resolve(null)),
  resolveOwnContext: vi.fn(),
}));

import { boardCountOf, boardTimeline } from "../src/features/q/board-timeline";
import type { QTurn } from "../src/features/q/conversation";
import {
  PLAN_APPROVAL_WATCH_MS,
  PLAN_POINTS_SHOWN,
  planFollowed,
  planRunning,
  planViewKey,
  shownPoints,
  stepStatusWords,
} from "../src/features/q/plan-card";

/**
 * Live e11 (2026-10-29): after Execute was approved the plan card showed
 * no step moving until a reload; after the reload finished steps still
 * read "Started"; Execute stayed live on the running plan; and the Q
 * header read "Board 0" beside the plan.
 */

const JOB = "11111111-1111-4111-8111-111111111111";
const BOARD_ITEM = "22222222-2222-4222-8222-222222222222";

function step(
  key: string,
  status: QPlanStep["status"],
  extra: Partial<QPlanStep> = {},
): QPlanStep {
  return {
    key,
    title: `Step ${key}`,
    status,
    jobId: null,
    boardItemId: null,
    proposalId: null,
    reminderId: null,
    ...extra,
  } as unknown as QPlanStep;
}

function view(
  status: QPlanView["status"],
  steps: readonly QPlanStep[],
  current = true,
): QPlanView {
  return {
    status,
    current,
    headVersion: 1,
    bodySha256: "a".repeat(64),
    lines: [],
    plan: { version: 1, steps } as unknown as QPlanView["plan"],
  };
}

describe("each step says where it stands", () => {
  it("in code's words, from the step's own state", () => {
    expect(stepStatusWords(step("s1", "DOING", { jobId: JOB }))).toBe(
      "Started",
    );
    expect(stepStatusWords(step("s1", "DONE"))).toBe("Done");
    expect(stepStatusWords(step("s1", "TODO"))).toBeNull();
    expect(stepStatusWords(step("s1", "WAITING_YOU"))).toBe("Your part");
    expect(
      stepStatusWords(step("s1", "WAITING_YOU", { boardItemId: BOARD_ITEM })),
    ).toBe("Your part, on your board");
    // "Ready" only with an approval card behind it.
    expect(stepStatusWords(step("s1", "PROPOSED"))).toBe(
      "Q prepares it for your approval",
    );
    expect(
      stepStatusWords(step("s1", "PROPOSED", { proposalId: BOARD_ITEM })),
    ).toBe("Ready for your approval");
  });
});

describe("Execute is not offered on a running plan", () => {
  it("running or run: no Execute", () => {
    expect(planRunning("EXECUTING")).toBe(true);
    expect(planRunning("DONE")).toBe(true);
    expect(planRunning("OFFERED")).toBe(false);
    expect(planRunning("ON_BOARD")).toBe(false);
  });
});

describe("the card follows its plan while it moves", () => {
  it("while a step of the newest version is under way", () => {
    const doing = view("EXECUTING", [step("s1", "DOING", { jobId: JOB })]);
    expect(planFollowed(doing, 0, 0)).toBe(true);
    // Done: nothing left to follow.
    expect(planFollowed(view("EXECUTING", [step("s1", "DONE")]), 0, 0)).toBe(
      false,
    );
    // An older version never polls.
    expect(
      planFollowed(view("EXECUTING", [step("s1", "DOING")], false), 0, 0),
    ).toBe(false);
  });

  it("for a bounded while after an approval, until the plan runs", () => {
    const offered = view("OFFERED", [step("s1", "TODO")]);
    const at = 1_000_000;
    expect(planFollowed(offered, 0, at)).toBe(false);
    expect(planFollowed(offered, at + PLAN_APPROVAL_WATCH_MS, at)).toBe(true);
    expect(
      planFollowed(
        offered,
        at + PLAN_APPROVAL_WATCH_MS,
        at + PLAN_APPROVAL_WATCH_MS + 1,
      ),
    ).toBe(false);
  });

  it("a step's change is a changed card", () => {
    const before = view("EXECUTING", [step("s1", "DOING")]);
    const after = view("EXECUTING", [step("s1", "DONE")]);
    expect(planViewKey(before)).not.toBe(planViewKey(after));
    expect(planViewKey(before)).toBe(
      planViewKey(view("EXECUTING", [step("s1", "DOING")])),
    );
  });
});

describe("the plan Q wrote is on the Board (live e11: 'Board 0')", () => {
  it("is kept and counted, titled by the plan", () => {
    const turns: QTurn[] = [
      {
        kind: "PERSON",
        id: "u1",
        text: "how do I improve",
        unconfirmed: false,
      },
      {
        kind: "Q",
        id: "q1",
        text: "Here is your plan.",
        at: "2026-10-29T10:09:46Z",
        streaming: false,
        sourceCount: 0,
        publicSources: [],
        findings: [],
        uncertainties: [],
        blocks: [
          {
            kind: "PLAN",
            planId: "33333333-3333-4333-8333-333333333333",
            version: 1,
            title: "Your plan: how do I improve my chances",
            reviewed: false,
          },
        ],
      } as unknown as QTurn,
    ];
    const entries = boardTimeline(turns);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Your plan: how do I improve my chances");
    expect(entries[0]?.kind).toBe("A plan Q wrote for you");
    expect(boardCountOf(entries, [], null)).toBe(1);
  });
});

/**
 * Live 2026-10-30 (plan 01f706cf, job ea7508c9): the card listed the first
 * 5 of 12 open points with no way to the rest, while the chat said "and
 * 10 more on the card".
 */
describe("every open point can be read on the card", () => {
  const twelve = Array.from(
    { length: 12 },
    (_, index) => `Step ${String(index + 1)}: Change it.`,
  );

  it("lists the first few, and all of them once opened", () => {
    expect(shownPoints(twelve, false)).toEqual(
      twelve.slice(0, PLAN_POINTS_SHOWN),
    );
    expect(shownPoints(twelve, true)).toEqual(twelve);
    expect(shownPoints(twelve.slice(0, 2), false)).toHaveLength(2);
  });

  it("the chat's '2 named and 10 more' is the card's whole list", () => {
    // planReadyLine (q-api) names 2 and counts the rest of the same list.
    const named = 2;
    expect(shownPoints(twelve, true).length - named).toBe(10);
  });
});
