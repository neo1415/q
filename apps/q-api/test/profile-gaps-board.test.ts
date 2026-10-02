import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createProfileGapsBoard,
  PROFILE_GAPS_FILL,
  ProfileGapsPayloadSchema,
} from "../src/composition/profile-gaps-action.js";
import type { ProfileAnswersPort } from "../src/composition/profile-answer-action.js";

/**
 * HARDEN P0 (live 2026-10-02 on 25942649, Nixo): only "legal name and
 * founding date" were in play, while the profile showed "Sector: Not
 * added" and the setup's team facts open. The setup answers public
 * research can fill now join the company fields on ONE card.
 */

const ACTOR = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const SESSION = "e0000000-0000-4000-8000-000000000001";
const COMPANY = "f0000000-0000-4000-8000-000000000001";
const RUN = "a0000000-0000-4000-8000-000000000001";

const answers = (completed: boolean): ProfileAnswersPort => ({
  completedSession: () =>
    Promise.resolve(completed ? { sessionId: SESSION, version: 3 } : null),
  revise: () => Promise.resolve({ sessionVersion: 4 }),
});

const board = (completed = true) =>
  createProfileGapsBoard({
    answers: () => answers(completed),
    responses: () =>
      Promise.resolve([
        // Given: team size. Empty: categories (nothing chosen).
        { stepKey: "F4.team_size", value: { type: "RANGE", value: "3" } },
        {
          stepKey: "F1.categories",
          value: {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: [],
          },
        },
      ]),
  });

describe("the profile gaps board", () => {
  it("names the setup answers that are open: never given, or holding nothing", async () => {
    expect(await board().openAnswers(ACTOR)).toEqual([
      "categories",
      "founder_count",
      "functions",
    ]);
    // No completed setup: answers are not in play.
    expect(await board(false).openAnswers(ACTOR)).toBe(null);
  });

  it("puts company fields and answers on ONE card, with the sources; misfits are left out and named", async () => {
    const gaps = board();
    const result = await gaps.prepare({
      runId: RUN,
      actor: ACTOR,
      companyId: COMPANY,
      companyChanges: [
        { field: "foundedDate", value: "2025-01-01" },
        { field: "headquartersCity", value: "San Francisco" },
        // Not a two-letter code: left out, named.
        { field: "headquartersCountry", value: "United States of America" },
      ],
      answers: [
        // A name Capital Q doesn't know is dropped; the known ones stay.
        { field: "categories", value: "B2B, Fintech, Martian Mining" },
        { field: "founder_count", value: "2" },
      ],
      sources: ["ycombinator.com"],
    });
    expect(result.status).toBe("PREPARED");
    expect(result.dropped.map((d) => d.field)).toEqual(["headquartersCountry"]);
    const proposal = await gaps.proposer.propose({
      runId: RUN,
      actor: ACTOR,
    } as never);
    if (proposal === null || proposal === undefined || "refused" in proposal) {
      throw new Error("expected a proposal");
    }
    expect(proposal.actionType).toBe(PROFILE_GAPS_FILL);
    const payload = ProfileGapsPayloadSchema.parse(proposal.payload);
    expect(payload.changes).toEqual({
      foundedDate: "2025-01-01",
      headquartersCity: "San Francisco",
    });
    expect(payload.sessionId).toBe(SESSION);
    expect(payload.answers.map((a) => a.stepKey)).toEqual([
      "F1.categories",
      "F4.founder_count",
    ]);
    expect(payload.answers[0]?.preview).toMatch(/Fintech/);
    expect(payload.answers[0]?.preview).not.toMatch(/Martian/);
    expect(payload.sources).toEqual(["ycombinator.com"]);
    // One card per run.
    expect(
      await gaps.proposer.propose({ runId: RUN, actor: ACTOR } as never),
    ).toBe(null);
  });

  it("without a finished setup, answers are left out and named; the company fields still go", async () => {
    const gaps = board(false);
    const result = await gaps.prepare({
      runId: RUN,
      actor: ACTOR,
      companyId: COMPANY,
      companyChanges: [{ field: "foundedDate", value: "2025-01-01" }],
      answers: [{ field: "team_size", value: "4" }],
      sources: [],
    });
    expect(result.status).toBe("PREPARED");
    expect(result.dropped).toEqual([
      { field: "team_size", reason: "your setup isn't finished" },
    ]);
  });
});
