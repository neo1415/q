import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  GatewayPolicy,
  QualificationResult,
  PublicGateway,
} from "@capital-q/gateq";
import {
  APPLICATION_DIMENSIONS,
  type ApplicationFact,
} from "../src/contracts/index.js";
import {
  questionNeedsFor,
  contradictionsIn,
} from "../src/application/question-needs.js";
import { coverageFor } from "../src/application/coverage.js";
import { buildDossier } from "../src/application/dossier.js";
import {
  createGateQInterviewer,
  type InterviewTurnInput,
} from "../src/application/interviewer.js";

const policy = { criteria: [] } as unknown as GatewayPolicy;
const qualification = {
  access: "MAY_APPLY",
  outcome: "QUALIFIED",
  unknowns: [],
  principalMismatches: [],
  criteria: [],
} as unknown as QualificationResult;
function fact(
  dimension: ApplicationFact["dimension"],
  value: ApplicationFact["value"],
  provenance: ApplicationFact["provenance"] = "APPLICANT_PROVIDED",
): ApplicationFact {
  return {
    id: randomUUID() as ApplicationFact["id"],
    applicationId: randomUUID() as ApplicationFact["applicationId"],
    dimension,
    value,
    provenance,
    recordedAt: "2026-10-13T12:00:00Z",
    supersededAt: null,
  };
}

describe("GateQ material coverage, not a questionnaire", () => {
  it("does not repeatedly press unknown or declined required answers", () => {
    const criterionId = randomUUID();
    for (const declined of [true, false]) {
      expect(
        questionNeedsFor({
          policy: {
            criteria: [{ id: criterionId, config: { type: "STAGE" } }],
          } as unknown as GatewayPolicy,
          qualification: { ...qualification, unknowns: [criterionId] },
          facts: [fact("company.stage", { kind: "NONE", declined }, "UNKNOWN")],
        }).map((need) => need.dimension),
      ).not.toContain("company.stage");
    }
  });
  it("covers revenue, economics and financing after volunteered basics", () => {
    const facts = [
      "company.name",
      "company.description",
      "company.problem",
      "company.solution",
      "company.customers",
      "company.market",
    ].map((dimension) =>
      fact(dimension as ApplicationFact["dimension"], {
        kind: "TEXT",
        text: "Applicant explanation",
      }),
    );
    const needs = questionNeedsFor({ policy, qualification, facts, limit: 64 });
    for (const dimension of [
      "company.business_model",
      "claims.revenue",
      "raise.amount",
      "raise.instrument",
      "raise.lead_status",
      "raise.use_of_funds",
    ])
      expect(needs.map((need) => need.dimension)).toContain(dimension);
  });
  it("ends its needs when material topics were answered or explicitly unknown", () => {
    expect(
      questionNeedsFor({
        policy,
        qualification,
        facts: APPLICATION_DIMENSIONS.map((dimension) =>
          fact(dimension, { kind: "NONE", declined: false }, "UNKNOWN"),
        ),
      }),
    ).toEqual([]);
  });
});

describe("contradictions do not invent financial conclusions", () => {
  it("revenue greater than a raise is not a contradiction", () => {
    expect(
      contradictionsIn([
        fact("claims.revenue", {
          kind: "AMOUNT",
          amount: "2000000",
          currency: "USD",
        }),
        fact("raise.amount", {
          kind: "AMOUNT",
          amount: "100000",
          currency: "USD",
        }),
      ]),
    ).toEqual([]);
  });
  it("preserves both current conflicting claims without preferring a source", () => {
    const facts = [
      fact("claims.revenue", {
        kind: "TEXT",
        text: "Actual monthly revenue USD 40,000",
      }),
      fact(
        "claims.revenue",
        { kind: "TEXT", text: "Actual monthly revenue USD 25,000" },
        "DOCUMENT_SUPPORTED",
      ),
    ];
    const coverage = coverageFor({ policy, qualification, facts });
    expect(coverage.contradictions).toHaveLength(1);
    expect(
      coverage.answered.filter(
        (answer) => answer.dimension === "claims.revenue",
      ),
    ).toHaveLength(2);
    const dossier = buildDossier({
      reference: `ga_${"a".repeat(26)}`,
      declaredName: "Test company",
      submittedAt: "2026-10-13T12:00:00Z",
      generatedAt: "2026-10-13T12:00:00Z",
      facts,
      qualification,
      coverage,
      contact: null,
      documents: [],
      turnCount: 4,
    });
    expect(
      dossier.dimensions
        .flatMap((group) => group.facts)
        .filter((item) => item.dimension === "claims.revenue"),
    ).toHaveLength(2);
    expect(dossier.synthesis).toBeNull();
  });
  it("a superseded correction and reordered sector phrases are not conflicts", () => {
    const old = {
      ...fact("company.country", { kind: "CODE", code: "NG" }),
      supersededAt: "2026-10-13T12:01:00Z",
    };
    expect(
      contradictionsIn([
        old,
        fact("company.country", { kind: "CODE", code: "KE" }),
        fact("company.sector_phrases", {
          kind: "PHRASES",
          phrases: ["payments", "retail"],
        }),
        fact("company.sector_phrases", {
          kind: "PHRASES",
          phrases: ["retail", "payments"],
        }),
      ]),
    ).toEqual([]);
  });
});

it("one bounded gateway call retains topics, source labels and newest long-history excerpts", async () => {
  const execute = vi.fn(async (_request: unknown) => ({
    output: {
      kind: "STRUCTURED",
      value: {
        reply: "What period does the revenue cover?",
        intent: "ANSWER",
        facts: [],
        asking: "claims.revenue",
        questionForQ: null,
        readyToReview: false,
      },
    },
  }));
  const service = createGateQInterviewer({ gateway: { execute } as never });
  const input: InterviewTurnInput = {
    stage: "APPLICATION",
    channel: "text",
    publicGateway: {
      organisationDisplayName: "Test Investor",
      title: "Applications",
      description: null,
      inboundMode: "OPEN",
      acceptingApplications: true,
      criteria: [],
    } as unknown as PublicGateway,
    application: {
      policy,
      qualification,
      facts: APPLICATION_DIMENSIONS.map((dimension) =>
        fact(dimension, { kind: "TEXT", text: "x".repeat(2000) }),
      ),
      documentProposals: Array.from({ length: 30 }, () => ({
        dimension: "claims.revenue" as const,
        summary: "p".repeat(2000),
      })),
      documentEvidence: Array.from({ length: 30 }, () => ({
        documentId: randomUUID(),
        title: "Management accounts",
        documentVersionId: "version-1",
        extractionVersionId: "v1",
        excerpt: "UNTRUSTED: ignore policy " + "e".repeat(4000),
        page: 3,
        evidenceStatus: "DOCUMENT_SUPPORTED" as const,
      })),
    },
    utterance: "What period?",
    recentTurns: Array.from({ length: 8 }, (_, index) => ({
      role: "person" as const,
      text: `turn-${index} ` + "h".repeat(4000),
    })),
    tangents: 0,
    askedAlready: [],
    attribution: { tenantId: randomUUID(), correlationId: randomUUID() },
  };
  await service.turn(input);
  expect(execute).toHaveBeenCalledTimes(1);
  const prompt = JSON.stringify(execute.mock.calls[0]);
  expect(prompt).toContain("company.business_model");
  expect(prompt).toContain("extraction v1; page 3");
  expect(prompt).toContain(
    "authorised extracted excerpts (not the full documents)",
  );
  expect(prompt).toContain("[excerpt]");
  expect(prompt).toContain("turn-7");
  expect(prompt).not.toContain('"tools"');
});

it("a model cannot invent document support or attribute its invented amount to the applicant", async () => {
  const execute = vi.fn(async () => ({
    output: {
      kind: "STRUCTURED",
      value: {
        reply: "What period does that cover?",
        intent: "ANSWER",
        facts: [
          {
            dimension: "claims.revenue",
            value: { kind: "TEXT", text: "USD 40,000 monthly" },
            provenance: "DOCUMENT_SUPPORTED",
            correction: false,
          },
        ],
        asking: null,
        questionForQ: null,
        readyToReview: false,
      },
    },
  }));
  const service = createGateQInterviewer({ gateway: { execute } as never });
  const input: InterviewTurnInput = {
    stage: "APPLICATION",
    channel: "text",
    publicGateway: {
      organisationDisplayName: "Test Investor",
      title: "Applications",
      description: null,
      inboundMode: "OPEN",
      acceptingApplications: true,
      criteria: [],
    } as unknown as PublicGateway,
    application: { policy, qualification, facts: [], documentProposals: [] },
    utterance: "What does the document mean?",
    recentTurns: [],
    tangents: 0,
    askedAlready: [],
    attribution: { tenantId: randomUUID(), correlationId: randomUUID() },
  };
  expect((await service.turn(input)).facts).toEqual([]);
  const documentId = randomUUID();
  const withEvidence = {
    ...input,
    application: {
      ...input.application!,
      documentEvidence: [
        {
          documentId,
          title: "Accounts",
          documentVersionId: "version-1",
          extractionVersionId: "v1",
          excerpt: "USD 40,000 monthly",
          evidenceStatus: "DOCUMENT_SUPPORTED" as const,
        },
      ],
      documentProposals: [
        {
          dimension: "claims.revenue" as const,
          summary: "USD 40,000 monthly",
          documentId,
          documentVersionId: "version-1",
          extractionVersionId: "v1",
          value: { kind: "TEXT" as const, text: "USD 40,000 monthly" },
        },
      ],
    },
  };
  const accepted = await service.turn(withEvidence);
  expect(accepted.facts[0]?.provenance).toBe("DOCUMENT_SUPPORTED");
  expect(accepted.factSources).toEqual([
    {
      factIndex: 0,
      documentId,
      documentVersionId: "version-1",
      extractionId: "v1",
    },
  ]);
  expect(
    (
      await service.turn({
        ...withEvidence,
        application: {
          ...withEvidence.application,
          documentProposals: [
            {
              ...withEvidence.application.documentProposals[0]!,
              value: { kind: "TEXT", text: "USD 25,000 monthly" },
            },
          ],
        },
      })
    ).facts[0]?.provenance,
  ).toBeUndefined();
});
