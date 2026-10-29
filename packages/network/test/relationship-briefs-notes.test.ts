import { describe, expect, it } from "vitest";

import { createRelationshipBriefs } from "../src/application/relationship-brief.js";

/**
 * Live 2026-10-29 (J7-I): the list's briefs read no interests, so the
 * history said the interest came "with no note" over Aster's real note.
 */
const RELATIONSHIP = "94eb9286-666a-4145-92d5-9e6f3beef321";
const INTEREST = "40c21ea8-4455-4b35-9e2d-e4be817599e6";
const NOTE =
  "The company's seed-stage, Nigeria-based payments focus aligns with my mandate.";
const AT = "2026-10-28T17:21:38.752Z";

describe("the list's briefs carry each interest's note", () => {
  it("reads the interests their histories name, as the single brief does", async () => {
    const read: string[] = [];
    const briefs = createRelationshipBriefs({
      sql: {},
      interests: {
        findById: (_sql: unknown, id: string) => {
          read.push(id);
          return Promise.resolve(
            id === INTEREST
              ? {
                  id,
                  relationshipId: RELATIONSHIP,
                  note: NOTE,
                  expressedByParty: "INVESTOR",
                }
              : null,
          );
        },
      },
    } as never);
    const listing = {
      relationship: {
        id: RELATIONSHIP,
        companyId: "31633da0-87f9-4c5f-bd9a-a892a9251207",
        investorOrganisationId: "22fcad29-d9de-4d1b-9ca5-b6e34fae9a8c",
      },
      projection: {
        state: "CONNECTED",
        stateSince: AT,
        milestones: [],
        version: "relationship-state.v2",
      },
      nextStep: "SCHEDULE_MEETING",
      counterpartName: "LedgerBridge",
      visibleHistory: [
        {
          sequence: 2,
          eventType: "interest_expressed",
          occurredAt: AT,
          visibilityScope: "relationship_shared",
          payload: { interestId: INTEREST },
        },
      ],
    };
    const [brief] = await briefs({
      actor: { userId: "u", tenantId: "t", actorType: "HUMAN" } as never,
      sources: {},
      listings: () => Promise.resolve([listing as never]),
      now: new Date(AT),
    });
    expect(read).toEqual([INTEREST]);
    expect(brief?.history?.[0]).toMatchObject({
      kind: "INTEREST_EXPRESSED",
      by: "YOUR_SIDE",
      note: NOTE,
    });
  });
});
