import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  QArtifactIdSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import type { TurnReaderV5Result as TurnReaderV3Result } from "@capital-q/q-core";
import type { GetInvestorMandateOutput } from "@capital-q/q-tools";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import type {
  CompanyFinding,
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";
import {
  existingDocumentCard,
  namedByPerson,
  personsRecentWords,
  sameCompanyName,
} from "../src/company/document-request.js";
import type { ArtifactPreparation } from "../src/company/prepare-artifact.js";

/**
 * "Generate a PDF pitch deck for Zino Aviation from what you can find
 * publicly" is done, not described (CQ-QACT-002, acceptance D and H).
 *
 * Live, a founder asked about eight times; each answer explained what such
 * a deck would contain. The turn reader now names PREPARE_DOCUMENT, and the
 * answer seam runs the chain to the end — research → findings → deck →
 * filed artifact — replying with the result, briefly.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();
const ARTIFACT = QArtifactIdSchema.parse(
  "a1000000-0000-4000-8000-00000000000a",
);

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(subjects: QAnswerRequest["subjects"] = []): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects,
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

function message(
  role: "USER" | "Q",
  content: string,
  blocks?: readonly QResultBlock[],
): QConversationMessage {
  return {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  };
}

function finding(
  dimension: CompanyFinding["dimension"],
  statement: string,
): CompanyFinding {
  return {
    findingId: randomUUID(),
    type: "FACT",
    statement,
    truthClass: "UNKNOWN",
    evidenceStatus: "SELF_REPORTED",
    confidence: "LOW",
    subjects: [],
    evidenceRefs: [],
    dimension,
    derivation: "MODEL",
  } as unknown as CompanyFinding;
}

function publicResult(
  findings: readonly CompanyFinding[],
  sourceCount: number,
): CompanyIntelligenceResult {
  return {
    companyId: null,
    companyName: "Zino Aviation",
    canonicalDescription: null,
    specialistVersion: "company-intelligence/v1",
    asOf: new Date().toISOString(),
    blocked: null,
    findings,
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "LOW",
    synthesis: "A long explanation nobody asked for.",
    research: { status: "OK", sourceCount, comparisonCount: 0 },
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
  };
}

const DESCRIBED = [
  finding(
    "DESCRIPTION",
    "Zino Aviation describes itself as a pilot-training and aviation consultancy in Lagos.",
  ),
  finding(
    "PRODUCT",
    "Its website lists ground school, simulator classes and mentorship.",
  ),
  finding("TEAM", "Its website names Captain Zino Mario as founder and CEO."),
];

function prepareReading(
  subjectName: string | null,
  kind: TurnReaderV3Result["kind"] = "TOOL_REQUEST",
): TurnReaderV3Result {
  return {
    kind,
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: subjectName !== null,
    tool: {
      kind: "PREPARE_DOCUMENT",
      destination: null,
      visibility: null,
      documentType: "PITCH_DECK",
      subjectName,
    },
  };
}

function seam(options: {
  readonly history: readonly QConversationMessage[];
  readonly reading: TurnReaderV3Result;
  readonly result?: CompanyIntelligenceResult;
  /** The artifact service fails when asked to file the document. */
  readonly prepareFails?: boolean;
  /** The person's own mandate, as the tool would return it. */
  readonly ownMandate?: GetInvestorMandateOutput | "NOT_AN_INVESTOR" | null;
  /** The run's subjects (own context adds the founder's own company). */
  readonly subjects?: QAnswerRequest["subjects"];
}) {
  const investigated: CompanyIntelligenceRequest[] = [];
  const prepared: Record<string, unknown>[] = [];
  const stored: QConversationMessage[] = [];
  let delegated = 0;
  const turns: QTurnReader = { read: () => Promise.resolve(options.reading) };
  const artifacts: ArtifactPreparation = {
    port: {
      prepare: (input) => {
        prepared.push(input);
        if (options.prepareFails === true) {
          return Promise.reject(new Error("artifact store unavailable"));
        }
        return Promise.resolve({
          artifactId: ARTIFACT,
          type: "PITCH_DECK",
          status: "READY",
          title: input.content.title,
        } as never);
      },
      revise: () => Promise.reject(new Error("not a revision")),
      currentVersion: () => Promise.resolve(null),
    },
    reviser: {} as ArtifactPreparation["reviser"],
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: (input) => {
        investigated.push(input);
        return Promise.resolve(options.result ?? publicResult(DESCRIBED, 3));
      },
    },
    artifacts,
    ...(options.ownMandate === undefined
      ? {}
      : {
          ownMandate: {
            read: () => Promise.resolve(options.ownMandate ?? null),
          },
        }),
    delegate: {
      answer: () => {
        delegated += 1;
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve(options.history),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          stored.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return {
    run: () => answer.answer(request(options.subjects ?? [])),
    investigated,
    prepared,
    stored,
    delegated: () => delegated,
  };
}

const ASK =
  "Generate a PDF pitch deck for Zino Aviation from what you can find publicly.";

describe("a document request is done, not described (CQ-QACT-002)", () => {
  it("researches the named company, composes the deck, files it privately, and replies briefly with it", async () => {
    const s = seam({
      history: [message("USER", ASK)],
      reading: prepareReading("Zino Aviation"),
    });
    const outcome = await s.run();
    expect(outcome.kind).toBe("ANSWERED");
    // No conversational answer: the request was acted on.
    expect(s.delegated()).toBe(0);
    expect(s.investigated).toHaveLength(1);
    expect(s.investigated[0]?.company).toEqual({
      kind: "PUBLIC_COMPANY",
      name: "Zino Aviation",
    });
    expect(s.investigated[0]?.publicResearch).toBe(true);
    // Filed as a private artifact of their organisation, about no record.
    expect(s.prepared).toHaveLength(1);
    expect(s.prepared[0]?.["subject"]).toBeUndefined();
    expect(s.prepared[0]?.["artifactType"]).toBe("PITCH_DECK");
    const content = s.prepared[0]?.["content"] as {
      title: string;
      content: { deck?: { slides: { title: string }[] } };
    };
    expect(content.title).toContain("preliminary deck from public sources");
    expect(
      content.content.deck?.slides.some(
        (slide) => slide.title === "Not in public sources",
      ),
    ).toBe(true);
    // The reply is the result: short, the card, and never the synthesis.
    const reply = s.stored[0];
    expect(reply?.blocks).toEqual([
      expect.objectContaining({
        kind: "ARTIFACT_REFERENCE",
        artifactId: ARTIFACT,
        type: "PITCH_DECK",
        status: "READY",
      }),
    ]);
    expect(reply?.content.length).toBeLessThan(260);
    expect(reply?.content).not.toContain("A long explanation");
  });

  it("says it could not prepare the document, by name, when filing it fails; never answers as chat (B1)", async () => {
    const s = seam({
      history: [message("USER", ASK)],
      reading: prepareReading("Zino Aviation"),
      prepareFails: true,
    });
    const outcome = await s.run();
    expect(outcome.kind).toBe("ANSWERED");
    expect(s.delegated()).toBe(0);
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.content).toContain("deck");
    expect(s.stored[0]?.blocks ?? []).toEqual([]);
  });

  it("acts on a request read as research too, and on 'just give me the PDF' after the company was named", async () => {
    const s = seam({
      history: [
        message("USER", "tell me about Zino Aviation"),
        message("Q", "Zino Aviation trains pilots."),
        message("USER", "Just give me the PDF deck. You're talking too much."),
      ],
      reading: prepareReading("Zino Aviation", "RESEARCH_REQUEST"),
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    expect(s.prepared).toHaveLength(1);
  });

  it("hands back the deck already made instead of making a second one", async () => {
    const card: QResultBlock = {
      kind: "ARTIFACT_REFERENCE",
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Zino Aviation — preliminary deck from public sources",
    };
    const s = seam({
      history: [
        message("USER", ASK),
        message("Q", "Here's the deck for Zino Aviation.", [card]),
        message("USER", "just give me the PDF"),
      ],
      reading: prepareReading(null),
    });
    await s.run();
    expect(s.investigated).toHaveLength(0);
    expect(s.prepared).toHaveLength(0);
    expect(s.stored[0]?.blocks).toEqual([card]);
  });

  it("never researches a company the person did not name, and asks instead", async () => {
    const s = seam({
      history: [message("USER", "make me a pitch deck")],
      reading: prepareReading("Acme Rockets"),
    });
    await s.run();
    expect(s.investigated).toHaveLength(0);
    expect(s.prepared).toHaveLength(0);
    expect(s.stored[0]?.content).toMatch(/which company/i);
  });

  it("says plainly when the public sources hold nothing to build from, and files nothing", async () => {
    const s = seam({
      history: [message("USER", ASK)],
      reading: prepareReading("Zino Aviation"),
      result: publicResult([], 0),
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(s.stored[0]?.content).toMatch(/couldn't find public sources/);
    expect(s.stored[0]?.blocks).toBeUndefined();
  });
});

describe("the deterministic checks behind it", () => {
  it("counts only the person's own words", () => {
    const history = [
      message("USER", "Zino Aviation, please"),
      message("Q", "Acme Rockets is a good comparison."),
      message("USER", "just the PDF"),
    ];
    const words = personsRecentWords(history);
    expect(namedByPerson("Zino Aviation", words)).toBe(true);
    expect(namedByPerson("Acme Rockets", words)).toBe(false);
    expect(namedByPerson("", words)).toBe(false);
  });

  it("matches a record's name to the company named, either way round", () => {
    expect(sameCompanyName("Kivu Freight Ltd", "Kivu Freight")).toBe(true);
    expect(sameCompanyName("Kivu Freight", "Zino Aviation")).toBe(false);
  });

  it("finds the document already made only when it is the kind and the company asked for", () => {
    const card: QResultBlock = {
      kind: "ARTIFACT_REFERENCE",
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Zino Aviation — preliminary deck from public sources",
    };
    const history = [message("Q", "here", [card])];
    expect(
      existingDocumentCard({
        history,
        documentType: "PITCH_DECK",
        subjectName: "Zino Aviation",
      }),
    ).toEqual(card);
    expect(
      existingDocumentCard({
        history,
        documentType: "INVESTMENT_BRIEF",
        subjectName: null,
      }),
    ).toBeNull();
    expect(
      existingDocumentCard({
        history,
        documentType: "PITCH_DECK",
        subjectName: "Kivu Freight",
      }),
    ).toBeNull();
  });
});

function ownMandateReading(): TurnReaderV3Result {
  return {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: {
      kind: "PREPARE_DOCUMENT",
      destination: null,
      visibility: null,
      documentType: "OWN_MANDATE",
      subjectName: null,
    },
  };
}

function mandateRecord(status: "ACTIVE" | "DRAFT"): GetInvestorMandateOutput {
  return {
    investorOrganisationId: "a0000000-0000-4000-8000-0000000000aa",
    displayName: "Harrow Road Capital",
    investorType: "angel",
    deploymentState: "actively_investing",
    truncated: false,
    mandates: [
      {
        mandateId: "a0000000-0000-4000-8000-0000000000bb",
        status,
        version: 1,
        discoveryMode: null,
        cheque: { currency: "USD", min: "25000", max: "100000" },
        stage: { minStageCode: "seed", maxStageCode: "seed" },
        constraints: [],
        taxonomyPreferences: [],
        truthClass: "USER_CLAIM",
      },
    ],
  };
}

describe("gap 3 · a document of the person's own mandate", () => {
  it("files it from their record as their private artifact, marked a draft until confirmed, with the card", async () => {
    for (const status of ["ACTIVE", "DRAFT"] as const) {
      const s = seam({
        history: [message("USER", "Give me my mandate as a PDF.")],
        reading: ownMandateReading(),
        ownMandate: mandateRecord(status),
      });
      await s.run();
      expect(s.delegated(), status).toBe(0);
      // Built from the record: no company investigated, no research.
      expect(s.investigated, status).toHaveLength(0);
      expect(s.prepared, status).toHaveLength(1);
      expect(s.prepared[0]?.["artifactType"]).toBe("INVESTOR_MANDATE");
      expect(s.prepared[0]?.["subject"]).toBeUndefined();
      const content = s.prepared[0]?.["content"] as { title: string };
      expect(content.title.includes("(draft)"), status).toBe(
        status === "DRAFT",
      );
      expect(s.stored[0]?.blocks).toEqual([
        expect.objectContaining({ kind: "ARTIFACT_REFERENCE" }),
      ]);
      expect(s.stored[0]?.content.toLowerCase().includes("draft"), status).toBe(
        status === "DRAFT",
      );
    }
  });

  it("never asks which company, and says plainly when there is no mandate or no investor", async () => {
    for (const record of ["NOT_AN_INVESTOR", null] as const) {
      const s = seam({
        history: [message("USER", "Export my investment thesis.")],
        reading: ownMandateReading(),
        ownMandate: record,
      });
      await s.run();
      expect(s.delegated()).toBe(0);
      expect(s.prepared).toHaveLength(0);
      expect(s.stored).toHaveLength(1);
      expect(s.stored[0]?.content).not.toMatch(/which company/i);
    }
  });
});

describe('a founder\'s "PDF describing my company" ends on a real PDF card (fake provider, end to end in the seam)', () => {
  const OWN = "c0000000-0000-4000-8000-00000000000c";

  it("reads their own company from the run, composes a brief, files it, and replies with the card", async () => {
    const s = seam({
      history: [message("USER", "give me a PDF describing my company")],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: {
          kind: "PREPARE_DOCUMENT",
          destination: null,
          visibility: null,
          documentType: "INVESTMENT_BRIEF",
          subjectName: null,
        },
      },
      result: { ...publicResult(DESCRIBED, 3), companyId: OWN },
      // Own context (CQ-QX-008) binds the founder's company to the run.
      subjects: [{ kind: "COMPANY", companyId: OWN }],
    });
    const outcome = await s.run();
    expect(outcome.kind).toBe("ANSWERED");
    // Acted on, never answered as chat, and no "which company?".
    expect(s.delegated()).toBe(0);
    expect(s.investigated).toHaveLength(1);
    expect(JSON.stringify(s.investigated[0]?.company)).toContain(OWN);
    expect(s.prepared).toHaveLength(1);
    expect(s.prepared[0]?.["artifactType"]).toBe("INVESTMENT_BRIEF");
    const reply = s.stored[0];
    expect(reply?.content).not.toMatch(/which company/i);
    // The card the web renders, READY, which is what offers the PDF.
    expect(reply?.blocks).toEqual([
      expect.objectContaining({
        kind: "ARTIFACT_REFERENCE",
        artifactId: ARTIFACT,
        status: "READY",
      }),
    ]);
  });
});
