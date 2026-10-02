import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
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
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { ownStandingFact } from "../src/q/own-standing.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Q always knows who it is talking to (founder report 2026-10-01: on
 * Discover, "am I interested in this company?" was answered "I don't
 * know" a minute after the investor had saved and passed on it). Their
 * own standing is read through list_my_relationships on every turn and
 * placed among the facts, the on-screen company's line first; and the
 * guidance tells Q to answer the question behind a "no".
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const RELATIONSHIP = randomUUID();

const RELATIONSHIP_TOOL: QOfferedTool = {
  toolName: "relationship.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_relationship",
    description: "Where the person's own side stands with a counterparty.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_RELATIONSHIP",
};

const STANDING_TOOL: QOfferedTool = {
  ...RELATIONSHIP_TOOL,
  toolName: "relationship.list_mine",
  definition: {
    name: "list_my_relationships",
    description: "The person's own relationships, saves and passes.",
    inputJsonSchema: { type: "object", properties: {} },
  },
};

const COMPANY_TOOL: QOfferedTool = {
  ...RELATIONSHIP_TOOL,
  toolName: "company.get",
  definition: {
    name: "get_company",
    description: "The canonical profile of one company.",
    inputJsonSchema: { type: "object", properties: {} },
  },
};
const ON_SCREEN = {
  companyId: COMPANY,
  canonicalName: "Ajopot",
  legalName: null,
  websiteUrl: null,
  foundedDate: null,
  headquartersCountry: "NG",
  headquartersCity: "Lagos",
  currentStageCode: "SEED",
  shortDescription: "Digital savings circles.",
  primaryDescription: null,
  companyStatus: "ACTIVE",
  relationToYou: "SHARED",
  truthClass: "USER_CLAIM",
};

const DAILY_TOOL: QOfferedTool = {
  ...RELATIONSHIP_TOOL,
  toolName: "q_daily.get",
  definition: {
    name: "get_q_daily",
    description: "Their latest edition of The Q Daily.",
    inputJsonSchema: { type: "object", properties: {} },
  },
};
const DAILY = {
  status: "READY",
  editionDate: "2026-10-01",
  number: 12,
  href: "/daily",
  headlines: [
    {
      section: "Deals",
      headline: "Nigerian start-ups raised $364.1m",
      publisher: "TechCabal",
    },
  ],
  qTake: "Funding is tightening around accountability.",
  frequency: "DAILY",
  email: false,
  sections: [],
  nextDueAt: null,
};

const OTHER = randomUUID();
const STANDING = {
  yourSide: "INVESTOR",
  relationships: [
    {
      relationshipId: RELATIONSHIP,
      counterpart: { kind: "COMPANY", id: OTHER, name: "Kora" },
      state: "INTEREST_EXPRESSED",
      stateSince: "2026-09-24T10:00:00.000Z",
      milestones: [],
      nextStep: "AWAIT_ANSWER",
    },
  ],
  saved: [{ companyId: OTHER, name: "Kora", stageCode: null }],
  passed: [{ companyId: COMPANY, name: "Ajopot", stageCode: null }],
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
};

const CONNECTED = {
  yourSide: "INVESTOR",
  counterpart: { kind: "COMPANY", id: COMPANY, name: "Kora" },
  relationship: {
    state: "CONNECTED",
    stateSince: "2026-09-25T11:00:00.000Z",
    milestones: [
      { state: "DISCOVERED", at: "2026-09-20T09:00:00.000Z" },
      { state: "INTEREST_EXPRESSED", at: "2026-09-24T10:00:00.000Z" },
      { state: "CONNECTED", at: "2026-09-25T11:00:00.000Z" },
    ],
    nextStep: "SCHEDULE_MEETING",
  },
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
};

type Subject =
  | { readonly kind: "COMPANY"; readonly companyId: string }
  | { readonly kind: "RELATIONSHIP"; readonly relationshipId: string };

function build(
  read: { status: "SUCCEEDED" | "DENIED"; data?: unknown },
  subject: Subject = { kind: "COMPANY", companyId: COMPANY },
  deps: Partial<Parameters<typeof createModelGatewayQAnswer>[0]> = {},
  scene: { readonly said?: string; readonly standing?: unknown } = {},
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "You connected with Kora on 25 September.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        }),
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
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: scene.said ?? "Where are we with Kora?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const inFlight = { now: 0, max: 0 };
  const reads = { history: 0 };
  const tools: QToolPort = {
    offer: () =>
      Promise.resolve([
        RELATIONSHIP_TOOL,
        STANDING_TOOL,
        COMPANY_TOOL,
        DAILY_TOOL,
      ]),
    execute: async (proposal) => {
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight.now -= 1;
      executed.push(proposal);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "relationship.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: read.status,
        failureCode: read.status === "DENIED" ? "NOT_AVAILABLE" : null,
        sensitivity: read.status === "DENIED" ? null : "CONFIDENTIAL",
        result:
          read.status === "DENIED"
            ? {
                ok: false,
                error: {
                  code: "NOT_AVAILABLE",
                  message: "Not available in this conversation's context.",
                },
              }
            : {
                ok: true,
                data:
                  proposal.name === "list_my_relationships"
                    ? (scene.standing ?? STANDING)
                    : proposal.name === "get_company"
                      ? ON_SCREEN
                      : proposal.name === "get_q_daily"
                        ? DAILY
                        : read.data,
              },
        latencyMs: 2,
      } as QToolCallOutcome;
      return outcome;
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => {
        reads.history += 1;
        return Promise.resolve([...messages]);
      },
      insert: (_tx: unknown, input: { content: string }) =>
        Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    ...deps,
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [subject],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: {
        capability: "ANSWER",
        taskClass:
          subject.kind === "RELATIONSHIP"
            ? "RELATIONSHIP_QUESTION"
            : "COUNTERPARTY_COMPANY_QUESTION",
      },
      subjects: [subject],
      scopes: [
        {
          kind:
            subject.kind === "RELATIONSHIP"
              ? "RELATIONSHIP_CONTEXT"
              : "COMPANY_PROFILE",
          subject,
        },
      ],
      denied: [],
      // The test catalogue routes PUBLIC only, as the own-profile test does.
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, inFlight, reads };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("Q knows who it is talking to", () => {
  it("reads their own standing on a turn about a company and states the on-screen company's line first", async () => {
    // No relationship row with the on-screen company: only a pass.
    const { seam, request, alpha, executed } = build({
      status: "SUCCEEDED",
      data: { ...CONNECTED, relationship: null },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name).sort()).toEqual([
      // The on-screen company, and Kora, which the question names and
      // which is one of their own (founder live 2026-10-01, P0-3).
      "get_company",
      "get_company",
      "get_relationship",
      "list_my_relationships",
    ]);
    expect(
      executed
        .filter((call) => call.callId.startsWith("q-named-company"))
        .map((call) => call.arguments),
    ).toEqual([{ companyId: OTHER }]);
    // The company on their screen is known before the model is asked
    // (speed sweep 2026-10-01: "this company is not identified").
    expect(
      executed.find((call) => call.callId === "q-on-screen-company")?.arguments,
    ).toEqual({ companyId: COMPANY });
    const sent = sentTo(alpha);
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain(
      "About Ajopot: no interest expressed and no relationship yet; passed on in Discover.",
    );
    // From their own side: their interest, waiting for Kora (live
    // 2026-10-02: said backwards as Kora awaiting their response).
    expect(facts).toContain(
      "you expressed interest; waiting for them to accept (nothing for you to answer): Kora",
    );
    expect(facts).toContain("Requests waiting for them to answer: none.");
    expect(facts).toContain("Saved in Discover: Kora.");
    expect(facts).toContain(
      "The company on their screen (the one they mean by",
    );
    expect(facts).toContain("Ajopot -- stage SEED; based in Lagos, NG.");
    expect(facts).toContain(
      "As the company describes itself: Digital savings circles.",
    );
    // The guidance: answer the question behind a "no", and do the
    // expressive thing asked for rather than an emoji.
    expect(sent).toContain("ANSWER WHAT THEY MEAN");
    expect(sent).toContain("never a bare emoji");
  });
});

describe("the reads before the model run side by side", () => {
  // Speed sweep 2026-10-01: one after another they took ~0.6 s of the
  // wait before the model was asked anything.
  it("reads the relationship and their own standing at the same time", async () => {
    const { seam, request, inFlight } = build({
      status: "SUCCEEDED",
      data: CONNECTED,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(inFlight.max).toBeGreaterThanOrEqual(2);
  });
});

describe("a turn warmed while it is read", () => {
  it("is answered from the reads already started, without reading again", async () => {
    const { seam, request, executed, reads } = build({
      status: "SUCCEEDED",
      data: CONNECTED,
    });
    seam.warm?.(request);
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(reads.history).toBe(1);
    expect(
      executed.filter((call) => call.name === "list_my_relationships"),
    ).toHaveLength(1);
  });

  it("reads for itself when nothing was warmed", async () => {
    const { seam, request, reads } = build({
      status: "SUCCEEDED",
      data: CONNECTED,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(reads.history).toBe(1);
  });
});

describe("ownStandingFact", () => {
  it("says what is on record for the focus and never turns a save into interest", () => {
    const fact = ownStandingFact(STANDING, OTHER);
    expect(fact?.statement).toContain(
      "About Kora: you expressed interest in them and are waiting for them to accept; there is no request from them for you to accept; saved in Discover (a save is not interest).",
    );
  });

  // Live 2026-10-02 (Zino): his own interests were said as theirs, and
  // a connected company as a pending request.
  it("says who waits for whom from each side, from the current state", () => {
    const investor =
      ownStandingFact(
        {
          yourSide: "INVESTOR",
          relationships: [
            {
              counterpart: { kind: "COMPANY", id: "t", name: "Tallyloom" },
              state: "INTEREST_EXPRESSED",
            },
            {
              counterpart: { kind: "COMPANY", id: "y", name: "Yamfield Agro" },
              state: "CONNECTED",
            },
          ],
          saved: [],
          passed: [],
        },
        "t",
      )?.statement ?? "";
    expect(investor).toContain(
      "About Tallyloom: you expressed interest in them and are waiting for them to accept; there is no request from them for you to accept",
    );
    expect(investor).toContain("connected (both sides agreed): Yamfield Agro");
    expect(investor).toContain("Requests waiting for them to answer: none.");

    const founder =
      ownStandingFact(
        {
          yourSide: "COMPANY",
          relationships: [
            {
              counterpart: {
                kind: "INVESTOR_ORGANISATION",
                id: "z",
                name: "Zino Aviation",
              },
              state: "INTEREST_EXPRESSED",
            },
          ],
          saved: [],
          passed: [],
        },
        null,
      )?.statement ?? "";
    expect(founder).toContain(
      "they expressed interest in your company; waiting for YOU to accept or decline: Zino Aviation",
    );
    expect(founder).toContain(
      "Requests waiting for them to answer: Zino Aviation.",
    );
  });

  it("states a founder's side without investor-only buckets", () => {
    const fact = ownStandingFact(
      {
        yourSide: "COMPANY",
        relationships: [],
        saved: [],
        passed: [],
      },
      null,
    );
    expect(fact?.statement).toContain(
      "No investor has expressed interest in their company yet.",
    );
    expect(fact?.statement).not.toContain("Saved in Discover");
  });

  it("bounds a long pipeline and adds nothing for a person on neither side", () => {
    const many = Array.from({ length: 30 }, (_, n) => ({
      companyId: randomUUID(),
      name: `Co${String(n)}`,
      stageCode: null,
    }));
    const fact = ownStandingFact(
      { ...STANDING, saved: many, passed: [] },
      null,
    );
    expect(fact?.statement).toContain("and 22 more");
    expect(
      ownStandingFact(
        { yourSide: "NONE", relationships: [], saved: [], passed: [] },
        null,
      ),
    ).toBeNull();
  });
});

describe("Q calls them by their profile name (founder live 2026-10-01)", () => {
  it("an overheard 'Neo' in what is remembered never wins over the profile name 'Zino'", async () => {
    const { seam, request, alpha } = build(
      { status: "SUCCEEDED", data: CONNECTED },
      undefined,
      {
        askerOf: () => Promise.resolve("Zino."),
        memory: {
          recall: () => Promise.resolve("- The name is Neo, spelled N-E-U."),
        },
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const sent = sentTo(alpha);
    // Their profile name leads, and the rule that it is the only name
    // Q uses travels with it, ahead of what is remembered.
    expect(sent).toContain("WHO IS ASKING: Zino.");
    expect(sent).toContain(
      "Call them only by the name given first here: a name in memory or said in the conversation never replaces it",
    );
    expect(sent.indexOf("WHO IS ASKING: Zino.")).toBeLessThan(
      sent.indexOf("The name is Neo"),
    );
  });
});

describe("The Q Daily on their screen is read before the model (founder live 2026-10-01)", () => {
  it("states today's edition among the facts when they ask from /daily, and not elsewhere", async () => {
    const daily = build({ status: "SUCCEEDED", data: CONNECTED });
    const onDaily = {
      ...daily.request,
      plan: { ...daily.request.plan, screen: { route: "DAILY" } },
    } as typeof daily.request;
    expect((await daily.seam.answer(onDaily)).kind).toBe("ANSWERED");
    const facts = sentTo(daily.alpha);
    expect(facts).toContain("The Q Daily on their screen");
    expect(facts).toContain(
      "[Deals] Nigerian start-ups raised $364.1m (reported by TechCabal)",
    );
    expect(facts).toContain("Q's take (Q's own inference, not reported fact)");

    const home = build({ status: "SUCCEEDED", data: CONNECTED });
    await home.seam.answer(home.request);
    expect(home.executed.map((call) => call.name)).not.toContain("get_q_daily");
  });
});

describe("TALUM is Tallyloom, and his own interest is not a request to accept (live 2026-10-02)", () => {
  it("states Tallyloom's direction as the turn's focus for the founder's exact line", async () => {
    const TALLYLOOM = randomUUID();
    const { seam, request, alpha } = build(
      { status: "SUCCEEDED", data: { ...CONNECTED, relationship: null } },
      undefined,
      {},
      {
        said: "Accept TALUM and send them a message. You can book a meeting with them too.",
        standing: {
          yourSide: "INVESTOR",
          relationships: [
            {
              relationshipId: randomUUID(),
              counterpart: {
                kind: "COMPANY",
                id: TALLYLOOM,
                name: "Tallyloom (fictional)",
              },
              state: "INTEREST_EXPRESSED",
              stateSince: "2026-10-01T10:00:00.000Z",
              milestones: [],
              nextStep: "AWAIT_ANSWER",
            },
          ],
          saved: [],
          passed: [],
          truthClass: "VERIFIED",
          source: "Capital Q relationship history",
        },
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const sent = sentTo(alpha);
    expect(sent).toContain(
      "About Tallyloom (fictional): you expressed interest in them and are waiting for them to accept; there is no request from them for you to accept",
    );
    expect(sent).toContain("Requests waiting for them to answer: none.");
    expect(sent).toContain("the other side hasn't answered yet");
  });
});

/**
 * HARDEN with QA's ADR 0040 (2026-10-02): Q never says "no record" of
 * something the person has -- WHAT EXISTS rides on every turn -- and never
 * says "can't" without looking; a turn that asked Q to act and did nothing
 * is logged as q.parity_gap.
 */
describe("what exists, and the parity gap", () => {
  const capture = () => {
    const warned: { data: unknown; message: string }[] = [];
    const logger = {
      info: () => undefined,
      debug: () => undefined,
      error: () => undefined,
      warn: (data: unknown, message: string) => warned.push({ data, message }),
      child: () => logger,
    };
    return { warned, logger: logger as never };
  };

  it("puts WHAT EXISTS in the facts and the check-before-can't line in the note", async () => {
    const { seam, request, alpha } = build(
      { status: "SUCCEEDED", data: CONNECTED },
      undefined,
      {
        ownIndex: () =>
          Promise.resolve({
            kinds: [
              {
                kind: "DOCUMENTS",
                label: "Documents",
                total: 3,
                titles: ["Nixo deck v2", "Investor brief", "Q report"],
              },
              { kind: "MEETINGS", label: "Meetings", total: 0, titles: [] },
            ],
          }),
      },
    );
    await seam.answer(request);
    const sent = sentTo(alpha);
    expect(sent).toContain(
      "WHAT EXISTS on the person's own account (counts, read for them this turn; read any of it with read_my): Documents: 3 (Nixo deck v2; Investor brief; Q report). Meetings: 0.",
    );
    expect(sent).toContain("CHECK BEFORE NO OR CAN'T");
  });

  it("logs q.parity_gap when they asked Q to act and the answer did nothing", async () => {
    const { warned, logger } = capture();
    const { seam, request } = build(
      { status: "SUCCEEDED", data: CONNECTED },
      undefined,
      { logger },
    );
    await seam.answer({ ...request, turnKind: "TOOL_REQUEST" });
    const gap = warned.find((entry) => entry.message === "q.parity_gap");
    expect(gap?.data).toMatchObject({ key: "q.parity_gap" });
  });

  it("names the kind of miss from the declaration name: not in the registry, declared but not offered, not called", async () => {
    const kinds: unknown[] = [];
    for (const askedAction of [undefined, "pass_company", "get_q_daily"]) {
      const { warned, logger } = capture();
      const { seam, request } = build(
        { status: "SUCCEEDED", data: CONNECTED },
        undefined,
        { logger },
      );
      await seam.answer({
        ...request,
        turnKind: "TOOL_REQUEST",
        ...(askedAction === undefined ? {} : { askedAction }),
      });
      kinds.push(
        warned.find((entry) => entry.message === "q.parity_gap")?.data,
      );
    }
    expect(kinds).toEqual([
      expect.objectContaining({ gap: "NOT_IN_REGISTRY", declaration: null }),
      expect.objectContaining({
        gap: "DECLARED_NOT_OFFERED",
        declaration: "pass_company",
      }),
      // Offered this run, and the answer never called it.
      expect.objectContaining({
        gap: "NOT_CALLED",
        declaration: "get_q_daily",
      }),
    ]);
  });

  it("does not log a gap for a question", async () => {
    const { warned, logger } = capture();
    const { seam, request } = build(
      { status: "SUCCEEDED", data: CONNECTED },
      undefined,
      { logger },
    );
    await seam.answer({ ...request, turnKind: "QUESTION_TO_Q" });
    expect(warned.some((entry) => entry.message === "q.parity_gap")).toBe(
      false,
    );
  });
});

describe("ownIndexFact", () => {
  it("is compact: three titles at most, long ones cut, nothing for an empty index", async () => {
    const { ownIndexFact } = await import("../src/q/own-standing.js");
    expect(ownIndexFact(null)).toBe(null);
    expect(ownIndexFact({ kinds: [] })).toBe(null);
    const fact = ownIndexFact({
      kinds: [
        {
          kind: "RELATIONSHIPS",
          label: "Relationships",
          total: 5,
          titles: ["Nixo", "Tallyloom", "Kazikit", "Yamfield"],
        },
      ],
    });
    expect(fact?.statement).toContain(
      "Relationships: 5 (Nixo; Tallyloom; Kazikit; …)",
    );
  });
});
