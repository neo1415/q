import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createWorkforceJobBoard,
  mandateWithin,
} from "../src/composition/workforce/job-actions.js";
import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import type { PlanVariables } from "../src/composition/workforce/models.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Live case A (2026-10-29): "how it affects my fintech thesis" was planned
 * with the thesis prerequisite UNKNOWN -- the lead never read the mandate.
 * The lead's situation now carries their declared mandate (read as them);
 * unreadable or slow, it is UNKNOWN, never absent. Fake planner, no model.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

const THESIS =
  "Thesis note: back infrastructure that owns a recurring business workflow.";

function board(mandate: () => Promise<readonly string[] | null>) {
  const store = createInMemoryWorkforceStore();
  const seen: PlanVariables[] = [];
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Ada Investor"),
    mandateMatches: () => Promise.resolve([]),
    expressInterest: () => Promise.resolve({ ok: false }),
    openConversations: () => Promise.resolve([]),
    writeReply: () => Promise.resolve(null),
    send: () => Promise.resolve(false),
    freeSlots: () => Promise.resolve([]),
    book: () => Promise.resolve({ ok: false, meetingId: null }),
    notify: () => Promise.resolve(),
  };
  const jobsFor = () =>
    createWorkforceJobs({
      store,
      models: {
        plan: (_who, _trace, variables) => {
          seen.push(variables);
          return Promise.resolve(null);
        },
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports,
    });
  return {
    seen,
    board: createWorkforceJobBoard({ jobsFor, budgetUsd: 5, mandate }),
  };
}

describe("the lead's plan reads their declared mandate", () => {
  it("shows the mandate and thesis to the lead as MANDATE facts", async () => {
    const { seen, board: made } = board(() =>
      Promise.resolve([
        "Mandate: seed to Series A, Nigeria, B2B payments.",
        THESIS,
      ]),
    );
    await made.port.prepare(
      actor,
      randomUUID(),
      "Investigate the Nigerian B2B payments sector and how it affects my fintech thesis",
    );
    expect(seen[0]?.situation).toContain(`[MANDATE] ${THESIS}`);
  });

  it("an unreadable mandate is shown as not known", async () => {
    const { seen, board: made } = board(() =>
      Promise.reject(new Error("down")),
    );
    await made.port.prepare(actor, randomUUID(), "How does this fit my thesis");
    expect(seen[0]?.situation).toContain(
      "[UNKNOWN] Your declared mandate and thesis: not known right now.",
    );
  });

  it("a slow read is given up on, as not known", async () => {
    const never = new Promise<readonly string[] | null>(() => undefined);
    await expect(mandateWithin(never, 5)).resolves.toBeNull();
    await expect(
      mandateWithin(Promise.resolve([THESIS]), 1_000),
    ).resolves.toEqual([THESIS]);
  });
});
