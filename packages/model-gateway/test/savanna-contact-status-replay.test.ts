import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  QAccountDigestSchema,
  type PermittedContextPlan,
  type QAccountDigest,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  contactStagesOf,
  contactStatusAnswer,
  contactSubjectsOf,
  inContactOf,
} from "../src/q/in-contact.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 18 Nov 2026, 15:04 UTC, fictional investor Savanna (conversation
 * 5834af20, production b204eb954). Replayed from the stored turns, cards and
 * relationships read (relationship.own.list, run cce59657); fake model, no
 * provider, no network.
 *
 * 15:04:22 "Apart from the companies I'm already in contact with, which
 * three match my mandate the most?" was answered rightly: 15 contacts left
 * out; Ledgerline 8.7, Brancheon Works 6.3, Baridi 6.2. 15:04:34 "Am I in
 * contact with any of those?" was read THEIR_OWN_RECORDS with the three
 * bound as references; the bound places alone built a side-by-side table,
 * and the answer opened "On Capital Q's mandate fit, Ledgerline leads".
 */

const NOW = new Date("2026-11-18T15:04:34.772Z");
const INVESTOR_ORG = "1c4b9266-350c-409d-9582-04a0f771b8a8";
const LEDGERLINE = "6f075a0b-8372-4458-9060-09afd73a9c37";
const BRANCHEON = "5be654c3-eb80-4bdf-aa5a-9cb29c521dbe";
const BARIDI = "7e5a7a76-857a-4528-9641-08c7bab9cc22";

/** The cards Q showed at 15:04:27, in order. */
const SHOWN: readonly [string, string][] = [
  [LEDGERLINE, "Ledgerline"],
  [BRANCHEON, "Brancheon Works"],
  [BARIDI, "Baridi"],
];

/** Savanna's relationships as relationship.own.list returned them at 15:04. */
const RELATIONSHIPS: readonly [string, string, RelationshipStateV2][] = [
  ["d48c26d2-5aca-4788-9033-073b0f9d08ec", "Nixo", "IN_DILIGENCE"],
  ["526c2d72-9142-4e48-b106-ee4910f19318", "Watchly", "IN_DILIGENCE"],
  [
    "51d644d0-887a-400d-9ea7-98a92d28d84a",
    "Kivu Traceworks",
    "INTEREST_EXPRESSED",
  ],
  ["9e95c9b6-49ff-4563-a563-db0a0021c232", "Sahel Pumps", "INTEREST_EXPRESSED"],
  ["ceb6ec2d-4a4a-41a2-9b71-377d72c26407", "Harbourline Cargo", "CONNECTED"],
  ["bf55d6e1-567a-470b-954d-054ae05990e2", "Tensorgate", "IN_DILIGENCE"],
  ["37b0c9a0-c160-406e-9b83-04496665965d", "Brightkloof Energy", "CONNECTED"],
  ["b439cd80-55d4-491a-922f-95650c38a056", "Nsuo Labs", "CONNECTED"],
  ["94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3", "Tarmacly", "CONNECTED"],
  ["01c554bf-8bf1-4eb7-b460-5d841764c40b", "Maji Loop", "IN_DILIGENCE"],
  ["6b2f9851-d7e3-4197-9fd1-beffbdc153fe", "Clinicrest", "CONNECTED"],
  ["40b1e42b-8b81-45ac-bacd-688c70852b17", "Tallyloom", "CONNECTED"],
  ["8e2c40e7-d1e2-4063-a179-abdea4f0cd83", "Kazikit", "INTEREST_EXPRESSED"],
  ["91de2a77-fe47-4af0-8534-d9abf9c55949", "Ajopot", "IN_DILIGENCE"],
  ["84b9641f-b618-4fa3-8b35-1d19b1c71d82", "Ledgerfold", "CONNECTED"],
];

const LIVE_ANSWER =
  "No. You're not in contact with Ledgerline, Brancheon Works or Baridi; none has a relationship with you yet.";

function digestOf(
  relationships: readonly [string, string, RelationshipStateV2][],
): QAccountDigest {
  return QAccountDigestSchema.parse({
    side: "INVESTOR",
    relationships: [],
    relationshipsTotal: relationships.length,
    byStage: {},
    relationshipCounterpartIds: relationships.map(([id]) => id),
    relationshipStages: relationships.map(([id, name, stage]) => ({
      counterpartId: id,
      name,
      stage,
    })),
    waiting: [],
    waitingTotal: 0,
    meetings: [],
    work: [],
    requests: [],
    gateq: null,
    recent: [],
    unread: [],
    readAt: NOW.toISOString(),
  });
}

const ownList = (
  relationships: readonly [string, string, RelationshipStateV2][],
) => ({
  relationships: relationships.map(([id, name, state]) => ({
    state,
    counterpart: { kind: "COMPANY", id, name },
  })),
  // Brancheon Works is saved: a bookmark, never contact.
  saved: [{ name: "Brancheon Works", companyId: BRANCHEON }],
});

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

const OFFERED = [
  offered("list_my_relationships", "relationship.own.list"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("fit_profile", "fit.profile"),
];

function outcome(
  proposal: QToolProposal,
  relationships: readonly [string, string, RelationshipStateV2][],
): QToolCallOutcome {
  const companyId = String(
    Reflect.get(proposal.arguments as object, "companyId"),
  );
  const name = SHOWN.find(([id]) => id === companyId)?.[1] ?? "?";
  const base = {
    callId: proposal.callId,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "CONFIDENTIAL",
    latencyMs: 1,
  } as const;
  if (proposal.name === "list_my_relationships") {
    return {
      ...base,
      toolName: "relationship.own.list",
      result: { ok: true, data: ownList(relationships) },
    } as unknown as QToolCallOutcome;
  }
  if (proposal.name === "get_company") {
    return {
      ...base,
      toolName: "company.get",
      result: {
        ok: true,
        data: {
          companyId,
          canonicalName: name,
          legalName: null,
          websiteUrl: null,
          foundedDate: null,
          headquartersCountry: "NG",
          headquartersCity: "Lagos",
          currentStageCode: "seed",
          shortDescription: `${name} does one thing well.`,
          primaryDescription: null,
          companyStatus: "active",
          relationToYou: "SHARED",
          truthClass: "USER_CLAIM",
        },
      },
    } as unknown as QToolCallOutcome;
  }
  if (proposal.name === "read_company_figures") {
    return {
      ...base,
      toolName: "company.figures.read",
      result: { ok: true, data: { companyId, status: "NONE", figures: [] } },
    } as unknown as QToolCallOutcome;
  }
  return {
    ...base,
    ...fitFixture(
      companyId,
      name,
      companyId === LEDGERLINE
        ? { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "PARTIAL" }
        : { STAGE: "STRONG", SECTOR: "PARTIAL", GEOGRAPHY: "PARTIAL" },
    ),
  };
}

function build(
  said: string,
  relationships: readonly [
    string,
    string,
    RelationshipStateV2,
  ][] = RELATIONSHIPS,
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer:
            "Ledgerline is in Lagos; Brancheon Works and Baridi are earlier.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
        },
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const run = randomUUID();
  const conversation = randomUUID();
  const at = NOW.toISOString();
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: randomUUID(),
      role: "USER",
      content:
        "Apart from the companies I'm already in contact with, which three match my mandate the most?",
      contentType: "TEXT",
      createdAt: at,
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: randomUUID(),
      role: "Q",
      content:
        "I've left out the 15 companies you're already in touch with. Right, top three for your mandate: Ledgerline at 8.7; then Brancheon Works at 6.3; then Baridi at 6.2. They're on screen. Want me to go through one?",
      contentType: "TEXT",
      blocks: [
        {
          kind: "ANSWER_CARDS",
          cards: SHOWN.map(([companyId, name]) => ({
            name,
            subject: { kind: "COMPANY", companyId },
          })),
        },
      ],
      createdAt: at,
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: at,
    },
  ] as unknown as QConversationMessage[];
  const executed: QToolProposal[] = [];
  const stored: { content: string; blocks?: readonly unknown[] }[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve(outcome(proposal, relationships));
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { content: string; blocks?: readonly unknown[] },
      ) => {
        stored.push(input);
        return Promise.resolve({
          ...messages[2],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(digestOf(relationships)),
    now: () => NOW,
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [
        { kind: "OWN_Q_CONVERSATION" },
        {
          kind: "INVESTOR_MANDATE",
          subject: {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: INVESTOR_ORG,
          },
        },
      ],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, stored };
}

/** The reading at 15:04:37 (q turn read), as the answer received it. */
const LIVE_READING = {
  turnKind: "QUESTION_TO_Q",
  questionKind: "THEIR_OWN_RECORDS",
  executionClass: "CONTEXTUAL_FOLLOW_UP",
  navigationDestination: "RELATIONSHIPS",
  referencedCompanyIds: [LEDGERLINE, BRANCHEON, BARIDI],
} as const;

const tableIn = (blocks: readonly unknown[] | undefined) =>
  (blocks ?? []).find(
    (block) => Reflect.get(block as object, "kind") === "TABLE",
  );

const compareReads = (executed: readonly QToolProposal[]) =>
  executed.filter((call) => call.callId.startsWith("q-compare-"));

describe("Savanna 15:04:34 replayed: 'Am I in contact with any of those?'", () => {
  it("is answered from the in-contact rule, naming each company: no table, no model call", async () => {
    const { seam, request, alpha, executed, stored } = build(
      "Am I in contact with any of those?",
    );
    // The prepare is warmed on the words, before the turn is read.
    seam.warm?.(request);
    const outcome = await seam.answer({
      ...request,
      ...LIVE_READING,
      contactStatusAsked: true,
    });
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    expect(compareReads(executed)).toEqual([]);
    const last = stored.at(-1);
    expect(last?.content).toBe(LIVE_ANSWER);
    expect(tableIn(last?.blocks)).toBeUndefined();
    expect(last?.content).not.toMatch(/mandate fit|leads|Side by side/u);
  });

  it("root cause: the reading of 15:04 (no comparison heard) never builds a table from the bound places alone", async () => {
    const { seam, request, executed, stored } = build(
      "Am I in contact with any of those?",
    );
    seam.warm?.(request);
    await seam.answer({ ...request, ...LIVE_READING });
    expect(compareReads(executed)).toEqual([]);
    expect(tableIn(stored.at(-1)?.blocks)).toBeUndefined();
    expect(stored.at(-1)?.content ?? "").not.toMatch(
      /On Capital Q's mandate fit, Ledgerline leads/u,
    );
  });

  for (const said of [
    "Have I spoken to any of them?",
    "Are any of these already in my pipeline?",
    "Which of those am I already talking to?",
  ]) {
    it(`a paraphrase, "${said}", gets the same answer`, async () => {
      const { seam, request, alpha, stored } = build(said);
      seam.warm?.(request);
      await seam.answer({
        ...request,
        ...LIVE_READING,
        contactStatusAsked: true,
      });
      expect(alpha.calls).toHaveLength(0);
      expect(stored.at(-1)?.content).toBe(LIVE_ANSWER);
    });
  }

  it("with no reference bound, 'any of them' means every company on Q's newest cards", async () => {
    const { seam, request, alpha, stored } = build(
      "Have I spoken to any of them?",
    );
    await seam.answer({
      ...request,
      turnKind: "QUESTION_TO_Q",
      questionKind: "THEIR_OWN_RECORDS",
      contactStatusAsked: true,
    });
    expect(alpha.calls).toHaveLength(0);
    expect(stored.at(-1)?.content).toBe(LIVE_ANSWER);
  });

  it("one of them in contact: it is named with its stage, the others plainly not", async () => {
    const { seam, request, stored } = build(
      "Are any of these already in my pipeline?",
      [...RELATIONSHIPS, [LEDGERLINE, "Ledgerline", "IN_DILIGENCE"]],
    );
    await seam.answer({
      ...request,
      ...LIVE_READING,
      contactStatusAsked: true,
    });
    expect(stored.at(-1)?.content).toBe(
      "Yes, one of them. You're in contact with Ledgerline (in diligence). You're not in contact with Brancheon Works or Baridi yet.",
    );
  });

  it("negative: 'how do those compare?' still gets the comparison table", async () => {
    const { seam, request, alpha, executed, stored } = build(
      "How do those compare?",
    );
    seam.warm?.(request);
    await seam.answer({
      ...request,
      turnKind: "QUESTION_TO_Q",
      questionKind: "THEIR_OWN_RECORDS",
      referencedCompanyIds: [LEDGERLINE, BRANCHEON, BARIDI],
      compare: { count: null, names: [] },
    });
    expect(compareReads(executed).length).toBeGreaterThan(0);
    expect(alpha.calls.length).toBeGreaterThan(0);
    const table = tableIn(stored.at(-1)?.blocks) as
      { columns: { label: string }[] } | undefined;
    expect(table?.columns.map((column) => column.label)).toEqual([
      "Ledgerline",
      "Brancheon Works",
      "Baridi",
    ]);
  });
});

describe("the contact-status answer (in-contact.ts), by code", () => {
  const contact = inContactOf(digestOf(RELATIONSHIPS), ownList(RELATIONSHIPS));
  const stages = contactStagesOf(
    digestOf(RELATIONSHIPS),
    ownList(RELATIONSHIPS),
  );
  const subjects = SHOWN.map(([id, name]) => ({ id, name }));

  it("says no for each, by name, when none is in contact (a saved company is not contact)", () => {
    expect(contactStatusAnswer(subjects, contact, stages)).toBe(LIVE_ANSWER);
  });

  it("says yes with every stage when all are in contact", () => {
    const all = RELATIONSHIPS.slice(0, 2).map(([id, name]) => ({ id, name }));
    expect(contactStatusAnswer(all, contact, stages)).toBe(
      "Yes, both. You're in contact with Nixo (in diligence) and Watchly (in diligence).",
    );
  });

  it("a company only discovered is said as seen, never as contact", () => {
    const seen = contactStagesOf(
      digestOf([[BARIDI, "Baridi", "DISCOVERED"]]),
      null,
    );
    expect(
      contactStatusAnswer(
        [{ id: BARIDI, name: "Baridi" }],
        inContactOf(digestOf([[BARIDI, "Baridi", "DISCOVERED"]])),
        seen,
      ),
    ).toBe(
      "No. You're not in contact with Baridi; Baridi is only discovered so far, with no contact yet.",
    );
  });

  it("subjects: bound ids are named from the cards; an unnamed id or a named other goes the full way", () => {
    const shown = SHOWN.map(([companyId, name]) => ({ companyId, name }));
    expect(
      contactSubjectsOf({
        referenced: [BARIDI],
        shown,
        namedOther: false,
        digest: null,
      }),
    ).toEqual([{ id: BARIDI, name: "Baridi" }]);
    expect(
      contactSubjectsOf({
        referenced: ["00000000-0000-4000-8000-0000000000ff"],
        shown,
        namedOther: false,
        digest: null,
      }),
    ).toBeNull();
    expect(
      contactSubjectsOf({
        referenced: [],
        shown,
        namedOther: true,
        digest: null,
      }),
    ).toBeNull();
  });
});
