import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  QArtifactIdSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QArtifactContent,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type { TurnReaderV8Result as TurnReaderV3Result } from "@capital-q/q-core";
import type { GetInvestorMandateOutput } from "@capital-q/q-tools";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { composeAnswerDocument, workTitle } from "../src/answer-document.js";
import {
  answerSteps,
  asksWhatIsOnBoard,
  boardItemsMeant,
  boardItemFromWords,
  mentionsOwnBoard,
  nameInAsk,
  withoutBoardSave,
  boardReadOut,
  createSpecialistQAnswer,
  type BoardKeeper,
} from "../src/answer.js";
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
import type { OwnRecordNames } from "../src/company/own-names.js";
import type { ArtifactPreparation } from "../src/company/prepare-artifact.js";
import {
  createToolTeamJobPort,
  ownWorkSummary,
  teamJobBlocks,
  teamJobLine,
  teamJobOutcomeOf,
  type QTeamJobPort,
  type TeamJobOutcome,
} from "../src/team-job.js";

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
      unknownScreen: null,
      visibility: null,
      documentType: "PITCH_DECK",
      subjectName,
    },
  };
}

function seam(options: {
  readonly history: readonly QConversationMessage[];
  readonly reading: QTurnReading;
  readonly result?: CompanyIntelligenceResult;
  /** The names on the person's own records (failure 6). */
  readonly ownRecords?: OwnRecordNames;
  /** The artifact service fails when asked to file the document. */
  readonly prepareFails?: boolean;
  /** The person's own mandate, as the tool would return it. */
  readonly ownMandate?: GetInvestorMandateOutput | "NOT_AN_INVESTOR" | null;
  /** The run's subjects (own context adds the founder's own company). */
  readonly subjects?: QAnswerRequest["subjects"];
  /** Sees each request handed to the conversational answer. */
  readonly onDelegate?: (request: QAnswerRequest) => void;
  /** The person's own work board (reader v61 boardAsk). */
  readonly board?: BoardKeeper;
  /** Q's team, for deep work. */
  readonly teamJob?: QTeamJobPort;
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
    ...(options.board === undefined ? {} : { board: options.board }),
    ...(options.teamJob === undefined ? {} : { teamJob: options.teamJob }),
    ...(options.ownRecords === undefined
      ? {}
      : {
          ownRecords: {
            read: () => Promise.resolve(options.ownRecords as OwnRecordNames),
          },
        }),
    ...(options.ownMandate === undefined
      ? {}
      : {
          ownMandate: {
            read: () => Promise.resolve(options.ownMandate ?? null),
          },
        }),
    delegate: {
      answer: (delegatedRequest) => {
        options.onDelegate?.(delegatedRequest);
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

const PLAN_SENTENCE =
  "Your Launch plan includes 30 pieces of work Q does for you a month and you've used 30. It resets on 1 November. See Plans in Settings.";
const BOARD_JOB = "4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

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
      unknownScreen: null,
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
          unknownScreen: null,
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

describe("founder live 2026-09-27 · own company binds; misheard names resolve; several documents in one turn", () => {
  const OWN = "c0000000-0000-4000-8000-00000000000c";
  const RECORDS: OwnRecordNames = {
    company: { companyId: OWN, names: ["Zino Aviation", "ZINO AVIATION LTD"] },
    firm: { names: ["Harbour Angels"] },
    person: { names: ["Adaeze Okafor"] },
  };
  const ownResult = { ...publicResult(DESCRIBED, 3), companyId: OWN };

  function deck(subjectName: string | null) {
    return {
      kind: "PREPARE_DOCUMENT" as const,
      destination: null,
      unknownScreen: null,
      visibility: null,
      documentType: "PITCH_DECK" as const,
      subjectName,
    };
  }

  it("makes the deck about their own company whatever name the reader heard for it, typed or spoken, never asking which", async () => {
    // What the reader may hand over for "my company": nothing, the
    // recorded name the person never said, a misheard form they did say,
    // or their own name ("a deck for me").
    const cases: readonly { said: string; heard: string | null }[] = [
      { said: "make a pitch deck for my company", heard: null },
      { said: "a deck on the business I run, please", heard: "Zino Aviation" },
      { said: "pitch deck for Zener Aviation", heard: "Zener Aviation" },
      { said: "deck for Xeno Aviation, my company", heard: "Xeno Aviation" },
      { said: "everything about me, as a deck", heard: "Adaeze Okafor" },
    ];
    for (const { said, heard } of cases) {
      const s = seam({
        history: [message("USER", said)],
        reading: prepareReading(heard),
        result: ownResult,
        subjects: [{ kind: "COMPANY", companyId: OWN }],
        ownRecords: RECORDS,
      });
      await s.run();
      expect(s.stored[0]?.content, said).not.toMatch(/which company/i);
      // Their record, never a public search for the misheard form.
      expect(s.investigated, said).toHaveLength(1);
      expect(s.investigated[0]?.company, said).toEqual({
        kind: "COMPANY",
        companyId: OWN,
      });
      expect(s.prepared, said).toHaveLength(1);
      expect(s.stored[0]?.content, said).toContain("Zino Aviation");
    }
  });

  it("keeps a different company different: a name near none of their records is researched as said", async () => {
    for (const other of ["Acme Rockets", "Delta Aviation", "Kino Aviation"]) {
      const s = seam({
        history: [message("USER", `make a pitch deck for ${other}`)],
        reading: prepareReading(other),
        result: ownResult,
        subjects: [{ kind: "COMPANY", companyId: OWN }],
        ownRecords: RECORDS,
      });
      await s.run();
      const publicSearch = s.investigated.find(
        (request) => request.company.kind === "PUBLIC_COMPANY",
      );
      expect(publicSearch?.company, other).toEqual({
        kind: "PUBLIC_COMPANY",
        name: other,
      });
    }
  });

  it("still asks when the reader names a company that is neither said nor theirs", async () => {
    const s = seam({
      history: [message("USER", "make me a pitch deck")],
      reading: prepareReading("Acme Rockets"),
      ownRecords: RECORDS,
    });
    await s.run();
    expect(s.investigated).toHaveLength(0);
    expect(s.stored[0]?.content).toMatch(/which company/i);
  });

  it("researches a misheard name as recorded when it is their own firm, not their company", async () => {
    const s = seam({
      history: [message("USER", "a pitch deck on Harbor Angles")],
      reading: prepareReading("Harbor Angles"),
      ownRecords: { ...RECORDS, company: null },
    });
    await s.run();
    expect(s.investigated[0]?.company).toEqual({
      kind: "PUBLIC_COMPANY",
      name: "Harbour Angels",
    });
    expect(s.investigated[0]?.question).toContain("Harbour Angels");
  });

  it("makes every document asked for in one turn, each with its card, in one message", async () => {
    const s = seam({
      history: [
        message(
          "USER",
          "a PDF of my mandate and a PPTX pitch deck for my company",
        ),
      ],
      reading: {
        ...ownMandateReading(),
        moreDocuments: [deck(null), deck(null)],
      },
      ownMandate: mandateRecord("ACTIVE"),
      result: ownResult,
      subjects: [{ kind: "COMPANY", companyId: OWN }],
      ownRecords: RECORDS,
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    // The mandate and one deck: the same document asked twice is made once.
    expect(s.prepared.map((input) => input["artifactType"])).toEqual([
      "INVESTOR_MANDATE",
      "PITCH_DECK",
    ]);
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.blocks).toHaveLength(2);
    expect(s.stored[0]?.content).not.toMatch(/which company/i);
  });
});

function answerDocumentReading(
  documentType: "ANSWER_EXPORT" | "Q_REPORT",
  moreDocuments: QTurnReading["moreDocuments"] = [],
): QTurnReading {
  return {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: {
      kind: "PREPARE_DOCUMENT",
      destination: null,
      unknownScreen: null,
      visibility: null,
      documentType,
      subjectName: null,
    },
    moreDocuments,
  };
}

const WRITTEN = [
  "# How you come across",
  "",
  "## Strengths",
  "- **Clear** problem statement, see [the deck](https://example.test/deck).",
  "- Traction is `specific`.",
  "",
  "## Gaps",
  "| Area | State |",
  "| --- | --- |",
  "| Revenue | not stated |",
].join("\n");

describe("founder live 2026-09-28 #1 · any answer as a PDF", () => {
  it("files the answer already given exactly as written, with no model call, and replies with the card", async () => {
    const s = seam({
      history: [
        message("USER", "How do I come across to investors?"),
        message("Q", WRITTEN),
        message("USER", "Put that in a PDF."),
      ],
      reading: answerDocumentReading("ANSWER_EXPORT"),
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    expect(s.investigated).toHaveLength(0);
    expect(s.prepared).toHaveLength(1);
    expect(s.prepared[0]?.["artifactType"]).toBe("Q_REPORT");
    const filed = s.prepared[0]?.["content"] as {
      title: string;
      content: { sections: { heading: string; body: string }[] };
    };
    expect(filed.title).toBe("How you come across");
    expect(filed.content.sections.map((x) => x.heading)).toEqual([
      "Strengths",
      "Gaps",
    ]);
    expect(filed.content.sections[0]?.body).toBe(
      "• Clear problem statement, see the deck (https://example.test/deck).\n• Traction is specific.",
    );
    expect(filed.content.sections[1]?.body).toBe(
      "Area · State\nRevenue · not stated",
    );
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.content).toMatch(/PDF/);
    expect(s.stored[0]?.blocks).toEqual([
      expect.objectContaining({ kind: "ARTIFACT_REFERENCE" }),
    ]);
  });

  it("says there is nothing to export yet when Q has not answered, and files nothing", async () => {
    const s = seam({
      history: [message("USER", "Give me your last answer as a PDF.")],
      reading: answerDocumentReading("ANSWER_EXPORT"),
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.content).not.toMatch(/can't (create|make) a pdf/i);
  });

  it("writes a new piece as the answer, told it is a document, then files that answer with its card", async () => {
    const seen: QAnswerRequest[] = [];
    const answered = message("Q", WRITTEN);
    const s = seam({
      history: [
        message(
          "USER",
          "Make me a PDF of an assessment of how I come across to investors.",
        ),
        { ...answered, id: "m" as QConversationMessage["id"] },
      ],
      reading: answerDocumentReading("Q_REPORT"),
      onDelegate: (r) => seen.push(r),
    });
    await s.run();
    expect(s.delegated()).toBe(1);
    expect(seen[0]?.writingDocument).toBe(true);
    expect(s.prepared).toHaveLength(1);
    expect(s.prepared[0]?.["artifactType"]).toBe("Q_REPORT");
    const filed = s.prepared[0]?.["content"] as { summary: string };
    expect(filed.summary).toContain("how I come across");
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.blocks).toEqual([
      expect.objectContaining({ kind: "ARTIFACT_REFERENCE" }),
    ]);
  });

  it("makes another document asked in the same message after the written one, in the same follow-up", async () => {
    const s = seam({
      history: [
        message("USER", "An assessment of me as a PDF, and my mandate too."),
        { ...message("Q", WRITTEN), id: "m" as QConversationMessage["id"] },
      ],
      reading: answerDocumentReading("Q_REPORT", [
        {
          kind: "PREPARE_DOCUMENT",
          destination: null,
          unknownScreen: null,
          visibility: null,
          documentType: "OWN_MANDATE",
          subjectName: null,
        },
      ]),
      ownMandate: mandateRecord("ACTIVE"),
    });
    await s.run();
    expect(s.delegated()).toBe(1);
    expect(s.prepared.map((p) => p["artifactType"])).toEqual([
      "Q_REPORT",
      "INVESTOR_MANDATE",
    ]);
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.blocks).toHaveLength(2);
  });
});

describe("an answer as a document, deterministically", () => {
  it("keeps the words, drops the markup, and splits at the answer's own headings", () => {
    const document = composeAnswerDocument({
      answer: "Short answer with *emphasis* and a rule.\n\n---\n\nDone.",
      question: "  what   now? ",
    });
    // F-73: never "Q's answer: <the ask>"; the ask in a few words.
    expect(document?.title).toBe("What now");
    expect(document?.content.sections).toEqual([
      {
        heading: "Answer",
        body: "Short answer with emphasis and a rule.\n\nDone.",
        findings: [],
      },
    ]);
    expect(document?.summary).toMatch(/not verified fact/);
  });

  it("is nothing when the answer holds no words", () => {
    expect(composeAnswerDocument({ answer: "  \n# \n" })).toBeNull();
    expect(composeAnswerDocument({ answer: "# Title only" })).toBeNull();
  });
});

/**
 * XLSX-002 (live 2026-10-28): "put that side-by-side thing you showed me
 * earlier into a file I can send to the committee" made a PDF that said
 * "The full comparison is on screen". An answer that showed a table is
 * filed as a spreadsheet first and a PDF holding the same table beside it.
 */
const SIDE_BY_SIDE: QResultBlock = {
  kind: "TABLE",
  title: "Side by side",
  columns: [
    { label: "MedTrail", subject: null },
    { label: "Mizan", subject: null },
  ],
  rows: [
    { label: "Stage", cells: ["Seed", "Seed"] },
    { label: "Raise", cells: ["$1.5 million", ""] },
  ],
};
const COMPARED =
  "MedTrail and Mizan are level on fit, at 9 each. The full comparison is on screen.";

describe("XLSX-002 · a tabular answer as a file", () => {
  it("files the table as a spreadsheet first and a PDF with the same table beside it", async () => {
    const s = seam({
      history: [
        message("USER", "compare MedTrail and Mizan for my mandate"),
        message("Q", COMPARED, [SIDE_BY_SIDE]),
        message(
          "USER",
          "put that side-by-side thing you showed me earlier into a file I can send to the committee",
        ),
      ],
      reading: answerDocumentReading("ANSWER_EXPORT"),
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    // The PDF is prepared first (it holds the table), then the sheet; the
    // reply leads with the spreadsheet's card.
    expect(s.prepared.map((p) => p["artifactType"]).sort()).toEqual([
      "Q_REPORT",
      "SPREADSHEET",
    ]);
    const sheet = s.prepared.find((p) => p["artifactType"] === "SPREADSHEET")?.[
      "content"
    ] as { content: QArtifactContent };
    expect(sheet.content.workbook?.sheets[0]?.rows).toEqual([
      ["Stage", "Seed", "Seed"],
      ["Raise", "$1.5 million", null],
    ]);
    const pdf = s.prepared.find((p) => p["artifactType"] === "Q_REPORT")?.[
      "content"
    ] as { content: QArtifactContent };
    expect(pdf.content.sections[0]).toMatchObject({
      heading: "Side by side",
      body: "Stage — MedTrail: Seed; Mizan: Seed\nRaise — MedTrail: $1.5 million; Mizan: not known",
    });
    // Nothing in the document points at a screen.
    const words = pdf.content.sections.map((x) => x.body).join("\n");
    expect(words).not.toMatch(/on screen/i);
    expect(words).toContain("level on fit");
    expect(s.stored).toHaveLength(1);
    expect(s.stored[0]?.blocks).toHaveLength(2);
    expect(s.stored[0]?.content).toMatch(/Excel spreadsheet/);
    expect(s.stored[0]?.content).toMatch(/PDF with the same table/);
  });

  it("an answer that showed no table is still the PDF alone", async () => {
    const s = seam({
      history: [
        message("USER", "How do I come across to investors?"),
        message("Q", WRITTEN),
        message("USER", "put that in a file"),
      ],
      reading: answerDocumentReading("ANSWER_EXPORT"),
    });
    await s.run();
    expect(s.prepared.map((p) => p["artifactType"])).toEqual(["Q_REPORT"]);
  });

  it("a PDF of a comparison writes the table in, row by row, unknown as not known", () => {
    const document = composeAnswerDocument({
      answer: COMPARED,
      table: SIDE_BY_SIDE,
    });
    expect(document?.content.sections.map((x) => x.heading)).toEqual([
      "Side by side",
      "Answer",
    ]);
    expect(document?.content.sections[1]?.body).toBe(
      "MedTrail and Mizan are level on fit, at 9 each.",
    );
  });
});

/**
 * The work board (owner 2026-10-23, reader v61 boardAsk): "save that plan
 * to my board" files Q's last answer exactly as written and keeps it on
 * their own board; "break it into tasks" adds the steps that answer itself
 * lists, in its words, and never invents one. No model call, no card.
 */
describe("board asks about Q's last answer", () => {
  function boardKeeper() {
    const added: {
      kind: string;
      title: string;
      refId?: string;
      key: string;
    }[] = [];
    const board: BoardKeeper = {
      list: () =>
        Promise.resolve({
          items: added.map((one) => ({
            title: one.title,
            status: "TODO" as const,
          })),
        }),
      add: (_actor, request, options) => {
        added.push({ ...request, key: options.idempotencyKey });
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    return { board, added };
  }
  const boardReading = (
    boardAsk: "SAVE" | "BREAKDOWN",
    namedOther: QTurnReading["namedOther"] = null,
  ): QTurnReading => ({
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: namedOther !== null,
    tool: null,
    boardAsk,
    namedOther,
  });
  const PLAN = [
    "# Your 12-month plan",
    "",
    "1. **Hire** a head of sales by March.",
    "2. Close the bridge round.",
    "- Launch in Kenya.",
  ].join("\n");

  it("SAVE: files the answer and keeps it on their board as a document, with no model call", async () => {
    const { board, added } = boardKeeper();
    const s = seam({
      history: [
        message("USER", "Give me a 12-month plan."),
        message("Q", PLAN),
        message("USER", "Save that plan to my board."),
      ],
      reading: boardReading("SAVE"),
      board,
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    expect(s.prepared).toHaveLength(1);
    expect(added).toEqual([
      expect.objectContaining({
        kind: "DOCUMENT",
        refId: ARTIFACT,
        title: "Your 12-month plan",
      }),
    ]);
    expect(added[0]?.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5/u);
    expect(s.stored[0]?.content).toMatch(/on your board, in To do/u);
    expect(s.stored[0]?.blocks).toEqual([
      expect.objectContaining({ kind: "ARTIFACT_REFERENCE" }),
    ]);
  });

  it("BREAKDOWN: adds the steps the answer lists, in its words, after the document", async () => {
    const { board, added } = boardKeeper();
    const s = seam({
      history: [
        message("USER", "Give me a 12-month plan."),
        message("Q", PLAN),
        message("USER", "Save it and break it into tasks."),
      ],
      reading: boardReading("BREAKDOWN"),
      board,
    });
    await s.run();
    expect(added.map((one) => [one.kind, one.title])).toEqual([
      ["DOCUMENT", "Your 12-month plan"],
      ["TASK", "Hire a head of sales by March."],
      ["TASK", "Close the bridge round."],
      ["TASK", "Launch in Kenya."],
    ]);
    expect(s.stored[0]?.content).toMatch(/its steps as 3 tasks in To do/u);
  });

  it("BREAKDOWN of an answer with no list of steps adds no tasks and says so", async () => {
    const { board, added } = boardKeeper();
    const s = seam({
      history: [
        message("USER", "How do I come across?"),
        message(
          "Q",
          "You come across as focused and early. Lead with the traction.",
        ),
        message("USER", "Break it into tasks on my board."),
      ],
      reading: boardReading("BREAKDOWN"),
      board,
    });
    await s.run();
    expect(added.map((one) => one.kind)).toEqual(["DOCUMENT"]);
    expect(s.stored[0]?.content).toMatch(/rather than make up tasks/u);
  });

  it("leaves a board ask about someone named (keep Kestrel on my board) to the board tool", async () => {
    const { board, added } = boardKeeper();
    const s = seam({
      history: [message("USER", "Keep Kestrel Capital on my board.")],
      reading: boardReading("SAVE", {
        name: "Kestrel Capital",
        kind: "COMPANY",
      }),
      board,
    });
    await s.run();
    expect(added).toEqual([]);
    expect(s.prepared).toHaveLength(0);
  });
});

describe("board asks about Q's last answer, continued", () => {
  it("SAVE after Q made a document keeps that document, without filing another", async () => {
    const added: { kind: string; refId?: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const made = "11111111-2222-4333-8444-555555555555";
    const s = seam({
      history: [
        message("USER", "Make me a one-page growth plan."),
        {
          ...message("Q", "Here's your one-page growth plan."),
          blocks: [
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId: QArtifactIdSchema.parse(made),
              type: "Q_REPORT",
              status: "READY",
              title: "Growth plan",
            },
          ],
        },
        message("USER", "Save that to my board."),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([
      expect.objectContaining({
        kind: "DOCUMENT",
        refId: made,
        title: "Growth plan",
      }),
    ]);
  });

  it("an item they dictate ('add \"Prep IC memo\" to my board') is a to-do with that title, not Q's last answer (F-72)", async () => {
    const added: unknown[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const s = seam({
      history: [
        message("USER", "Give me a plan."),
        message("Q", "1. Hire.\n2. Raise."),
        message("USER", "Add “Prep IC memo” to my board."),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(added).toEqual([{ kind: "TASK", title: "Prep IC memo" }]);
    expect(s.prepared).toHaveLength(0);
  });
});

describe("boardReadOut", () => {
  it("reads the board by column, says how many, and says when it is empty", () => {
    expect(
      boardReadOut([
        { title: "Growth plan", status: "TODO" },
        { title: "Hire a head of sales", status: "DOING" },
        { title: "Close the bridge", status: "TODO" },
      ]),
    ).toBe(
      "Here's your board.\n\n**To do** (2): Growth plan; Close the bridge.\n\n**Doing** (1): Hire a head of sales.",
    );
    expect(boardReadOut([])).toMatch(/^Your board is empty/u);
  });
});

describe("answerSteps", () => {
  it("takes numbered and bulleted lines only, without markers or emphasis, at most twelve", () => {
    expect(answerSteps("Intro\n1) **One** thing\n* two\n\nnot a step")).toEqual(
      ["One thing", "two"],
    );
    expect(
      answerSteps(
        Array.from({ length: 20 }, (_v, i) => `- step ${String(i)}`).join("\n"),
      ),
    ).toHaveLength(12);
  });
});

/**
 * F-72 (QA 2026-10-24): "Add 'Prep data room for seed round' to my board"
 * filed Q's previous answer as a document. A new item in their words is a
 * to-do with that title, by code; "the top company" is the one the list
 * Q just showed put first.
 */
describe("a new item they dictate goes on the board as a to-do", () => {
  const ANCHOR_FIRST = {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Fit against your mandate",
    followUps: [],
    cards: [{ name: "Anchor" }, { name: "Kliniqa" }],
  } as unknown as QResultBlock;
  const reading = (): QTurnReading => ({
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    boardAsk: "SAVE",
    namedOther: null,
  });
  function keeper() {
    const added: { kind: string; title: string; refId?: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    return { board, added };
  }

  it("adds the title in their words, files nothing, and resolves 'the top company' from the list", async () => {
    const { board, added } = keeper();
    const s = seam({
      history: [
        message("USER", "Which companies fit my mandate best?"),
        {
          ...message("Q", "Anchor leads, then Kliniqa."),
          blocks: [ANCHOR_FIRST],
        },
        message("USER", "Add 'Prep IC memo for the top company' to my board."),
      ],
      reading: reading(),
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([{ kind: "TASK", title: "Prep IC memo for Anchor" }]);
    expect(s.stored[0]?.content).toBe(
      "I've added “Prep IC memo for Anchor” to your board, in To do.",
    );
  });

  it("reads the title from quotes, or from between 'add' and 'to my board'", () => {
    expect(
      boardItemFromWords("Add 'Prep data room for seed round' to my board"),
    ).toBe("Prep data room for seed round");
    expect(
      boardItemFromWords("ajoute « relancer Savanna » à mon tableau"),
    ).toBe("relancer Savanna");
    expect(boardItemFromWords("Add Prep IC memo for Mizan to my board.")).toBe(
      "Prep IC memo for Mizan",
    );
    expect(
      boardItemFromWords("put a task to call Kestrel on Friday on my to-dos"),
    ).toBe("call Kestrel on Friday");
    // Keeping Q's answer is SAVE, not a title.
    expect(boardItemFromWords("save that to my board")).toBeNull();
    expect(boardItemFromWords("what's on my board?")).toBeNull();
  });
});

/** F-73: saved work is titled by what it is and who it is about. */
describe("workTitle", () => {
  it("names the kind of work and its subject, never 'Q's answer'", () => {
    expect(
      workTitle({
        heading: null,
        question: "Help me prepare for a call with the founder of the top one",
        subject: "Anchor",
      }),
    ).toBe("Call prep: Anchor");
    expect(
      workTitle({
        heading: null,
        question: "Write me a short 12-month growth plan for Maji Loop",
        subject: "Maji Loop",
      }),
    ).toBe("12-month growth plan: Maji Loop");
    expect(
      workTitle({
        heading: "Your 12-month plan",
        question: "",
        subject: "Maji Loop",
      }),
    ).toBe("Your 12-month plan: Maji Loop");
    expect(
      workTitle({
        heading: "Anchor: what to ask",
        question: "",
        subject: "Anchor",
      }),
    ).toBe("Anchor: what to ask");
    expect(
      workTitle({ heading: null, question: "Tell me more", subject: null }),
    ).toBe("Tell me more");
  });

  it("saving a call prep keeps it on the board as 'Call prep: <who>'", async () => {
    const added: { kind: string; title: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const s = seam({
      history: [
        message(
          "USER",
          "Help me prepare for a call with the founder of the top one",
        ),
        {
          ...message(
            "Q",
            "Open with their traction.\n\n1. Ask about churn.\n2. Ask about the round.",
          ),
          blocks: [
            {
              kind: "ANSWER_CARDS",
              shape: "SINGLE",
              title: "Anchor",
              followUps: [],
              cards: [{ name: "Anchor" }],
            } as unknown as QResultBlock,
          ],
        },
        message("USER", "Save that to my board."),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(added.map((one) => one.title)).toEqual(["Call prep: Anchor"]);
  });
});

/**
 * Live 91d6361f9: the deployed reader carried no LIST or ADD, so "What's
 * on my board?" read the readiness checklist and "Add 'Prep data room for
 * seed round' to my board" found no tool. With no board ask read, their
 * unmistakable words still reach the board by code, and the board tool is
 * named whenever they speak of their own board.
 */
describe("board asks the reader left unread", () => {
  const unread = (): QTurnReading => ({
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    boardAsk: null,
    namedOther: null,
  });
  function keeper(
    items: { title: string; status: "TODO" | "DOING" | "DONE" }[] = [],
  ) {
    const added: { kind: string; title: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    return { board, added };
  }

  it("'What's on my board?' is read from the work board, never readiness, with no model call", async () => {
    const { board } = keeper([{ title: "Call prep: Anchor", status: "DOING" }]);
    const s = seam({
      history: [message("USER", "What's on my board?")],
      reading: unread(),
      board,
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    expect(s.stored[0]?.content).toBe(
      "Here's your board.\n\n**Doing** (1): Call prep: Anchor.",
    );
  });

  it("'Add …' to my board adds the to-do in their words, quoted or not", async () => {
    for (const words of [
      "Add 'Prep data room for seed round' to my board",
      "Add Prep IC memo for Mizan to my board.",
    ]) {
      const { board, added } = keeper();
      const s = seam({
        history: [message("USER", words)],
        reading: unread(),
        board,
      });
      await s.run();
      expect(s.delegated(), words).toBe(0);
      expect(
        added.map((one) => one.kind),
        words,
      ).toEqual(["TASK"]);
    }
  });

  it("knows their own board by its words, and only theirs", () => {
    expect(mentionsOwnBoard("put this on my work board")).toBe(true);
    expect(mentionsOwnBoard("ajoute ça à mon tableau")).toBe(true);
    expect(mentionsOwnBoard("send it to the board of directors")).toBe(false);
    expect(asksWhatIsOnBoard("What's on my board?")).toBe(true);
    expect(asksWhatIsOnBoard("what is in my to-dos")).toBe(true);
    expect(asksWhatIsOnBoard("show me my work board")).toBe(true);
    expect(
      asksWhatIsOnBoard("What's on my board? Also draft the memo for Anchor."),
    ).toBe(false);
    expect(asksWhatIsOnBoard("What's on the board meeting agenda?")).toBe(
      false,
    );
  });
});

/**
 * QA 2026-10-24 on the board: (1) "break it into tasks" split Q's own save
 * confirmation; (2) a save while Q's deep work was under way filed only
 * "On it. Starting now"; (3) "work on the first task" was declined.
 */
describe("board turns after other board turns", () => {
  const SAVED = "11111111-2222-4333-8444-555555555555";
  const PLAN =
    "# Growth plan\n\n1. Hire a head of sales.\n2. Close the bridge round.";
  const reading = (boardAsk: "SAVE" | "BREAKDOWN" | "WORK"): QTurnReading => ({
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    boardAsk,
    namedOther: null,
  });
  type Item = {
    id: string;
    title: string;
    status: "TODO" | "DOING" | "DONE";
    createdBy: "PERSON" | "Q";
    createdAt: string;
  };
  function keeper(items: Item[] = [], job: string | null = null) {
    const added: { kind: string; title: string; refId?: string }[] = [];
    const linked: [string, string][] = [];
    const worked: string[][] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({
          outcome: "OK",
          replayed: false,
          value: { id: `item-${String(added.length)}` },
        });
      },
      latestRunningJob: () =>
        Promise.resolve(job === null ? null : { jobId: job }),
      linkJob: (_actor, itemId, jobId) => {
        linked.push([itemId, jobId]);
        return Promise.resolve({ outcome: "OK" });
      },
      work: (_request, itemIds) => {
        worked.push([...itemIds]);
        return Promise.resolve({
          status: "STARTED",
          working: items.filter((one) => itemIds.includes(one.id)),
          firstRead: null,
          waiting: [],
          jobId: BOARD_JOB,
          summary: "Research hiring a head of sales and write your plan.",
        });
      },
    };
    return { board, added, linked, worked };
  }

  it("(1) breaking down after a save splits the plan, never Q's confirmation, and keeps one document", async () => {
    const { board, added } = keeper();
    const s = seam({
      history: [
        message("USER", "Write me a growth plan."),
        message("Q", PLAN),
        message("USER", "Save that plan to my board."),
        {
          ...message(
            "Q",
            "I've filed that as a document and put “Growth plan” on your board, in To do.",
          ),
          blocks: [
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId: QArtifactIdSchema.parse(SAVED),
              type: "Q_REPORT",
              status: "READY",
              title: "Growth plan",
            },
          ],
        },
        message("USER", "Now break it into tasks."),
      ],
      reading: reading("BREAKDOWN"),
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([
      { kind: "TASK", title: "Hire a head of sales." },
      { kind: "TASK", title: "Close the bridge round." },
    ]);
  });

  it("(2) a save while the work is under way keeps the job itself, linked, and files nothing", async () => {
    const JOB = "99999999-2222-4333-8444-555555555555";
    const { board, added, linked } = keeper([], JOB);
    const s = seam({
      history: [
        message("USER", "Write me a 12-month growth plan for Maji Loop"),
        message(
          "Q",
          "On it. Starting now: a 12-month growth plan. It will be ready in a few minutes.",
        ),
        message("USER", "Save that plan to my board."),
      ],
      reading: reading("SAVE"),
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([
      expect.objectContaining({
        kind: "WORK_JOB",
        refId: JOB,
        // F-95: who it is about, from the ask (F-73's own form).
        title: "12-month growth plan: Maji Loop",
      }),
    ]);
    expect(linked).toEqual([["item-1", JOB]]);
    expect(s.stored[0]?.content).toMatch(
      /in Doing; it moves to Done, with its document/u,
    );
  });

  it("(2) with no job of theirs under way, it says so and files nothing", async () => {
    const { board, added } = keeper([], null);
    const s = seam({
      history: [
        message("USER", "Write me a growth plan"),
        message("Q", "On it, starting now. It will be ready in a few minutes."),
        message("USER", "Save it to my board."),
      ],
      reading: reading("SAVE"),
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([]);
    expect(s.stored[0]?.content).toMatch(/^That work is still under way/u);
  });

  it("(3) 'work on the first task' starts Q's work on the first open item, by code", async () => {
    const items: Item[] = [
      {
        id: "a",
        title: "Hire a head of sales.",
        status: "TODO",
        createdBy: "Q",
        createdAt: "2026-10-24T08:00:00Z",
      },
      {
        id: "b",
        title: "Close the bridge round.",
        status: "TODO",
        createdBy: "Q",
        createdAt: "2026-10-24T08:00:01Z",
      },
    ];
    const { board, worked } = keeper(items);
    const s = seam({
      history: [message("USER", "Work on the first task.")],
      reading: reading("WORK"),
      board,
    });
    await s.run();
    expect(s.delegated()).toBe(0);
    expect(worked).toEqual([["a"]]);
    expect(s.stored[0]?.content).toBe(
      "I've started on “Hire a head of sales.”: it's in Doing, and moves to Done when the work finishes.",
    );
    // Owner 2026-10-24: followed by the same live card as work asked in words.
    expect(s.stored[0]?.blocks).toEqual([
      {
        kind: "WORK_IN_PROGRESS",
        jobId: BOARD_JOB,
        title: "Research hiring a head of sales and write your plan",
      },
    ]);
  });

  it("F-108: work started from the board says the plan's allowance plainly, and the item stays in To do", async () => {
    const items: Item[] = [
      {
        id: "a",
        title: "Research Silo Credit's market",
        status: "TODO",
        createdBy: "Q",
        createdAt: "2026-10-24T08:00:00Z",
      },
    ];
    const { board } = keeper(items);
    const s = seam({
      history: [message("USER", "Work on the first task.")],
      reading: reading("WORK"),
      board: {
        ...board,
        work: () =>
          Promise.resolve({
            status: "PLAN_LIMIT",
            working: [],
            firstRead: null,
            waiting: [],
            jobId: null,
            message: PLAN_SENTENCE,
          }),
      },
    });
    await s.run();
    expect(s.stored[0]?.content).toBe(
      `Your plan's allowance for Q's work this month is used, so I haven't started it and the item stays in To do. ${PLAN_SENTENCE}`,
    );
    expect(s.stored[0]?.blocks ?? []).toEqual([]);
  });

  it("knows which open items 'work on …' means, from the board", () => {
    const at = (minute: number) =>
      `2026-10-24T08:${String(minute).padStart(2, "0")}:00Z`;
    const items: Item[] = [
      {
        id: "old",
        title: "Call Kestrel",
        status: "TODO",
        createdBy: "PERSON",
        createdAt: at(0),
      },
      {
        id: "a",
        title: "Hire a head of sales",
        status: "TODO",
        createdBy: "Q",
        createdAt: at(30),
      },
      {
        id: "b",
        title: "Close the bridge round",
        status: "TODO",
        createdBy: "Q",
        createdAt: at(30),
      },
      {
        id: "done",
        title: "Ship it",
        status: "DONE",
        createdBy: "Q",
        createdAt: at(30),
      },
    ];
    expect(boardItemsMeant("work on the second one", items)).toEqual(["a"]);
    expect(boardItemsMeant("get going on those", items)).toEqual(["a", "b"]);
    expect(boardItemsMeant("start on close the bridge round", items)).toEqual([
      "b",
    ]);
    expect(boardItemsMeant("do something", items)).toEqual([]);
  });
});

/** Live 6b05d53a4: a call prep about an investor, referenced but no card. */
describe("a saved call prep about an investor Q referenced", () => {
  it("is titled with the investor as they named them", async () => {
    const added: { kind: string; title: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const s = seam({
      history: [
        message(
          "USER",
          "Help me prepare for a call with Savanna Seed Partners",
        ),
        {
          ...message(
            "Q",
            "Lead with your traction.\n\n1. Ask about their pacing.",
          ),
          blocks: [
            {
              kind: "INVESTOR_REFERENCE",
              investorOrganisationId: "a1000000-0000-4000-8000-000000000001",
            },
          ],
        },
        message("USER", "Save that call prep to my board."),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(added.map((one) => one.title)).toEqual([
      "Call prep: Savanna Seed Partners",
    ]);
  });

  it("reads the name from the ask, and nothing from a lowercase one", () => {
    expect(
      nameInAsk("Help me prepare for a call with Savanna Seed Partners"),
    ).toBe("Savanna Seed Partners");
    expect(nameInAsk("Write an IC memo for Bank of Kigali and")).toBe(
      "Bank of Kigali",
    );
    expect(nameInAsk("help me prepare for a call with the top one")).toBeNull();
  });
});

/** Live 18d7884c4: "work on the first task" on a board led by saved documents. */
describe("the first task is a task", () => {
  it("skips saved documents when they ask for a task, but not when they ask for an item", () => {
    const items = [
      {
        id: "doc",
        kind: "DOCUMENT",
        title: "Call prep: Anchor",
        status: "TODO",
      },
      {
        id: "t1",
        kind: "TASK",
        title: "Review Basketari repeat order data",
        status: "TODO",
      },
      {
        id: "t2",
        kind: "TASK",
        title: "Prep IC memo for Anchor",
        status: "TODO",
      },
    ];
    expect(
      boardItemsMeant("Work on the first task on my board", items),
    ).toEqual(["t1"]);
    expect(boardItemsMeant("work on the second to-do", items)).toEqual(["t2"]);
    expect(boardItemsMeant("work on the first item", items)).toEqual(["doc"]);
  });
});

/** F-78b, F-79 (QA, live 18d7884c4). */
describe("nothing saved from nothing, and a described task is that task", () => {
  it("'save that plan' after a planning failure saves nothing and says so", async () => {
    const added: unknown[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, item) => {
        added.push(item);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const s = seam({
      history: [
        message("USER", "Write me a 12-month plan"),
        message(
          "Q",
          "I couldn't plan this just now: something failed on my side, and nothing has started. Ask me again in a moment.",
        ),
        message("USER", "Save that plan to my board."),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(added).toEqual([]);
    expect(s.prepared).toHaveLength(0);
    expect(s.stored[0]?.content).toMatch(/^There's nothing to save yet/u);
  });

  it("'the first logistics task' is the first task about logistics, or none", () => {
    const items = [
      {
        id: "old",
        kind: "TASK",
        title: "Prepare for a call with the founder of the top one",
        status: "TODO",
      },
      {
        id: "l1",
        kind: "TASK",
        title: "Map the logistics partners in Lagos",
        status: "TODO",
      },
    ];
    expect(boardItemsMeant("Work on the first logistics task", items)).toEqual([
      "l1",
    ]);
    expect(boardItemsMeant("Work on the first hiring task", items)).toEqual([]);
    expect(boardItemsMeant("Work on the first task", items)).toEqual(["old"]);
  });

  it("asks which task when none on the board fits what they described", async () => {
    const worked: unknown[] = [];
    const board: BoardKeeper = {
      list: () =>
        Promise.resolve({
          items: [
            {
              id: "old",
              kind: "TASK",
              title: "Prepare for a call with the founder of the top one",
              status: "TODO" as const,
            },
          ],
        }),
      add: () => Promise.resolve({ outcome: "OK", replayed: false }),
      work: (_r, ids) => {
        worked.push(ids);
        return Promise.resolve({
          status: "STARTED",
          working: [],
          firstRead: null,
          waiting: [],
        });
      },
    };
    const s = seam({
      history: [message("USER", "Work on the first logistics task")],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "WORK",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(worked).toEqual([]);
    expect(s.stored[0]?.content).toBe(
      "I couldn't find that task on your board. Which one do you mean? In To do: “Prepare for a call with the founder of the top one”.",
    );
  });
});

/** Live 9ff4a1118: the call-prep answer carried no blocks at all. */
describe("a saved call prep with no blocks", () => {
  it("is titled with the counterpart they named in the ask", async () => {
    const added: { kind: string; title: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, request) => {
        added.push(request);
        return Promise.resolve({ outcome: "OK", replayed: false });
      },
    };
    const s = seam({
      history: [
        message(
          "USER",
          "Help me prepare for a call with Savanna Seed Partners",
        ),
        message("Q", "Lead with your traction, then ask about their pacing."),
        message("USER", "Save that call prep to my board"),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(added.map((one) => one.title)).toEqual([
      "Call prep: Savanna Seed Partners",
    ]);
  });

  it("an honest line when the planner fails", async () => {
    const board: BoardKeeper = {
      list: () =>
        Promise.resolve({
          items: [
            {
              id: "t1",
              kind: "TASK",
              title: "Map logistics partners",
              status: "TODO" as const,
            },
          ],
        }),
      add: () => Promise.resolve({ outcome: "OK", replayed: false }),
      work: () =>
        Promise.resolve({
          status: "FAILED",
          working: [],
          firstRead: null,
          waiting: [],
        }),
    };
    const s = seam({
      history: [message("USER", "Work on the first task on my board")],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "WORK",
        namedOther: null,
      },
      board,
    });
    await s.run();
    expect(s.stored[0]?.content).toBe(
      "I couldn't plan that task: the planning step failed on my side, so nothing has started and the item stays in To do.",
    );
  });
});

/** F-90 and F-78b (QA re-score, live 9ff4a1118). */
describe("saving work that has to start first, or never started", () => {
  const PLAN = {
    summary: "A 12-month growth plan",
    steps: [{ who: "Research", does: "Reads the market" }],
    cannot: [],
    needsYou: [],
  };
  const reading = (boardAsk: "SAVE" | null, teamJob = false): QTurnReading => ({
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    boardAsk,
    namedOther: null,
    teamJob,
  });
  function keeper(job: string | null) {
    const added: { kind: string; title: string; refId?: string }[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, item) => {
        added.push(item);
        return Promise.resolve({
          outcome: "OK",
          replayed: false,
          value: { id: "item-1" },
        });
      },
      latestRunningJob: () =>
        Promise.resolve(job === null ? null : { jobId: job }),
      linkJob: () => Promise.resolve({ outcome: "OK" }),
    };
    return { board, added };
  }
  const team = (outcome: TeamJobOutcome): QTeamJobPort => ({
    propose: () => Promise.resolve(outcome),
  });

  // F-108, live c8d45c628: the plan's allowance used read as "Taking on work
  // like this isn't available on your account" or "I've reached the limit
  // of work I can take on", which reads as Q's limit.
  it("F-108: says whose limit it is, in the plan's own words", async () => {
    const denied = createToolTeamJobPort({
      tools: {
        execute: () =>
          Promise.resolve({
            callId: "q-team-job",
            toolName: "propose_q_job",
            toolVersion: 1,
            classification: "SIDE_EFFECT",
            status: "DENIED",
            failureCode: "ENTITLEMENT_REQUIRED",
            sensitivity: null,
            result: {
              ok: false,
              error: {
                code: "ENTITLEMENT_REQUIRED",
                safeMessage: PLAN_SENTENCE,
              },
            },
            latencyMs: 3,
          }),
      } as never,
    });
    const outcome = await denied.propose(
      { actor, runId: randomUUID() } as never,
      "Research the market and competitors for Silo Credit's space",
    );
    expect(outcome).toEqual({ status: "PLAN_LIMIT", message: PLAN_SENTENCE });
    const line = teamJobLine(outcome);
    expect(line).toContain(PLAN_SENTENCE);
    expect(line).not.toContain("isn't available");
    expect(line).not.toContain("limit of work I can take on");
    expect(teamJobLine({ status: "LIMIT_REACHED" })).toMatch(
      /^Your monthly limit for Q's work is reached/u,
    );
  });

  // QA F-123 (2026-10-25, run d5bcb2eb): "Starting now: you will research
  // Silo Credit's market…" named the person as the one doing Q's work.
  it("F-123: the start line and its card say Q's own work, never 'you will'", () => {
    const plan = {
      ...PLAN,
      summary:
        "You will research Silo Credit's market and competitors, then prepare a short analysis document.",
    };
    const outcome: TeamJobOutcome = {
      status: "STARTED",
      plan,
      firstRead: null,
      jobId: "99999999-2222-4333-8444-555555555555",
    };
    expect(teamJobLine(outcome)).toMatch(
      /^On it\. Starting now: research Silo Credit's market and competitors, then prepare a short analysis document\./u,
    );
    expect(teamJobLine(outcome)).not.toMatch(/you will/iu);
    expect(teamJobBlocks(outcome)).toMatchObject([
      {
        kind: "WORK_IN_PROGRESS",
        title:
          "Research Silo Credit's market and competitors, then prepare a short analysis document",
      },
    ]);
    expect(ownWorkSummary("I'll draft your plan.")).toBe("draft your plan");
    expect(ownWorkSummary("Research your market.")).toBe(
      "Research your market",
    );
  });

  it("reads back every outcome line the team job writes", () => {
    const outcomes: TeamJobOutcome[] = [
      { status: "STARTED", plan: PLAN, firstRead: null },
      { status: "STARTED", plan: { ...PLAN, summary: "" }, firstRead: null },
      { status: "ALREADY_WAITING", waiting: [] },
      { status: "NOT_PLANNED" },
      { status: "LIMIT_REACHED" },
      { status: "PLAN_LIMIT", message: null },
      { status: "PLAN_LIMIT", message: PLAN_SENTENCE },
      { status: "UNAVAILABLE" },
      { status: "FAILED" },
    ];
    for (const outcome of outcomes) {
      expect(teamJobOutcomeOf(teamJobLine(outcome)), outcome.status).toBe(
        outcome.status,
      );
    }
    expect(teamJobOutcomeOf("Here's your 12-month plan.")).toBeNull();
  });

  it("'Write a 12-month growth plan and save it to my board': the work starts, and its job goes on the board", async () => {
    const JOB = "99999999-2222-4333-8444-555555555555";
    const { board, added } = keeper(JOB);
    const s = seam({
      history: [
        message("USER", "Write a 12-month growth plan and save it to my board"),
      ],
      reading: reading("SAVE", true),
      board,
      teamJob: team({ status: "STARTED", plan: PLAN, firstRead: null }),
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([
      expect.objectContaining({
        kind: "WORK_JOB",
        refId: JOB,
        title: "12-month growth plan",
      }),
    ]);
    expect(s.stored[0]?.content).toMatch(/^On it\. Starting now/u);
    expect(s.stored[0]?.content).toMatch(
      /in Doing; it moves to Done, with its document/u,
    );
  });

  it("the same ask when the plan does not start saves nothing", async () => {
    const { board, added } = keeper(null);
    const s = seam({
      history: [
        message("USER", "Write a 12-month growth plan and save it to my board"),
      ],
      reading: reading("SAVE", true),
      board,
      teamJob: team({ status: "FAILED" }),
    });
    await s.run();
    expect(added).toEqual([]);
    expect(s.stored[0]?.content).toMatch(/Nothing has gone on your board/u);
  });

  it("'save that plan to my board' after the team job's failure line, unread by the reader, saves nothing and starts nothing", async () => {
    const { board, added } = keeper(null);
    let proposed = 0;
    const s = seam({
      history: [
        message("USER", "Write me a 12-month plan"),
        message("Q", teamJobLine({ status: "FAILED" })),
        message("USER", "save that plan to my board"),
      ],
      reading: reading(null),
      board,
      teamJob: {
        propose: () => {
          proposed += 1;
          return Promise.resolve({ status: "FAILED" });
        },
      },
    });
    await s.run();
    expect(proposed).toBe(0);
    expect(added).toEqual([]);
    expect(s.prepared).toHaveLength(0);
    expect(s.stored[0]?.content).toMatch(/^There's nothing to save yet/u);
  });
});

/** Batch 8 re-score: I13 (save while the job runs) and F11 (compound reply). */
describe("saving deep work by its job", () => {
  const JOB = "77777777-2222-4333-8444-555555555555";
  const DOC = "66666666-2222-4333-8444-555555555555";
  const PLAN = {
    summary: "A 12-month growth plan",
    steps: [{ who: "Research", does: "Reads the market" }],
    cannot: [],
    needsYou: [],
  };
  const reading = (teamJob = false): QTurnReading => ({
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    boardAsk: "SAVE",
    namedOther: null,
    teamJob,
  });
  function keeper() {
    const added: { kind: string; title: string; refId?: string }[] = [];
    const linked: string[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: (_actor, item) => {
        added.push(item);
        return Promise.resolve({
          outcome: "OK",
          replayed: false,
          value: { id: "item-1" },
        });
      },
      // The latest-job read finds nothing (a job queued a moment ago).
      latestRunningJob: () => Promise.resolve(null),
      linkJob: (_actor, _item, jobId) => {
        linked.push(jobId);
        return Promise.resolve({ outcome: "OK" });
      },
    };
    return { board, added, linked };
  }
  const wip = {
    kind: "WORK_IN_PROGRESS" as const,
    jobId: JOB,
    title: "A 12-month growth plan",
  };

  it("I13: a save while the job's card shows it under way keeps that job, linked, even past a later message", async () => {
    const { board, added, linked } = keeper();
    const s = seam({
      history: [
        message("USER", "Write me a 12-month growth plan for Maji Loop"),
        {
          ...message("Q", "On it. Starting now: a 12-month growth plan."),
          blocks: [wip],
        },
        message("Q", "The research step is done; the draft is next."),
        message("USER", "Save that plan to my board."),
      ],
      reading: reading(),
      board,
    });
    await s.run();
    expect(s.prepared).toHaveLength(0);
    expect(added).toEqual([
      expect.objectContaining({ kind: "WORK_JOB", refId: JOB }),
    ]);
    expect(linked).toEqual([JOB]);
  });

  it("once the document has come, the save keeps the document", async () => {
    const { board, added } = keeper();
    const s = seam({
      history: [
        message("USER", "Write me a 12-month growth plan"),
        {
          ...message("Q", "On it. Starting now: a 12-month growth plan."),
          blocks: [wip],
        },
        {
          ...message("Q", "Your 12-month growth plan is ready."),
          blocks: [
            wip,
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId: QArtifactIdSchema.parse(DOC),
              type: "Q_REPORT",
              status: "READY",
              title: "12-month growth plan",
            },
          ],
        },
        message("USER", "Save that plan to my board."),
      ],
      reading: reading(),
      board,
    });
    await s.run();
    expect(added).toEqual([
      expect.objectContaining({ kind: "DOCUMENT", refId: DOC }),
    ]);
  });

  it("F11: 'write … and save it' says both, linking the job the team job started", async () => {
    const { board, added, linked } = keeper();
    const s = seam({
      history: [
        message("USER", "Write a 12-month growth plan and save it to my board"),
      ],
      reading: reading(true),
      board,
      teamJob: {
        propose: () =>
          Promise.resolve({
            status: "STARTED",
            plan: PLAN,
            firstRead: null,
            jobId: JOB,
          }),
      },
    });
    await s.run();
    expect(added).toEqual([
      expect.objectContaining({ kind: "WORK_JOB", refId: JOB }),
    ]);
    expect(linked).toEqual([JOB]);
    expect(s.stored[0]?.content).toMatch(/^On it\. Starting now/u);
    expect(s.stored[0]?.content).toMatch(
      /I've also put it on your board as “12-month growth plan”, in Doing/u,
    );
    expect(s.stored[0]?.blocks).toEqual([
      expect.objectContaining({ kind: "WORK_IN_PROGRESS", jobId: JOB }),
    ]);
  });
});

/** Batch 9 (c8d45c628): the planner said saving to the board was not available. */
describe("the planner gets the work, the board gets the save", () => {
  it("drops the save clause and keeps the work in their words", () => {
    expect(
      withoutBoardSave(
        "Write me a short 12-month growth plan and save it to my board",
      ),
    ).toBe("Write me a short 12-month growth plan");
    expect(
      withoutBoardSave("Draft an IC memo on Mizan, then put it on my board."),
    ).toBe("Draft an IC memo on Mizan");
    expect(
      withoutBoardSave(
        "Prepare questions for Anchor and keep the questions on my to-dos",
      ),
    ).toBe("Prepare questions for Anchor");
    expect(withoutBoardSave("save it to my board")).toBe("save it to my board");
  });

  it("the team job is asked for the plan alone", async () => {
    const goals: string[] = [];
    const board: BoardKeeper = {
      list: () => Promise.resolve({ items: [] }),
      add: () =>
        Promise.resolve({
          outcome: "OK",
          replayed: false,
          value: { id: "item-1" },
        }),
      latestRunningJob: () => Promise.resolve(null),
      linkJob: () => Promise.resolve({ outcome: "OK" }),
    };
    const s = seam({
      history: [
        message(
          "USER",
          "Write me a short 12-month growth plan and save it to my board",
        ),
      ],
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        boardAsk: "SAVE",
        namedOther: null,
        teamJob: true,
      },
      board,
      teamJob: {
        propose: (_request, goal) => {
          goals.push(goal);
          return Promise.resolve({
            status: "STARTED",
            plan: {
              summary: "A growth plan",
              steps: [],
              cannot: [],
              needsYou: [],
            },
            firstRead: null,
            jobId: "77777777-2222-4333-8444-555555555555",
          });
        },
      },
    });
    await s.run();
    expect(goals).toEqual(["Write me a short 12-month growth plan"]);
  });
});
