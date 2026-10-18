import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DRAFT_INTEGRITY_RULES,
  DRAFT_RUBRIC_CRITERIA,
} from "@capital-q/q-core";

import { workforceTracker } from "../src/composition/workforce/jobs.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Recovery D4: honest states.
 *  - D-03: a near miss offered as the person's card is recorded OFFERED,
 *    linked to that card -- never also HELD (which offered "Send as is"
 *    beside the pending card, so one message could go twice).
 *  - D-11: a standing instruction's or delegation's job never shows
 *    "Working" forever: its lead run ends at once, and a firing ends the
 *    job DONE (or HELD while something waits on the person).
 */

const OWNER = { tenantId: randomUUID(), userId: randomUUID() };

/** 72 out of 100: under the bar of 75, within the near-miss margin. */
const NEAR = {
  criteria: DRAFT_RUBRIC_CRITERIA.map((criterion) => ({
    criterion,
    score: criterion === "ASK_TIMING" || criterion === "ANSWERS_THEM" ? 3 : 4,
    note: "",
  })),
  integrity: DRAFT_INTEGRITY_RULES.map((rule) => ({
    rule,
    ok: true,
    note: "",
  })),
  feedback: "Answer their question first.",
};

function nearMissReview() {
  const store = createInMemoryWorkforceStore();
  const review = createOutwardReview({
    store,
    models: {
      review: () => Promise.resolve(NEAR),
      redraft: (_who, _trace, variables) =>
        Promise.resolve(`${variables.draft} Thank you.`),
    },
  });
  return { store, review };
}

const draft = {
  principalName: "Ada",
  counterpartName: "Zino",
  channel: "CHAT" as const,
  stage: "REPLY" as const,
  purpose: "Reply to Zino",
  material: "",
  thread: "Zino: How do regulated firms evaluate it?",
  body: "Hi Zino, thanks for asking.",
};
const source = {
  kind: "INSTRUCTION" as const,
  id: randomUUID(),
  goal: "Reply to investors",
};

describe("D-03: a near miss is OFFERED with its card, never HELD twice", () => {
  it("records no HELD outcome when the near miss is handed back, and OFFERED with the card once carded", async () => {
    const { store, review } = nearMissReview();
    const verdict = await review.review(OWNER, source, draft, {
      nearMiss: true,
    });
    expect(verdict).toMatchObject({ verdict: "HELD", nearMiss: true });
    expect(store.rows.outcomes).toEqual([]);

    const card = randomUUID();
    // Never "sent" for a near miss, whatever a caller says.
    await review.settle(OWNER, verdict, "SENT");
    expect(store.rows.outcomes).toEqual([]);
    await review.settle(OWNER, verdict, "OFFERED", card);
    expect(
      store.rows.outcomes.map((one) => [one.outcome, one.q_action_id]),
    ).toEqual([["OFFERED", card]]);
  });

  it("records HELD, with its reason, when no card could be made", async () => {
    const { store, review } = nearMissReview();
    const verdict = await review.review(OWNER, source, draft, {
      nearMiss: true,
    });
    expect(verdict).toMatchObject({ nearMiss: true });
    expect(store.rows.outcomes).toEqual([]);
    await review.settle(OWNER, verdict, "HELD");
    expect(store.rows.outcomes.map((one) => one.outcome)).toEqual(["HELD"]);
  });

  it("a draft below the bar that was not asked to be a near miss is still recorded HELD at review", async () => {
    const { store, review } = nearMissReview();
    await review.review(OWNER, source, draft);
    expect(store.rows.outcomes.map((one) => one.outcome)).toEqual(["HELD"]);
  });
});

describe("D-11: no endless Working", () => {
  it("ends the lead run at once and the job at the end of a firing", async () => {
    const store = createInMemoryWorkforceStore();
    const track = workforceTracker(store, "INSTRUCTION");
    const instruction = { id: randomUUID(), goal: "Answer investors" };
    await track(OWNER, instruction, "START");
    expect(store.rows.jobs[0]?.status).toBe("RUNNING");
    expect(store.rows.runs.filter((run) => run.status === "RUNNING")).toEqual(
      [],
    );
    await track(OWNER, instruction, "END", true);
    expect(store.rows.jobs[0]?.status).toBe("HELD");
    await track(OWNER, instruction, "START");
    await track(OWNER, instruction, "END", false);
    expect(store.rows.jobs[0]?.status).toBe("DONE");
  });

  it("a delegated job's lead is not 'Working' after it starts", async () => {
    const store = createInMemoryWorkforceStore();
    await workforceTracker(store, "DELEGATED_WORK")(OWNER, {
      id: randomUUID(),
      goal: "Outreach to fintech founders",
    });
    expect(store.rows.runs.map((run) => [run.role, run.status])).toEqual([
      ["LEAD", "DONE"],
    ]);
  });
});
