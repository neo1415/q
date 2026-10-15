import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  type QResultBlock,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { CompanyAnalystV8Result } from "@capital-q/q-core";
import type { AuthorisedKnowledge, RetrievalHit } from "@capital-q/q-knowledge";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import {
  createToolCanonicalPort,
  mandateStatement,
} from "../src/company/adapters.js";
import { knowledgeToFact, passageToFact } from "../src/company/assembly.js";
import type {
  CompanyCanonicalPort,
  CompanyEvidencePort,
  CompanyKnowledgePort,
} from "../src/company/ports.js";
import { createCompanyIntelligenceSpecialist } from "../src/company/specialist.js";

/**
 * Q's answers outside the interview are truthful, sourced and continuous
 * (CQ-QX-007). Deterministic doubles; code asserts. Each case is a failure
 * a person hit in a real browser run.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OWN_INVESTOR = "11111111-0000-4000-8000-000000000013";
const CONVERSATION = randomUUID();

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const company: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };
const ownFirm: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: OWN_INVESTOR,
};

function plan(
  runId: string,
  overrides: Partial<PermittedContextPlan> = {},
): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [company],
    scopes: [],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
    ...overrides,
  });
}

function analyst(
  answer: string,
  extra: Partial<CompanyAnalystV8Result> = {},
): CompanyAnalystV8Result {
  return {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
    companyFindings: [],
    coverage: [],
    materialChanges: [],
    userStatements: [],
    profileUpdates: [],
    displayName: null,
    artifactRequest: null,
    actionTalk: [],
    ...extra,
  };
}

function hit(overrides: Partial<RetrievalHit> = {}): RetrievalHit {
  return {
    chunkId: randomUUID(),
    chunkSetId: randomUUID(),
    documentId: randomUUID(),
    documentVersionId: randomUUID(),
    documentTitle: "kivu-one-pager.pdf",
    subjectType: "COMPANY",
    subjectId: COMPANY,
    chunkKind: "TEXT",
    role: "LEAF",
    locator: { pageStart: 1 },
    content:
      "Anchor customer: Mombasa Grain Millers Cooperative, about 38% of loads.",
    visibilityScope: "organisation_private",
    sensitivityClass: "CONFIDENTIAL",
    lexicalRank: 1,
    semanticRank: 1,
    fusedRank: 1,
    fusedScore: 1,
    scopeKind: "EVIDENCE_DOCUMENTS",
    canDiscloseExistence: true,
    canQuote: true,
    canProvideLink: false,
    parentChunkId: null,
    expandedFromChunkId: null,
    ...overrides,
  } as unknown as RetrievalHit;
}

/** The one-pager answer from the walkthrough, as the model wrote it. */
const CUSTOMER_ANSWER = analyst(
  "Your biggest customer is the Mombasa Grain Millers Cooperative, which moves about 38% of your loads (F2).",
  {
    companyFindings: [
      {
        dimension: "CUSTOMERS",
        type: "FACT",
        statement:
          "Mombasa Grain Millers Cooperative is the anchor customer and moves 38% of loads.",
        truthClass: "USER_CLAIM",
        confidence: "MODERATE",
        citations: ["F2"],
        assumptions: [],
      },
    ],
  },
);

function specialistWith(options: {
  readonly analyst: CompanyAnalystV8Result;
  readonly hits?: readonly RetrievalHit[];
}) {
  const requests: { messages: { content: string }[] }[] = [];
  const gateway = {
    execute: (request: { messages: { content: string }[] }) => {
      requests.push(request);
      return Promise.resolve({
        providerCode: "fake",
        modelCode: "fake-model",
        routingPolicyCode: "evidence_synthesis.test",
        cost: { amount: 0, currency: "USD" },
        output: { kind: "STRUCTURED", value: options.analyst },
      });
    },
  } as unknown as ModelGateway;
  const canonical: CompanyCanonicalPort = {
    read: () =>
      Promise.resolve({
        facts: [
          {
            scope: "COMPANY_PROFILE",
            statement: "Canonical name: Kivu Freight. Current stage: seed.",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            source: "Capital Q canonical company record",
          },
        ],
        toolCalls: 1,
        available: true,
        canonicalName: "Kivu Freight",
        description:
          "Kivu Freight matches shippers with vetted truckers across East Africa.",
      }),
  };
  const knowledge: CompanyKnowledgePort = {
    current: () => Promise.resolve([]),
    disputes: () => Promise.resolve([]),
    series: () => Promise.resolve([]),
    asOf: () => Promise.resolve(null),
  };
  const evidence: CompanyEvidencePort = {
    search: () => Promise.resolve([...(options.hits ?? [hit()])]),
  };
  const specialist = createCompanyIntelligenceSpecialist({
    gateway,
    canonical,
    knowledge,
    evidence,
    sensitivity: { kind: "DECLARED_SYNTHETIC", sensitivity: "INTERNAL" },
  });
  return { specialist, requests };
}

function seamWith(options: {
  readonly analyst: CompanyAnalystV8Result;
  readonly earlier?: readonly { role: "USER" | "Q"; content: string }[];
  readonly said: string;
}) {
  const { specialist, requests } = specialistWith(options);
  const runId = randomUUID();
  const at = (offset: number) => new Date(Date.now() - offset).toISOString();
  const history: QConversationMessage[] = [
    ...(options.earlier ?? []).map(
      (turn, index) =>
        ({
          id: randomUUID(),
          tenantId: TENANT,
          conversationId: CONVERSATION,
          runId: randomUUID(),
          role: turn.role,
          content: turn.content,
          contentType: "TEXT",
          createdAt: at(60_000 - index * 1_000),
        }) as unknown as QConversationMessage,
    ),
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId,
      role: "USER",
      content: options.said,
      contentType: "TEXT",
      createdAt: at(0),
    } as unknown as QConversationMessage,
  ];
  const stored: { content: string; blocks?: readonly QResultBlock[] }[] = [];
  const answer = createSpecialistQAnswer({
    specialist,
    delegate: {
      answer: () => Promise.reject(new Error("the specialist answers this")),
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve(history),
        insert: (
          _tx: unknown,
          input: { content: string; blocks?: readonly QResultBlock[] },
        ) => {
          stored.push(input);
          return Promise.resolve({
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
  });
  const request: QAnswerRequest = {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [company],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(runId),
  };
  const prompt = () =>
    requests
      .flatMap((sent) => sent.messages.map((message) => message.content))
      .join(" ");
  return { answer, request, stored, prompt };
}

describe("F1: the answer names its source the way the person knows it", () => {
  it("says the document the answer rests on, never an id or a fact label, and no GAP contradicts the FACT", async () => {
    const h = seamWith({
      analyst: CUSTOMER_ANSWER,
      said: "remind me, who's our biggest customer and what share of our loads do they move?",
    });
    const outcome = await h.answer.answer(h.request);
    expect(outcome.kind).toBe("ANSWERED");
    const message = h.stored[0];
    expect(message?.content).toContain("Mombasa Grain Millers Cooperative");
    expect(message?.content).toContain("Source: kivu-one-pager.pdf, page 1.");
    // The label became the source, and no machinery came with it.
    expect(message?.content).not.toMatch(/\bF\d+\b/);
    expect(message?.content).not.toContain("confidence");
    expect(message?.content).not.toContain("evidence item");
    const findings = (message?.blocks ?? []).flatMap((block) =>
      block.kind === "FINDING" ? [block.finding] : [],
    );
    expect(findings.map((finding) => finding.type)).toEqual(["FACT"]);
    expect(findings[0]?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
    // Ids stay on the server.
    expect(JSON.stringify(message?.blocks)).not.toContain(
      h.request.plan.planId,
    );
    for (const finding of findings) expect(finding.evidenceRefs).toEqual([]);
  });

  it("never names a document whose existence may not be disclosed", async () => {
    const h = seamWith({
      analyst: CUSTOMER_ANSWER,
      said: "who's our biggest customer?",
    });
    const { specialist } = specialistWith({
      analyst: CUSTOMER_ANSWER,
      hits: [hit({ canDiscloseExistence: false })],
    });
    const result = await specialist.investigate(
      { company: { kind: "COMPANY", companyId: COMPANY }, question: "who?" },
      {
        actor,
        runId: h.request.runId,
        correlationId: "cor_test",
        capability: "ANSWER",
        plan: h.request.plan,
        showStage: () => Promise.resolve(),
      },
    );
    expect(JSON.stringify(result.findings)).not.toContain("kivu-one-pager");
    expect(result.synthesis ?? "").not.toContain("kivu-one-pager");
  });

  it("names a statement the person made as theirs, dated, and a document by its title", () => {
    const known = {
      object: {
        id: randomUUID(),
        knowledgeKey: "traction.gmv_monthly",
        statement: "Monthly GMV was USD 380,000 in August 2026.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        confidenceClass: "MODERATE",
        validFrom: null,
        recordedAt: "2026-09-24T09:45:26.000Z",
        sourceEnvironment: "CONVERSATION",
      },
      evidence: [],
      sourceIds: [],
      freshness: { stale: false, ageDays: 0, policyVersion: "v1" },
      disputed: false,
    } as unknown as AuthorisedKnowledge;
    expect(knowledgeToFact(known, "F1", "OWNER").presentedSource).toBe(
      "what you told me on 24 September 2026",
    );
    expect(knowledgeToFact(known, "F1", "OTHER").presentedSource).toBe(
      "what the company told Capital Q on 24 September 2026",
    );
    expect(passageToFact(hit(), "F2").presentedSource).toBe(
      "kivu-one-pager.pdf, page 1",
    );
  });
});

describe("H3a: the person's latest correction carries into the next answer", () => {
  it("puts the earlier turns of THIS conversation in front of the model", async () => {
    const correction =
      "quick correction, our monthly GMV in august was actually 380k, the 412 in the one-pager was a typo. so what's our GMV?";
    const h = seamWith({
      analyst: analyst("You told me GMV was USD 380,000 in August."),
      earlier: [
        { role: "USER", content: correction },
        {
          role: "Q",
          content:
            "Your monthly GMV for August was USD 380,000, as you told me; the one-pager says USD 412,000.",
        },
      ],
      said: "uh when would we be ready for a series A, and the burn thing, do we even have that on file",
    });
    await h.answer.answer(h.request);
    const prompt = h.prompt();
    expect(prompt).toContain("380k, the 412 in the one-pager was a typo");
    // The instruction that makes the correction govern.
    expect(prompt).toContain("A figure the person corrected");
  });
});

describe("no action claim survives in the model's own prose", () => {
  it("removes the sentences the analyst named as talk about acting", async () => {
    const h = seamWith({
      analyst: analyst(
        "I have noted the update to your website URL as kivu-freight.example. This is ready for your approval.",
        {
          actionTalk: [
            "I have noted the update to your website URL as kivu-freight.example.",
            "This is ready for your approval.",
          ],
        },
      ),
      said: "please update our profile, the website is kivu-freight.example now",
    });
    await h.answer.answer(h.request);
    const content = h.stored[0]?.content ?? "";
    expect(content).not.toContain("ready for your approval");
    expect(content).not.toContain("I have noted");
  });
});

describe("fit: an investor's own declared mandate is read, and only theirs", () => {
  const offered = ["get_company", "get_investor_mandate"].map((name) => ({
    definition: { name },
  }));
  const MANDATE = {
    investorOrganisationId: OWN_INVESTOR,
    displayName: "Savannah Capital",
    mandates: [
      {
        cheque: { currency: "USD", min: "250000", max: "1000000" },
        stage: { minStageCode: "seed", maxStageCode: "series_a" },
        constraints: [],
        taxonomyPreferences: [
          {
            vocabularyCode: "sector",
            canonicalCode: "logistics",
            preferenceStrength: "PREFERRED",
            isExclusion: false,
          },
        ],
      },
    ],
    truncated: false,
  };
  function toolsPort(calls: string[]): QToolPort {
    return {
      offer: () => Promise.resolve(offered),
      execute: (call: { name: string }) => {
        calls.push(call.name);
        return Promise.resolve({
          result:
            call.name === "get_investor_mandate"
              ? { ok: true, data: MANDATE }
              : {
                  ok: true,
                  data: {
                    canonicalName: "Kivu Freight",
                    shortDescription: "Freight matching.",
                    primaryDescription: null,
                    currentStageCode: "seed",
                    headquartersCountry: "KE",
                    headquartersCity: null,
                    foundedDate: null,
                    websiteUrl: null,
                  },
                },
        });
      },
    } as unknown as QToolPort;
  }
  const scope = (kind: string, subject: QSubjectRef) =>
    ({
      kind,
      subject,
      contextLabel: "investor_private",
      sensitivity: "CONFIDENTIAL",
      layer: "STRUCTURED",
      factCategories: [],
      projection: "FULL",
      rights: "OWNER",
      filter: {},
      isEvidence: true,
    }) as never;

  it("reads their own mandate when the firewall bound it to their firm", async () => {
    const calls: string[] = [];
    const runId = randomUUID();
    const read = await createToolCanonicalPort(toolsPort(calls)).read(
      {
        actor,
        runId: runId as never,
        correlationId: "cor_test",
        capability: "ANSWER",
        plan: {
          ...plan(runId, {
            purpose: {
              capability: "ANSWER",
              taskClass: "COUNTERPARTY_COMPANY_QUESTION",
            },
            subjects: [company, ownFirm],
          }),
          scopes: [scope("INVESTOR_MANDATE", ownFirm)],
        },
      } as never,
      COMPANY,
    );
    expect(calls).toContain("get_investor_mandate");
    const mandate = read.facts.find(
      (fact) => fact.scope === "INVESTOR_MANDATE",
    );
    expect(mandate?.statement).toContain("logistics");
    expect(mandate?.statement).toContain("250000 to 1000000");
    expect(read.description).toBe("Freight matching.");
  });

  it("never asks for a mandate the plan did not bind — a founder asking about an investor holds none", async () => {
    const calls: string[] = [];
    const runId = randomUUID();
    await createToolCanonicalPort(toolsPort(calls)).read(
      {
        actor,
        runId: runId as never,
        correlationId: "cor_test",
        capability: "ANSWER",
        plan: {
          ...plan(runId, { subjects: [company, ownFirm] }),
          // A profile is not a mandate, and a subject is not a scope.
          scopes: [scope("INVESTOR_PROFILE", ownFirm)],
        },
      } as never,
      COMPANY,
    );
    expect(calls).not.toContain("get_investor_mandate");
  });

  it("states only what was declared, and nothing when nothing was", () => {
    expect(mandateStatement(MANDATE)).toBe(
      "The person's own declared investment mandate (Savannah Capital): cheque 250000 to 1000000 USD; stages seed to series_a; focus logistics.",
    );
    expect(mandateStatement({ mandates: [] })).toBeNull();
  });
});

describe("R2: Q says the raise the Discover card and the profile say", () => {
  function capitalPort(raise: unknown): QToolPort {
    return {
      offer: () =>
        Promise.resolve(
          ["get_capital_objective"].map((name) => ({ definition: { name } })),
        ),
      execute: () =>
        Promise.resolve({
          result: {
            ok: true,
            data: {
              companyId: COMPANY,
              availability: "NOT_SHARED_WITH_YOU",
              objective: null,
              raise,
            },
          },
        }),
    } as unknown as QToolPort;
  }
  async function capitalFacts(raise: unknown) {
    const runId = randomUUID();
    const read = await createToolCanonicalPort(capitalPort(raise)).read(
      {
        actor,
        runId: runId as never,
        correlationId: "cor_test",
        capability: "ANSWER",
        plan: plan(runId, { subjects: [company] }),
      } as never,
      COMPANY,
    );
    return read.facts.filter((fact) => fact.scope === "CAPITAL_OBJECTIVE");
  }

  it("a pitch claim is said as their pitch, a claim, never as a disclosed or verified raise", async () => {
    const [fact] = await capitalFacts({
      source: "PITCH_CLAIM",
      money: { amount: "4000000", currency: "USD" },
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      visibility: "network_visible",
      asOf: null,
      pitch: { pitchId: randomUUID(), atSeconds: 74 },
    });
    expect(fact?.statement).toContain("In their pitch video");
    expect(fact?.statement).toContain("4000000 USD (at 1:14)");
    expect(fact?.statement).toContain("not a disclosed or verified figure");
    expect(fact?.truthClass).toBe("USER_CLAIM");
    expect(fact?.evidenceStatus).toBe("SELF_REPORTED");
  });

  it("nothing disclosed and nothing said: not shared, with no figure", async () => {
    const facts = await capitalFacts({
      source: "NONE",
      money: null,
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      visibility: "founder_private",
      asOf: null,
      pitch: null,
    });
    expect(facts.map((f) => f.statement).join(" ")).toContain(
      "has not shared its raise",
    );
    expect(facts.map((f) => f.statement).join(" ")).not.toMatch(/\d{4,}/);
  });
});
