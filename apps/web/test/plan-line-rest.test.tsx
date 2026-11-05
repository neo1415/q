// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";
import { QMessageSchema, type QMessage } from "@capital-q/contracts";

/**
 * Owner 2026-11-05, production (Q page, Chat, investor Zino Aviation): "in
 * chat, that plan stuff is constantly there no matter what". After "Wait,
 * wait" the whole plan -- every step, "Your part, on your board", "Needs
 * you: tell Q what to prepare", "Waiting for you" -- stood under the
 * person's words on every turn. Cause: the work list (QWorkProgress, which
 * Chat, the stage and the dock mount) read the conversation's newest plan
 * and drew it expanded whenever it was EXECUTING, though nothing was DOING:
 * it waited only on the person's own steps.
 */

const PLAN = "934b1576-b7c1-489d-b819-344a397f9651";

const readPlanAction = vi.fn();
vi.mock("../src/features/q/plan-actions", () => ({
  readPlanAction: (...args: unknown[]) => readPlanAction(...args) as unknown,
  decidePlanAction: vi.fn(),
}));

let sessionTurns: unknown[] = [];
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => ({
    turns: sessionTurns,
    q: {
      working: false,
      state: {
        ...createQStreamState(),
        approval: null,
        proposals: [],
        messages: [],
      },
    },
    presence: { trail: [] },
  }),
}));

const { turnsFrom } = await import("../src/features/q/conversation");
const { QWorkProgress } = await import("../src/features/q/work-progress-view");
const { forgetPlanLines } = await import("../src/features/q/plan-line-seen");

const GOAL =
  "Sharpen your investment mandate and improve your ability to attract high-quality businesses";

const message = (n: number, role: "Q" | "USER", text: string) =>
  QMessageSchema.parse({
    messageId: `750859f8-0000-4000-8000-00000000000${String(n)}`,
    runId: `529e3ae5-6504-4158-af22-5b96f443daa${String(n)}`,
    role,
    text,
    createdAt: `2026-11-05T09:0${String(n)}:00.000Z`,
  });

const planMessage: QMessage = QMessageSchema.parse({
  ...message(1, "Q", "Your plan is ready: 3 steps."),
  blocks: [
    {
      kind: "PLAN",
      planId: PLAN,
      version: 1,
      title: GOAL,
      steps: 3,
      reviewed: true,
      affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
    },
  ],
});
const running = message(2, "Q", "Running it now. Needs you first: 1 step.");
const waitWait = message(3, "USER", "Wait, wait");
const reply = message(4, "Q", "Of course. What would you like to change?");

const turnsOf = (messages: QMessage[]) =>
  turnsFrom({ ...createQStreamState(), messages }, []);

const step = (
  key: string,
  title: string,
  status: string,
  over: Record<string, unknown> = {},
) => ({ key, title, status, proposalId: null, boardItemId: null, ...over });

/** EXECUTING, nothing DOING: it waits only on the person's own steps. */
const waitingOnPerson = {
  current: true,
  status: "EXECUTING",
  plan: {
    planId: PLAN,
    goal: GOAL,
    steps: [
      step("s1", "Write down your sector focus", "DONE"),
      step("s2", "Add your cheque size to your mandate", "WAITING_YOU", {
        boardItemId: "b1",
      }),
      step("s3", "Prepare a mandate one-pager", "PROPOSED"),
    ],
  },
};
/** A step Q is doing: Q is working. */
const qWorking = {
  ...waitingOnPerson,
  plan: {
    ...waitingOnPerson.plan,
    steps: [
      step("s1", "Write down your sector focus", "DONE"),
      step("s2", "Add your cheque size to your mandate", "WAITING_YOU"),
      step("s3", "Prepare a mandate one-pager", "DOING"),
    ],
  },
};

beforeEach(() => {
  readPlanAction.mockReset();
  forgetPlanLines();
});
afterEach(cleanup);

const planLine = () => document.querySelector('[data-q-work-stream="PLAN"]');

describe("a plan waiting only on the person (owner 2026-11-05)", () => {
  it("is never drawn as a full card: one folded line, its steps on a tap", async () => {
    readPlanAction.mockResolvedValue({ ok: true, view: waitingOnPerson });
    sessionTurns = [...turnsOf([planMessage, running])];
    render(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(planLine()).not.toBeNull();
    });
    expect(screen.getByText("Waiting for you")).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "33",
    );
    // Folded: no step, no "Your part, on your board".
    expect(screen.queryByText("Your part, on your board")).toBeNull();
    expect(
      screen.queryByText("Add your cheque size to your mandate"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText("Add your cheque size to your mandate"),
    ).not.toBeNull();
    expect(screen.getByText("Your part, on your board")).not.toBeNull();
  });

  it("goes once the person has moved on ('Wait, wait')", async () => {
    readPlanAction.mockResolvedValue({ ok: true, view: waitingOnPerson });
    sessionTurns = [...turnsOf([planMessage, running])];
    const { rerender } = render(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(planLine()).not.toBeNull();
    });
    sessionTurns = [...turnsOf([planMessage, running, waitWait, reply])];
    rerender(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(planLine()).toBeNull();
    });
    expect(screen.queryByText("Waiting for you")).toBeNull();
    expect(screen.queryByText(GOAL)).toBeNull();
  });

  it("does not come back after a remount (a refresh in the same tab)", async () => {
    readPlanAction.mockResolvedValue({ ok: true, view: waitingOnPerson });
    sessionTurns = [...turnsOf([planMessage, running])];
    const first = render(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(planLine()).not.toBeNull();
    });
    first.unmount();
    sessionTurns = [...turnsOf([planMessage, running, waitWait, reply])];
    render(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(readPlanAction).toHaveBeenCalledTimes(2);
    });
    expect(planLine()).toBeNull();
  });

  it("a plan Q is working on keeps its one folded line across turns", async () => {
    readPlanAction.mockResolvedValue({ ok: true, view: qWorking });
    sessionTurns = [...turnsOf([planMessage, running])];
    const { rerender } = render(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(planLine()).not.toBeNull();
    });
    sessionTurns = [...turnsOf([planMessage, running, waitWait, reply])];
    rerender(<QWorkProgress jobs={false} />);
    await waitFor(() => {
      expect(readPlanAction).toHaveBeenCalledTimes(2);
    });
    expect(
      document.querySelectorAll('[data-q-work-stream="PLAN"]'),
    ).toHaveLength(1);
    expect(screen.getByText("Working")).not.toBeNull();
    expect(screen.queryByText("Prepare a mandate one-pager")).toBeNull();
  });
});
