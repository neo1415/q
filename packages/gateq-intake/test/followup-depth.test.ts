import { describe, expect, it, vi } from "vitest";

import type {
  GatewayPolicy,
  PublicGateway,
  QualificationResult,
} from "@capital-q/gateq";
import type { GateQInterviewerResult } from "@capital-q/q-core";

import type {
  ApplicationDimension,
  ApplicationFact,
  FactValue,
} from "../src/contracts/index.js";
import { missingSpecifics } from "../src/application/answer-specificity.js";
import { createGateQInterviewer } from "../src/application/interviewer.js";
import { questionNeedsFor } from "../src/application/question-needs.js";

/**
 * GateQ pushes past a vague answer for the figure an investor needs (owner,
 * 2026-10-17: "the information it gets is too basic"). The platform decides
 * what is still missing; the scripted model here only shows what it was
 * asked to do. No provider is called.
 */

const APP_A = "a0000000-0000-4000-8000-00000000000a";
const APP_B = "b0000000-0000-4000-8000-00000000000b";

const fact = (
  dimension: ApplicationDimension,
  value: FactValue,
  applicationId = APP_A,
): ApplicationFact => ({
  id: `f0000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}` as ApplicationFact["id"],
  applicationId: applicationId as ApplicationFact["applicationId"],
  dimension,
  value,
  provenance: "APPLICANT_PROVIDED",
  recordedAt: "2026-10-17T12:00:00.000Z",
  supersededAt: null,
});
const text = (t: string): FactValue => ({ kind: "TEXT", text: t });

const base = {
  policy: { criteria: [] } as unknown as GatewayPolicy,
  qualification: {
    unknowns: [],
    criteria: [],
  } as unknown as QualificationResult,
};

describe("a vague answer earns a follow-up for the specifics", () => {
  it('"we have a big market" asks next for the size and how it was sized', () => {
    const needs = questionNeedsFor({
      ...base,
      facts: [fact("company.market", text("We have a big market"))],
      askedCounts: new Map([["company.market", 1]]),
    });
    expect(needs[0]?.dimension).toBe("company.market");
    expect(needs[0]?.reason).toBe("NEEDS_SPECIFICS");
    expect(needs[0]?.missing).toMatch(/size in numbers/);
    expect(needs[0]?.missing).toMatch(/TAM, SAM, SOM/);
  });

  it("a quantified, sized answer is covered and never followed up", () => {
    const needs = questionNeedsFor({
      ...base,
      facts: [
        fact("company.market", text("$2.1B TAM, bottom-up from 40k clinics")),
      ],
      askedCounts: new Map([["company.market", 1]]),
      limit: 64,
    });
    expect(needs.map((need) => need.dimension)).not.toContain("company.market");
  });

  it("never asks a third time: a still-vague answer is parked after two asks", () => {
    const needs = questionNeedsFor({
      ...base,
      facts: [
        fact("company.market", text("We have a big market")),
        fact("company.market", text("It's really huge, honestly")),
      ],
      askedCounts: new Map([["company.market", 2]]),
      limit: 64,
    });
    expect(needs.map((need) => need.dimension)).not.toContain("company.market");
  });

  it("one specific answer covers the dimension even beside an earlier vague one", () => {
    expect(
      missingSpecifics("company.market", [
        fact("company.market", text("big")),
        fact("company.market", text("About 300 million dollars SAM")),
      ]),
    ).toBeNull();
  });

  it("revenue needs the period as well as the figure; unknown is never chased", () => {
    expect(
      missingSpecifics("claims.revenue", [
        fact("claims.revenue", text("We make 40k")),
      ]),
    ).toMatch(/period/);
    expect(
      missingSpecifics("claims.revenue", [
        fact("claims.revenue", text("40k a month")),
      ]),
    ).toBeNull();
    expect(
      missingSpecifics("claims.revenue", [
        fact("claims.revenue", text("We are pre-revenue")),
      ]),
    ).toBeNull();
    expect(
      missingSpecifics("claims.revenue", [
        fact("claims.revenue", { kind: "NONE" }),
      ]),
    ).toBeNull();
    expect(
      missingSpecifics("raise.use_of_funds", [
        fact("raise.use_of_funds", text("Growth and hiring")),
      ]),
    ).toMatch(/amounts or percentages/);
    expect(
      missingSpecifics("claims.traction", [
        fact("claims.traction", text("Fourteen paying sites")),
      ]),
    ).toBeNull();
  });
});

describe("the follow-up reaches the model, phrased per founder", () => {
  const RESULT: GateQInterviewerResult = {
    reply: "Got it. How did you size that?",
    intent: "ANSWER",
    facts: [],
    asking: "company.market",
    questionForQ: null,
    readyToReview: false,
  };
  const PUBLIC_GATEWAY: PublicGateway = {
    publicId: "gq_0123456789abcdefghjkmnpqrs",
    organisationDisplayName: "Acme Ventures",
    title: "Seed",
    description: null,
    inboundMode: "QUALIFIED",
    acceptingApplications: true,
    criteria: [],
    publishedAt: "2026-09-21T12:00:00.000Z",
  } as unknown as PublicGateway;

  const needsPrompt = async (
    applicationId: string,
    utterance: string,
  ): Promise<string> => {
    let prompt = "";
    const execute = vi.fn((request: unknown) => {
      prompt = JSON.stringify(request);
      return Promise.resolve({ output: { kind: "STRUCTURED", value: RESULT } });
    });
    const service = createGateQInterviewer({ gateway: { execute } as never });
    await service.turn({
      stage: "APPLICATION",
      channel: "text",
      publicGateway: PUBLIC_GATEWAY,
      application: {
        ...base,
        facts: [
          fact("company.market", text("We have a big market"), applicationId),
        ],
        documentProposals: [],
      },
      utterance,
      recentTurns: [],
      tangents: 0,
      askedAlready: ["company.market"],
      askedCounts: new Map([["company.market", 1]]),
      variationSeed: applicationId,
      attribution: {
        tenantId: "c0000000-0000-4000-8000-00000000000a",
        correlationId: "f0000000-0000-4000-8000-000000000001",
      },
    });
    const match = /QUESTION NEEDS \(trusted[^\\]*\\n(.*?)\\n/u.exec(prompt);
    return match?.[1] ?? "";
  };

  it("asks for the missing element without echoing the founder's words into trusted context", async () => {
    const line = await needsPrompt(APP_A, "We have a big market");
    expect(line).toContain("company.market (needs_specifics)");
    expect(line).toContain("size in numbers");
    expect(line).not.toContain("big market");
  });

  it("two applications get different suggested wording for the same follow-up", async () => {
    const a = await needsPrompt(APP_A, "We have a big market");
    const b = await needsPrompt(APP_B, "We have a big market");
    const angle = (line: string) =>
      /one way in[^"]*"([^"\\]*)/u.exec(line)?.[1];
    expect(angle(a)).toBeDefined();
    expect(angle(b)).toBeDefined();
    expect(angle(a)).not.toBe(angle(b));
    // Stable for one application: a retried turn reads the same.
    expect(await needsPrompt(APP_A, "We have a big market")).toBe(a);
  });
});
