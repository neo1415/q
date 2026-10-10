import { describe, expect, it } from "vitest";

import type { PersonSearchResult } from "@capital-q/contracts/q";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  runPersonSearch,
  type PersonAsk,
} from "../src/q/person-search-answer.js";

/**
 * W2: the identity card is built by code from the lookup tool's result:
 * no model is called, a prepared entity and a web match look the same to
 * the person, and a failure falls back to the full path (null). Fixtures
 * only; no provider is called.
 */

const ASK: PersonAsk = {
  name: "Shadi Qishta",
  entityKind: "PERSON",
  city: "Doha",
  country: "Qatar",
  organization: null,
  role: null,
  freshSearch: false,
};

const MATCHED: PersonSearchResult = {
  outcome: "MATCHED",
  candidates: [],
  clarifyingQuestion: null,
  elapsedMs: 1_900,
  card: {
    entityKind: "PERSON",
    subject: {
      externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
      entityKind: "PERSON",
      researchStatus: "RESEARCHED",
      requiresRefresh: false,
      image: {
        status: "NOT_ATTACHED",
        assetUrl: null,
        attribution: null,
        licenseNote: null,
      },
      quotes: [],
      displayName: "Shadi Qishta",
      nameVariants: ["Shadi Qishta"],
      profileUrl: "https://qa.linkedin.com/in/shadi-qishta-282453a",
      role: "Finance Director",
      organization: "Midmac Contracting Company W.L.L.",
      location: "Doha, Qatar",
      evidenceBundleId: null,
      briefVersion: 0,
      confidence: "STRONG",
    },
    sources: [
      {
        id: null,
        description: null,
        evidenceClass: null,
        url: "https://qa.linkedin.com/in/shadi-qishta-282453a",
        domain: "qa.linkedin.com",
        title: "Shadi Qishta - Finance Director | LinkedIn",
        publishedAt: null,
        retrievedAt: "2026-10-10T00:00:00Z",
        provider: "tavily",
      },
    ],
    uncertainty: ["One source so far; a second would confirm it."],
    attributionLine:
      "According to their public LinkedIn profile (search-indexed, not independently confirmed).",
    enriching: true,
    actions: ["RESEARCH_FURTHER", "REHEARSE"],
  },
};

function port(
  result: unknown,
  ok = true,
): Pick<QToolPort, "execute"> & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    execute: (proposal) => {
      asked.push(proposal.name);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "people.find",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: ok ? "SUCCEEDED" : "FAILED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: ok
          ? { ok: true, data: { result, source: "WEB" } }
          : ({ ok: false } as unknown as QToolCallOutcome["result"]),
        latencyMs: 1,
      };
      return Promise.resolve(outcome);
    },
  };
}

const context = {} as unknown as QToolExecutionContext;
const available = new Set(["find_public_entity"]);

describe("runPersonSearch", () => {
  it("builds the identity card, sources and a short spoken line from a match", async () => {
    const tools = port(MATCHED);
    const answer = await runPersonSearch({
      ask: ASK,
      tools,
      context,
      available,
    });
    expect(answer?.block?.cards[0]?.name).toBe("Shadi Qishta");
    expect(answer?.block?.cards[0]?.line).toContain("Finance Director");
    expect(answer?.block?.followUps).toEqual([
      "Research Shadi further",
      "Rehearse with Shadi",
    ]);
    // The card names the researched entity: its rehearsal and its profile.
    expect(answer?.block?.cards[0]?.external).toEqual({
      externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
      profileUrl: "https://qa.linkedin.com/in/shadi-qishta-282453a",
      rehearse: true,
    });
    expect(answer?.sources[0]?.url).toContain("shadi-qishta-282453a");
    expect(answer?.text).toContain("strong match");
    expect(tools.asked).toEqual(["find_public_entity"]);
  });

  it("shows plausible people and asks the one question when ambiguous", async () => {
    const ambiguous: PersonSearchResult = {
      outcome: "AMBIGUOUS",
      card: null,
      elapsedMs: 1,
      clarifyingQuestion:
        "I found 2 people called Ali Hassan: Banker, Doha; Doctor, Dubai. Which one?",
      candidates: [
        {
          displayName: "Ali Hassan",
          profileUrl: null,
          role: "Banker",
          organization: null,
          location: "Doha",
          confidence: "PLAUSIBLE",
        },
        {
          displayName: "Ali Hassan",
          profileUrl: null,
          role: "Doctor",
          organization: null,
          location: "Dubai",
          confidence: "PLAUSIBLE",
        },
      ],
    };
    const answer = await runPersonSearch({
      ask: { ...ASK, name: "Ali Hassan" },
      tools: port(ambiguous),
      context,
      available,
    });
    expect(answer?.block?.cards).toHaveLength(2);
    expect(answer?.text).toContain("Which one");
  });

  it("says nothing was found without describing anyone from general knowledge", async () => {
    const answer = await runPersonSearch({
      ask: ASK,
      tools: port({
        outcome: "NOT_FOUND",
        card: null,
        candidates: [],
        clarifyingQuestion: null,
        elapsedMs: 3,
      }),
      context,
      available,
    });
    expect(answer?.block).toBeNull();
    expect(answer?.text).toContain("found no one called Shadi Qishta");
  });

  it("returns null (the full path answers) when the tool is not offered or failed", async () => {
    expect(
      await runPersonSearch({
        ask: ASK,
        tools: port(MATCHED),
        context,
        available: new Set(),
      }),
    ).toBeNull();
    expect(
      await runPersonSearch({
        ask: ASK,
        tools: port(MATCHED, false),
        context,
        available,
      }),
    ).toBeNull();
  });
});
