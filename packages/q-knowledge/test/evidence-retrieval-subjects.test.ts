import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import { createQEvidenceRetrieval } from "../src/index.js";
import type { KnowledgeQueryService } from "../src/knowledge/query.js";
import type { AuthorisedRetrievalResult } from "../src/retrieval/contracts.js";

/**
 * What Capital Q already understands reaches the answer for every subject
 * an understanding can be about — a company, the person themselves, an
 * investor organisation — not only for companies.
 *
 * This is the read side of the public-presence work. The presence build
 * researches a subject, drops pages that do not name it, registers evidence
 * and writes through the Write Gate. Until this, only COMPANY
 * understandings were ever read back, so a person's own public profile was
 * researched, gated, stored, and then never consulted when Q answered.
 *
 * A USER subject resolves only to oneself (the self resolver in q-runtime
 * refuses any other id), so nothing here widens disclosure: the plan's
 * constraints still decide every row, and this test asserts the queries
 * that are made, not that any of them return.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";
const INVESTOR_ORG = "55555555-5555-4555-8555-555555555555";
const RUN = "66666666-6666-4666-8666-666666666666";
const DOCUMENT = "88888888-8888-4888-8888-888888888888";

function plan(
  overrides: Partial<PermittedContextPlan> = {},
): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "77777777-7777-4777-8777-777777777777",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: ACTOR, organisationId: ORG },
    purpose: { capability: "INVESTIGATE", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    scopes: [
      {
        kind: "EVIDENCE_DOCUMENTS",
        subject: { kind: "COMPANY", companyId: COMPANY },
        contextLabel: "founder_private",
        sensitivity: "HIGHLY_CONFIDENTIAL",
        layer: "EVIDENCE_DOCUMENTS",
        factCategories: [],
        projection: "FULL",
        rights: {
          canUseForReasoning: true,
          canDiscloseExistence: true,
          canQuote: true,
          canProvideLink: false,
        },
        filter: {
          tenantId: TENANT,
          organisationId: ORG,
          companyId: COMPANY,
          contextLabels: ["founder_private"],
        },
        isEvidence: true,
      },
      {
        kind: "KNOWLEDGE_OBJECTS",
        subject: { kind: "COMPANY", companyId: COMPANY },
        contextLabel: "founder_private",
        sensitivity: "HIGHLY_CONFIDENTIAL",
        layer: "KNOWLEDGE_OBJECTS",
        factCategories: [],
        projection: "FULL",
        rights: {
          canUseForReasoning: true,
          canDiscloseExistence: true,
          canQuote: true,
          canProvideLink: false,
        },
        filter: {
          tenantId: TENANT,
          organisationId: ORG,
          companyId: COMPANY,
          contextLabels: ["founder_private"],
        },
        isEvidence: false,
      },
    ],
    denied: [],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    allowedLayers: [
      "EVIDENCE_DOCUMENTS",
      "SEMANTIC_HYBRID",
      "PUBLIC_EXTERNAL",
      "STRUCTURED_STATE",
    ],
    combinationConstraints: [],
    evaluatedAt: "2026-09-07T10:00:00.000Z",
    revalidateAfter: "2026-09-07T10:05:00.000Z",
    revalidateOnResume: true,
    ...overrides,
  } as PermittedContextPlan;
}

// Retrieval finding nothing is the interesting case: what Capital Q
// understands must still reach the answer when no document does.
const emptyResult: AuthorisedRetrievalResult = {
  hits: [],
  lexicalCount: 0,
  semanticCount: 0,
  fusedCount: 0,
  envelopeConstraints: 1,
  degraded: { lexical: "OK", semantic: "OK" },
} as unknown as AuthorisedRetrievalResult;

type Asked = { readonly subjectType: string; readonly subjectId: string };

function build(planned: PermittedContextPlan) {
  const asked: Asked[] = [];
  const knowledge = {
    currentForSubject: (_scope: unknown, subject: Asked) => {
      asked.push(subject);
      return Promise.resolve([]);
    },
  } as unknown as KnowledgeQueryService;

  const wired = createQEvidenceRetrieval({
    sql: {} as never,
    repositories: {
      messages: {
        listRecentForConversationOfRun: () =>
          Promise.resolve([
            { role: "USER", content: "what do you know about me?" },
          ]),
      },
    } as never,
    retrieval: { retrieve: () => Promise.resolve(emptyResult) } as never,
    hydration: { countAuthorised: () => Promise.resolve(0) } as never,
    knowledge,
  });

  return {
    asked,
    assemble: () =>
      wired.context.assemble({
        runId: planned.runId,
        tenantId: planned.tenantId as never,
        plan: planned,
      }),
  };
}

describe("what Capital Q understands, read back by subject", () => {
  it("asks about the person themselves, not only their company", async () => {
    const { asked, assemble } = build(
      plan({
        subjects: [
          { kind: "COMPANY", companyId: COMPANY },
          { kind: "USER", userId: ACTOR },
        ],
      }),
    );
    await assemble();
    expect(asked).toEqual([
      { subjectType: "COMPANY", subjectId: COMPANY },
      { subjectType: "PERSON", subjectId: ACTOR },
    ]);
  });

  it("asks about an investor organisation the plan named", async () => {
    const { asked, assemble } = build(
      plan({
        subjects: [
          {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: INVESTOR_ORG,
          },
        ],
      }),
    );
    await assemble();
    expect(asked).toEqual([
      { subjectType: "INVESTOR_ORGANISATION", subjectId: INVESTOR_ORG },
    ]);
  });

  it("asks nothing about a subject an understanding cannot be about", async () => {
    // A document is evidence, not something Capital Q holds a reading of.
    const { asked, assemble } = build(
      plan({ subjects: [{ kind: "DOCUMENT", documentId: DOCUMENT }] }),
    );
    await assemble();
    expect(asked).toEqual([]);
  });
});
