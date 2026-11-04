import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { proposedLine } from "@capital-q/q-actions";
import {
  decidePending,
  offeredPlanChoice,
  PLAN_OFFER_QUESTION,
  PLAN_OFFER_RUN,
  PLAN_OFFER_SUMMARY,
  PLAN_OFFER_WHOLE,
  PLAN_OFFER_WITHOUT_CARD,
  PLAN_READ_CLOSE,
  readPlanChoice,
  type PendingDecisionPort,
} from "@capital-q/q-specialists";
import { readApprovalWords } from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import {
  createWorkforceDelivery,
  planOfferText,
} from "../src/composition/workforce/delivery.js";
import { PLAN_WAYS_ON } from "../src/composition/workforce/plan-job.js";
import { planReadText } from "../src/composition/workforce/plans.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";
import { FOUNDER_PLAN } from "./plan-fixtures.js";

/**
 * Owner 2026-11-04: "when the plan finishes there's nothing to trigger Q
 * to talk to me ... it should offer a summary, or to read the whole thing,
 * or to just go ahead and execute the whole thing and give updates." The
 * plan-ready message closes on that offer with its three choices; the
 * summary and the whole plan are read back by code from the stored
 * version; "go ahead" approves the waiting execute card of that version.
 */

const TENANT = randomUUID();
const USER = randomUUID();
const RUN = randomUUID();
const CONVERSATION = randomUUID();
const PLAN_ID = randomUUID();

function planRow(): WorkRow {
  return {
    job_id: randomUUID(),
    tenant_id: TENANT,
    user_id: USER,
    state: "COMPLETED",
    plan: {},
    trace: { runId: RUN },
    results: {
      plan: {
        status: "DONE",
        summary: "The plan is ready",
        outputs: {
          plan: {
            block: {
              kind: "PLAN",
              planId: PLAN_ID,
              version: 1,
              title: "Raise a seed round",
              steps: 3,
              reviewed: true,
              affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
            },
            line: `Your plan is ready: 3 steps.\n\n${PLAN_WAYS_ON}`,
          },
        },
      },
    },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: new Date(),
    updated_at: new Date(),
    finished_at: new Date(),
  };
}

function delivery(offer: boolean, prepares = true) {
  const events: string[] = [];
  const posted: { content: string; blocks: unknown }[] = [];
  const deliver = createWorkforceDelivery({
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    runtime: {
      runs: {
        findForActor: () =>
          Promise.resolve({
            id: RUN,
            tenantId: TENANT,
            conversationId: CONVERSATION,
          }),
        allocateEventSequence: () => Promise.resolve(2),
      },
      runEvents: { append: () => Promise.resolve({}) },
      messages: {
        insert: (
          _tx: unknown,
          input: { content: string; blocks?: unknown },
        ) => {
          events.push("posted");
          posted.push({ content: input.content, blocks: input.blocks });
          return Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            conversationId: CONVERSATION,
            runId: RUN,
            role: "Q",
            content: input.content,
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          });
        },
      },
    } as never,
    notify: () => Promise.resolve(),
    ...(offer
      ? {
          offerPlan: (_owner, _row, plan) => {
            events.push(`offer:${plan.planId}:${String(plan.version)}`);
            return Promise.resolve(prepares);
          },
        }
      : {}),
  });
  return { deliver, posted, events };
}

describe("the plan-ready message offers the three ways on", () => {
  it("closes on the offer, with the choices under it, then prepares that version's card", async () => {
    const d = delivery(true);
    expect(await d.deliver({ tenantId: TENANT, userId: USER }, planRow())).toBe(
      true,
    );
    const [message] = d.posted;
    expect(message?.content).toContain(PLAN_OFFER_QUESTION);
    expect(message?.content).not.toContain(PLAN_WAYS_ON);
    expect(message?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "PLAN", planId: PLAN_ID }),
        {
          kind: "CLARIFICATION_REQUEST",
          question: "What would you like to do with your plan?",
          options: [PLAN_OFFER_SUMMARY, PLAN_OFFER_WHOLE, PLAN_OFFER_RUN],
        },
      ]),
    );
    // The quiet card is prepared first, so the offer says "go ahead" only
    // when a card really waits for it.
    expect(d.events).toEqual([`offer:${PLAN_ID}:1`, "posted"]);
  });

  it("without the execute card composed, the plan lands as before", async () => {
    const d = delivery(false);
    await d.deliver({ tenantId: TENANT, userId: USER }, planRow());
    expect(d.posted[0]?.content).toContain(PLAN_WAYS_ON);
    expect(JSON.stringify(d.posted[0]?.blocks)).not.toContain(
      "CLARIFICATION_REQUEST",
    );
  });

  it("plan lands: exactly one control runs it (Execute); one line, no second prompt", async () => {
    const d = delivery(true);
    await d.deliver({ tenantId: TENANT, userId: USER }, planRow());
    // One message: the plan card (its Execute) and the choices; no card
    // of the execute action's own, no "Here is your plan to approve".
    expect(d.posted).toHaveLength(1);
    const blocks = JSON.stringify(d.posted[0]?.blocks);
    expect(blocks).not.toContain("ACTION_PROPOSAL");
    expect(d.posted[0]?.content).not.toMatch(/Here is your plan to approve/u);
  });

  it("no card could be prepared: the offer never says 'go ahead'; Execute runs it", async () => {
    const d = delivery(true, false);
    await d.deliver({ tenantId: TENANT, userId: USER }, planRow());
    const [message] = d.posted;
    expect(message?.content).toContain(PLAN_OFFER_WITHOUT_CARD);
    expect(message?.content).not.toMatch(/go ahead/iu);
    expect(message?.blocks).toEqual(
      expect.arrayContaining([
        {
          kind: "CLARIFICATION_REQUEST",
          question: "What would you like to do with your plan?",
          options: [PLAN_OFFER_SUMMARY, PLAN_OFFER_WHOLE],
        },
      ]),
    );
  });

  it("an answer without the usual ending still gets the offer", () => {
    expect(planOfferText("Your plan is ready.")).toBe(
      `Your plan is ready.\n\n${PLAN_OFFER_QUESTION} You can also put it on your board, or tell me what to change.`,
    );
  });
});

const offerMessage = {
  id: "m-offer",
  role: "Q",
  content: planOfferText(`Your plan is ready.\n\n${PLAN_WAYS_ON}`),
  blocks: [{ kind: "PLAN", planId: PLAN_ID, version: 1 }],
};
const cardLine = {
  id: "m-card",
  role: "Q",
  content: proposedLine("Run your plan: Raise a seed round"),
  blocks: [{ kind: "ACTION_PROPOSAL" }],
};
const said = (content: string, id = "m-latest") => ({
  id,
  role: "USER",
  content,
});

describe("the choices are read by code", () => {
  it("a tap or the same words: summary or the whole plan, of that version", () => {
    for (const [words, part] of [
      [PLAN_OFFER_SUMMARY, "SUMMARY"],
      ["just the summary please", "SUMMARY"],
      [PLAN_OFFER_WHOLE, "WHOLE"],
      ["read me all of it", "WHOLE"],
    ] as const) {
      const latest = said(words);
      expect(
        offeredPlanChoice([offerMessage, cardLine, latest], latest),
      ).toEqual({ planId: PLAN_ID, version: 1, part });
    }
  });

  it("run it, a change or anything else is not a reading", () => {
    for (const words of [
      PLAN_OFFER_RUN,
      "okay",
      "no, change step two",
      "what's my runway?",
    ]) {
      expect(readPlanChoice(words)).toBeNull();
    }
  });

  it("only straight after Q's own offer (or a plan read back)", () => {
    const latest = said(PLAN_OFFER_SUMMARY);
    expect(offeredPlanChoice([cardLine, latest], latest)).toBeNull();
    const later = [
      offerMessage,
      said("what's my runway?", "m-1"),
      { id: "m-a", role: "Q", content: "About nine months.", blocks: [] },
      latest,
    ];
    expect(offeredPlanChoice(later, latest)).toBeNull();
    const afterRead = [
      offerMessage,
      said(PLAN_OFFER_SUMMARY, "m-2"),
      { id: "m-r", role: "Q", content: `Summary.\n\n${PLAN_READ_CLOSE}` },
      said(PLAN_OFFER_WHOLE),
    ];
    const whole = afterRead[3];
    if (whole === undefined) throw new Error("no turn");
    expect(offeredPlanChoice(afterRead, whole)?.part).toBe("WHOLE");
  });

  it("'Go ahead and run it' is approval in plain words of the waiting card", () => {
    const words = readApprovalWords(PLAN_OFFER_RUN, {
      summaries: ["Run your plan: Raise a seed round"],
    });
    expect(words).toMatchObject({ kind: "APPROVE", strength: "EXPLICIT" });
  });
});

/** The founder example as stored: code decides needsApproval per step. */
const READ_PLAN = {
  ...FOUNDER_PLAN,
  steps: FOUNDER_PLAN.steps.map((step) => ({
    ...step,
    needsApproval: step.owner !== "YOU",
  })),
};

describe("the plan read back is the stored plan's own words", () => {
  it("summary: goal, counts and the first three; whole: every step", () => {
    const summary = planReadText(READ_PLAN, "SUMMARY");
    expect(summary).toContain(`${String(FOUNDER_PLAN.steps.length)} steps`);
    for (const step of FOUNDER_PLAN.steps.slice(0, 3)) {
      expect(summary).toContain(step.title.replace(/[.\s]+$/u, ""));
    }
    expect(summary.endsWith(PLAN_READ_CLOSE)).toBe(true);
    const whole = planReadText(READ_PLAN, "WHOLE");
    for (const step of FOUNDER_PLAN.steps) {
      expect(whole).toContain(step.title.replace(/[.\s]+$/u, ""));
    }
    expect(whole).not.toMatch(/\bF\d+\b/u);
  });
});

describe("'okay' after the offer runs exactly the waiting card", () => {
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    organisationId: randomUUID(),
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });
  const context = {
    actor,
    runId: randomUUID(),
    correlationId: `cor_${randomUUID()}`,
    tenantId: TENANT,
    userId: USER,
  };
  it("after a plan read back, 'okay' approves the one execute card", async () => {
    const approved: string[] = [];
    const proposalId = randomUUID();
    const port: PendingDecisionPort = {
      proposals: () =>
        Promise.resolve([
          {
            proposalId,
            summary: "Run your plan: Raise a seed round",
            status: "PENDING" as const,
          },
        ]),
      read: () => Promise.resolve(null),
      approve: (_context, id) => {
        approved.push(id);
        return Promise.resolve({ status: "SAVED" as const });
      },
      decline: () => Promise.resolve({ status: "DECLINED" as const }),
    };
    await decidePending(port, {
      context,
      utterance: "okay",
      recentTurns: [{ role: "Q", text: `Your plan: …\n\n${PLAN_READ_CLOSE}` }],
    });
    expect(approved).toEqual([proposalId]);
  });
});
