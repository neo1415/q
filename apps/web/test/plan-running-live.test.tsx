// @vitest-environment jsdom
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";
import { QMessageSchema, type QMessage } from "@capital-q/contracts";

/**
 * Acceptance 2026-11-04 J4: the plan ran ("Running it now: my steps have
 * started") but its steps were on neither the Q stage's work list nor
 * /work's Moving ("Nothing running"). Two causes: the stage mounts the
 * work list with jobs={false}, and the plan was read only with jobs; and a
 * plan read while still OFFERED was never read again, because a typed
 * "okay" approves it through the server (no approval event in this tab).
 */

const PLAN = "934b1576-b7c1-489d-b819-344a397f9651";
const RUN = "529e3ae5-6504-4158-af22-5b96f443daa2";

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
const { useRunningPlan } = await import("../src/features/q/running-plan");
const { QWorkProgress } = await import("../src/features/q/work-progress-view");

const planMessage: QMessage = QMessageSchema.parse({
  messageId: "750859f8-0000-4000-8000-000000000003",
  runId: RUN,
  role: "Q",
  text: "Your plan is ready: 2 steps.",
  createdAt: "2026-11-04T17:55:19.882Z",
  blocks: [
    {
      kind: "PLAN",
      planId: PLAN,
      version: 1,
      title: "Follow up this week with three companies",
      steps: 2,
      reviewed: false,
      affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
    },
  ],
});
const running: QMessage = QMessageSchema.parse({
  messageId: "750859f8-0000-4000-8000-000000000004",
  runId: "529e3ae5-6504-4158-af22-5b96f443daa3",
  role: "Q",
  text: "Running it now: my steps have started.",
  createdAt: "2026-11-04T17:57:00.000Z",
});

const turnsOf = (messages: QMessage[]) =>
  turnsFrom({ ...createQStreamState(), messages }, []);

const view = (status: string) => ({
  current: true,
  status,
  plan: {
    planId: PLAN,
    goal: "Follow up this week with three companies",
    steps: [
      {
        key: "s1",
        title: "Prepare a reply to Clinicrest",
        status: status === "EXECUTING" ? "DOING" : "PLANNED",
        proposalId: null,
        boardItemId: null,
      },
      {
        key: "s2",
        title: "Schedule the Maji Loop meeting",
        status: "PLANNED",
        proposalId: null,
        boardItemId: null,
      },
    ],
  },
});

beforeEach(() => {
  readPlanAction.mockReset();
});

describe("a running plan shows live (J4)", () => {
  it("is read again when Q's next turn lands after a typed 'okay'", async () => {
    readPlanAction.mockResolvedValueOnce({ ok: true, view: view("OFFERED") });
    readPlanAction.mockResolvedValue({ ok: true, view: view("EXECUTING") });
    const { result, rerender } = renderHook(
      ({ turns }) => useRunningPlan(turns),
      { initialProps: { turns: turnsOf([planMessage]) } },
    );
    await waitFor(() => {
      expect(result.current?.status).toBe("OFFERED");
    });
    rerender({ turns: turnsOf([planMessage, running]) });
    await waitFor(() => {
      expect(result.current?.status).toBe("EXECUTING");
    });
  });

  it("the stage's work list (jobs={false}) lists the plan's steps", async () => {
    readPlanAction.mockResolvedValue({ ok: true, view: view("EXECUTING") });
    sessionTurns = [...turnsOf([planMessage, running])];
    render(<QWorkProgress jobs={false} />);
    // Owner 2026-11-05: the plan is one folded line; its steps on a tap.
    fireEvent.click(
      await screen.findByRole("button", { name: /Follow up this week/u }),
    );
    expect(
      await screen.findByText("Prepare a reply to Clinicrest"),
    ).not.toBeNull();
    expect(screen.getByText("Schedule the Maji Loop meeting")).not.toBeNull();
  });
});
