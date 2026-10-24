import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createDiligenceSummary } from "../src/composition/own-diligence.js";

/**
 * QO-15 (QA 2026-10-23): an investor's data room requests, said as their
 * CRM opens: what they asked each company for and where it stands.
 */

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
});

function listing(id: string, name: string, inDiligence = true) {
  return {
    relationship: { id },
    counterpartName: name,
    projection: {
      stateSince: "2026-10-23T08:00:00.000Z",
      milestones: inDiligence ? [{ state: "IN_DILIGENCE" }] : [],
    },
  };
}

function summary(
  listings: readonly ReturnType<typeof listing>[],
  views: Readonly<Record<string, readonly string[]>>,
) {
  return createDiligenceSummary({
    interests: {
      listRelationshipsForInvestor: () => Promise.resolve(listings),
      listRelationshipsForCompany: () => Promise.resolve([]),
    } as never,
    diligence: {
      view: ({ relationshipId }: { relationshipId: string }) =>
        Promise.resolve({
          open: true,
          side: "INVESTOR",
          shares: [],
          requests: (views[relationshipId] ?? []).map((status, i) => ({
            title: `Request ${String(i + 1)}`,
            status,
          })),
        }),
    } as never,
    ownCompanyId: () => Promise.resolve(null),
  });
}

describe("an investor's data room requests, in words (QO-15)", () => {
  it("names each company with what is open and what is answered", async () => {
    const said = await summary(
      [
        listing("r1", "Kora"),
        listing("r2", "Ledgerfold"),
        listing("r3", "Mizan", false),
      ],
      { r1: ["OPEN", "OPEN", "FULFILLED"], r2: ["FULFILLED"] },
    )(actor);
    expect(said).toBe(
      "You've asked 2 companies for documents: Kora (2 open, 1 answered) and Ledgerfold (1 answered).",
    );
  });

  it("says plainly when nothing has been asked yet", async () => {
    expect(await summary([], {})(actor)).toBe(
      "You haven't asked any company for documents yet.",
    );
  });
});
