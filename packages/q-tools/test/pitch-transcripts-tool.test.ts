import { describe, expect, it } from "vitest";

import {
  createReadCompanyPitchesTool,
  type PitchMomentPort,
} from "../src/index.js";
import {
  actorA,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  planFor,
} from "./support.js";

/**
 * read_company_pitches (2026-10-08): Q reads what a company's pitches say,
 * with moments, only for a company the plan admits, and only the pitches
 * the media context's playback rule lets this person play (the port).
 */

const PITCH = "00000000-0000-4000-8000-00000000f001";

function port(asked: string[]): PitchMomentPort {
  return {
    momentAround: () => Promise.resolve(null),
    forCompany: (_actor, companyId) => {
      asked.push(companyId);
      return Promise.resolve(
        companyId === COMPANY_B_NETWORK
          ? [
              {
                pitchId: PITCH,
                title: "Elevator pitch",
                status: "AVAILABLE" as const,
                cues: [
                  {
                    startMs: 43573,
                    endMs: 48613,
                    text: "served. We're raising a $4 million seed.",
                  },
                ],
                claims: [
                  {
                    kind: "RAISE",
                    statement: "We're raising a $4 million seed.",
                    atMs: 43573,
                    money: { amount: "4000000", currency: "USD" },
                    stageCode: "seed",
                    instrument: null,
                  },
                ],
              },
            ]
          : null,
      );
    },
  };
}

const planOn = (companyId: string) =>
  planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
    { kind: "COMPANY_PROFILE", companyId, sensitivity: "CONFIDENTIAL" },
  ]);

describe("read_company_pitches", () => {
  it("returns the claims and transcript with the moment each is said, as the company's own claim", async () => {
    const tool = createReadCompanyPitchesTool(port([]));
    const context = contextFor(actorA, planOn(COMPANY_B_NETWORK));
    const input = { companyId: COMPANY_B_NETWORK };
    const decision = await tool.authorize(input, context);
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    const out = (await tool.execute(input, context, decision.grant)) as {
      pitches: {
        claims: { at: string; money: unknown }[];
        segments: { at: string }[];
      }[];
      truthClass: string;
      evidenceStatus: string;
    };
    expect(out.pitches[0]?.claims[0]).toMatchObject({
      at: "0:43",
      money: { amount: "4000000", currency: "USD" },
    });
    expect(out.pitches[0]?.segments[0]?.at).toBe("0:43");
    expect(out.truthClass).toBe("USER_CLAIM");
    expect(out.evidenceStatus).toBe("SELF_REPORTED");
  });

  it("denies a company the plan does not admit, before the media context is asked", async () => {
    const asked: string[] = [];
    const tool = createReadCompanyPitchesTool(port(asked));
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK },
      contextFor(actorA, planOn(COMPANY_A)),
    );
    expect(decision.outcome).toBe("DENY");
    expect(asked).toEqual([]);
  });

  it("denies when the person may play none of the company's pitches", async () => {
    const tool = createReadCompanyPitchesTool(port([]));
    const decision = await tool.authorize(
      { companyId: COMPANY_A },
      contextFor(actorA, planOn(COMPANY_A)),
    );
    expect(decision.outcome).toBe("DENY");
  });
});
