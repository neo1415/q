import { describe, expect, it } from "vitest";

import {
  PLAN_REVIEW_V2,
  PLAN_REVIEW_V3,
  PLAN_WRITE_V2,
  PLAN_WRITE_V3,
  createDefaultPromptRegistry,
} from "@capital-q/q-core";

import {
  personPoint,
  planRoster,
  rosterText,
  runPlanJob,
  type PlanJobPayload,
} from "../src/composition/workforce/plan-job.js";
import {
  COMPANY,
  FOUNDER_DOSSIER,
  FOUNDER_PLAN,
  JOB,
  LEAD_RUN,
  RUN,
  TENANT,
  contextOf,
  fakeAssembler,
  fakePlanModels,
  founder,
  memoryPlanStore,
  review,
} from "./plan-fixtures.js";

/**
 * Q-page sweep 2026-10-29 (F07 "plan my raise over 8 weeks", F14 "what
 * should I do today?"): both plans stayed drafts at 85-94 against the 99
 * bar, the reviewers asking mostly for cites and owners, and the card said
 * "Step 6: Add to s6's cites".
 */

describe("writer and reviewers hold one cite rule and one owner rule (v3)", () => {
  it("v3 built on v2 (v4 now active), built on v2 with the rubric and bar unchanged", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("PLAN_WRITE").definition.version).toBe(4);
    expect(registry.getActive("PLAN_REVIEW").definition.version).toBe(4);
    expect(PLAN_WRITE_V3.output).toEqual(PLAN_WRITE_V2.output);
    expect(PLAN_REVIEW_V3.output).toEqual(PLAN_REVIEW_V2.output);
    for (const kept of ["99/100", "plan-rubric/v1", "citesFacts (0-15)"]) {
      expect(PLAN_REVIEW_V3.template).toContain(kept);
    }
    expect(PLAN_WRITE_V3.template).toContain("99/100");
  });

  it("the writer cites every fact its words state; the reviewer asks for no more than that", () => {
    expect(PLAN_WRITE_V3.template).toContain(
      "the ref of every fact the step's words state, and no other",
    );
    expect(PLAN_WRITE_V3.template).not.toContain(
      "only those this step rests on",
    );
    expect(PLAN_REVIEW_V3.template).toContain(
      "A missing cite is a fact the step's words state whose ref is not in its cites",
    );
    expect(PLAN_REVIEW_V3.template).toContain("never ask for more than 8");
  });

  it("an action the person approves is Q's to prepare, never deducted for its owner", () => {
    expect(PLAN_WRITE_V3.template).toContain(
      "Word it as Q preparing it for their approval",
    );
    expect(PLAN_REVIEW_V3.template).toContain(
      "owner Q and owner TOGETHER are both right for such a step",
    );
    // The roster says which app actions need their approval.
    const text = rosterText(planRoster("FOUNDER"));
    expect(text).toMatch(
      /APP_ACTION company\.profile\.update: .*\(needs your approval\)/u,
    );
  });
});

describe("the reviewers see what needs approval", () => {
  it("each step in THE PLAN carries needsApproval", async () => {
    const plans = memoryPlanStore();
    const { assembler } = fakeAssembler(FOUNDER_DOSSIER);
    const { models, calls } = fakePlanModels({
      writes: [FOUNDER_PLAN],
      reviews: [review(0)],
    });
    const payload: PlanJobPayload = {
      kind: "PLAN",
      ownerUserId: founder.userId,
      ask: "Plan my raise over the next 8 weeks",
      summary: "Your plan: Plan my raise over the next 8 weeks",
      subject: { side: "FOUNDER", companyId: COMPANY },
      research: "NONE",
      deliverable: "PLAN",
      mode: "NEW",
      planId: null,
      fromVersion: null,
      directionId: null,
    };
    const done = await runPlanJob(
      {
        assembler,
        toolContext: (actor) => Promise.resolve(contextOf(actor)),
        models,
        store: plans.store,
        now: () => new Date("2026-10-28T10:00:00.000Z"),
      },
      {
        actor: founder,
        owner: { tenantId: TENANT, userId: founder.userId },
        jobId: JOB,
        leadRunId: LEAD_RUN,
        runId: RUN,
        payload,
      },
    );
    // A well-grounded plan both reviewers pass is offered as reviewed.
    expect(done.status).toBe("OFFERED");
    const plan = calls.find((call) => call.task === "REVIEW")?.plan ?? "";
    const steps = (JSON.parse(plan) as { steps: { needsApproval: boolean }[] })
      .steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => typeof step.needsApproval === "boolean")).toBe(
      true,
    );
    expect(steps.some((step) => step.needsApproval)).toBe(true);
  });
});

describe("what the reviewers still want, said plainly", () => {
  it("a ref is said as its whole fact when short, a step key as its number, cites as sources", () => {
    const steps = [{ key: "s5" }, { key: "s6" }];
    const facts = new Map([
      [
        "F62",
        "Deck coaching: unit economics and the currency mix of revenue are not shown.",
      ],
    ]);
    expect(
      personPoint(
        "[s6] Its citations omit the unit economics record. Fix: Add F62 to s6's cites.",
        steps,
        facts,
      ),
    ).toBe(
      "Step 2: Add “Deck coaching: unit economics and the currency mix of revenue are not shown” to step 2's sources.",
    );
    // A ref the situation does not hold is never shown as a code.
    expect(personPoint("[s5] x Fix: Cite F99 for it.", steps, facts)).toBe(
      "Step 1: Point to the record for it.",
    );
  });
});
