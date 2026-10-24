import { describe, expect, it } from "vitest";

import type { OwnOnboardingSummary } from "@capital-q/onboarding";
import { ActorContextSchema } from "@capital-q/security";

import { createFounderStatedReader } from "../src/composition/founder-stated.js";

/**
 * QA QO-38: what a founder told Q in setup, for readiness and call prep,
 * from their OWN session for THIS company only.
 */
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const COMPANY = "d0000000-0000-4000-8000-000000000001";

const journey = (subjectId: string | null): OwnOnboardingSummary =>
  ({
    journeyType: "founder",
    subjectId,
    values: {
      "F6.target_amount": { type: "RANGE", value: "1500000" },
      "F6.currency": { type: "SINGLE_SELECT", optionKey: "usd" },
      "F6.instrument": { type: "SINGLE_SELECT", optionKey: "safe" },
      "F5.customers": { type: "RANGE", value: "320" },
    },
  }) as unknown as OwnOnboardingSummary;

describe("a founder's stated facts, for the readers that called them absent", () => {
  it("reads their own session for this company: the raise and customers, marked as theirs", async () => {
    const read = createFounderStatedReader({
      summaries: { read: () => Promise.resolve([journey(COMPANY)]) },
    });
    const stated = await read(actor, COMPANY);
    expect(stated?.raise).toMatchObject({
      target: "1500000 USD",
      instrument: true,
    });
    expect(stated?.claims).toEqual([
      expect.objectContaining({
        claimKey: "traction.customer_count",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        stated: true,
      }),
    ]);
    expect(stated?.lines).toEqual([
      "Raise: 1500000 USD (SAFE)",
      "Paying customers: 320",
    ]);
  });

  it("never reads a session bound to another company, or none", async () => {
    const other = createFounderStatedReader({
      summaries: {
        read: () =>
          Promise.resolve([
            journey("e0000000-0000-4000-8000-000000000001"),
            journey(null),
          ]),
      },
    });
    expect(await other(actor, COMPANY)).toBeNull();
  });
});
