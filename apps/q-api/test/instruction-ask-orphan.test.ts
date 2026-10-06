import { describe, expect, it } from "vitest";

import { createInstructionAsk } from "../src/composition/instructions/ask.js";

/**
 * Autopilot P1 (live 2026-10-06, runs 6164992b, 5a3c6ac4, e4566fda): an
 * ASK step whose card already waited on the person opened a new run, the
 * proposal returned the existing card, and the new run sat in SYNTHESIS
 * until the orphan sweep failed it as RUN_EXPIRED. Nothing waits on such a
 * run, so it is completed at once.
 */
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function harness(proposal: {
  readonly existing?: boolean;
  readonly alreadyDone?: string;
  readonly throws?: boolean;
}) {
  const lifecycle: string[] = [];
  const ask = createInstructionAsk({
    runtime: {
      createRun: () =>
        Promise.resolve({
          created: true,
          run: {
            id: RUN_ID,
            tenantId: "33333333-3333-4333-8333-333333333333",
            actorUserId: "44444444-4444-4444-8444-444444444444",
          },
          conversation: { id: CONVERSATION_ID },
        }),
    } as never,
    orchestration: {
      begin: () => {
        lifecycle.push("begin");
        return Promise.resolve({ kind: "ADVANCED" } as never);
      },
      advanceThrough: () => {
        lifecycle.push("advance");
        return Promise.resolve({ kind: "ADVANCED" } as never);
      },
      complete: () => {
        lifecycle.push("complete");
        return Promise.resolve({ kind: "ADVANCED" } as never);
      },
      fail: (_ref: unknown, code: string) => {
        lifecycle.push(`fail:${code}`);
        return Promise.resolve({ kind: "ADVANCED" } as never);
      },
    },
    actions: {
      propose: () =>
        proposal.throws === true
          ? Promise.reject(new Error("refused"))
          : Promise.resolve({
              action: { id: "action-1" },
              ...(proposal.existing === undefined
                ? {}
                : { existing: proposal.existing }),
              ...(proposal.alreadyDone === undefined
                ? {}
                : { alreadyDone: proposal.alreadyDone }),
            } as never),
    },
    store: {
      own: () =>
        Promise.resolve({
          id: "i-1",
          goal_text: "Express interest in companies that fit",
          conversation_id: CONVERSATION_ID,
        } as never),
      setConversation: () => Promise.resolve(),
    },
  });
  const card = {
    instructionId: "i-1",
    actionType: "app.chat.message.send",
    payload: {},
    words: "Introduce Maji Loop",
    key: "k-1",
  };
  return { ask: () => ask({} as never, card), lifecycle };
}

describe("standing-instruction ASK step: no run is left for the orphan sweep", () => {
  it("completes the run when the same card already waits on the person", async () => {
    const { ask, lifecycle } = harness({ existing: true });
    expect(await ask()).toEqual({ qActionId: "action-1" });
    expect(lifecycle).toEqual(["begin", "advance", "complete"]);
  });

  it("completes the run when the change is already done", async () => {
    const { ask, lifecycle } = harness({ alreadyDone: "Already sent." });
    await ask();
    expect(lifecycle).toEqual(["begin", "advance", "complete"]);
  });

  it("leaves a run waiting on its own new card alone", async () => {
    const { ask, lifecycle } = harness({});
    await ask();
    expect(lifecycle).toEqual(["begin", "advance"]);
  });

  it("ends the run when the proposal is refused", async () => {
    const { ask, lifecycle } = harness({ throws: true });
    await expect(ask()).rejects.toThrow("refused");
    expect(lifecycle).toEqual(["begin", "advance", "fail:INTERNAL_ERROR"]);
  });
});
