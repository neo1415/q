import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
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
  createModelGatewayQAnswer,
  ownOnboardingFacts,
  type OwnOnboarding,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Home Q knows who it is talking to, from their own setup (CQ-QX-007;
 * fixture conversation 64aab371: "I cannot determine who you are from the
 * authorised profile"). The person's own onboarding reaches the answer as
 * facts — only when the firewall granted OWN_ONBOARDING.
 */

const RUN = randomUUID();

const ZINO: OwnOnboarding = {
  name: "Zino Mario",
  journeys: [
    {
      journeyType: "investor",
      status: "ACTIVE",
      role: "Founder",
      answeredCount: 19,
      eligibleCount: 33,
      currentStep: "Anything else you look for?",
      answered: ["How do you invest?", "Your firm", "Your role there"],
      open: ["Where do you invest?", "Which sectors and product areas?"],
    },
  ],
};

describe("the person's own onboarding as facts", () => {
  it("states who they are and how far along, as facts, not prose", () => {
    const facts = ownOnboardingFacts(ZINO);
    expect(facts.map((fact) => fact.scope)).toEqual([
      "OWN_ONBOARDING",
      "OWN_ONBOARDING",
    ]);
    expect(facts[0]?.statement).toBe(
      "The person's name on Capital Q: Zino Mario.",
    );
    const journey = facts[1]?.statement ?? "";
    expect(journey).toContain("investor setup, in progress");
    expect(journey).toContain("role they gave: Founder");
    expect(journey).toContain("19 of 33 questions answered");
    expect(journey).toContain(
      'the question they are on: "Anything else you look for?"',
    );
    expect(journey).toContain('not answered yet: "Where do you invest?"');
    for (const fact of facts) {
      expect(fact.truthClass).toBe("USER_CLAIM");
      expect(fact.evidenceStatus).toBe("SELF_REPORTED");
    }
  });

  it("a completed setup is stated as complete, never as progress", () => {
    for (const completedBy of ["SESSION", "ACTIVE_MANDATE"] as const) {
      const journey = ZINO.journeys[0];
      if (journey === undefined) throw new Error("fixture");
      const facts = ownOnboardingFacts({
        ...ZINO,
        journeys: [{ ...journey, status: "COMPLETED", completedBy }],
      });
      const statement = facts[1]?.statement ?? "";
      expect(statement).toContain("investor setup, completed");
      expect(statement).not.toContain("in progress");
      expect(statement).not.toContain(" of 33 ");
      expect(statement).not.toContain("the question they are on");
      expect(statement).not.toContain("not answered yet");
      expect(statement).toContain('"Where do you invest?"');
      expect(statement.includes("mandate is active")).toBe(
        completedBy === "ACTIVE_MANDATE",
      );
    }
  });

  it("says nothing when nothing is on record", () => {
    expect(ownOnboardingFacts({ name: null, journeys: [] })).toEqual([]);
  });
});

function build(granted: boolean) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer: "You're Zino, an angel investor part way through setup.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        },
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: randomUUID(),
      runId: RUN,
      role: "USER",
      content: "According to my profile, who am I?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
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
  const reads: unknown[] = [];
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    ownOnboarding: {
      read: (actor) => {
        reads.push(actor.userId);
        return Promise.resolve(ZINO);
      },
    },
  });
  const plan = {
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: granted ? [{ kind: "OWN_ONBOARDING" }] : [],
    denied: [],
    maxSensitivity: "PUBLIC",
  } as unknown as PermittedContextPlan;
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
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, reads };
}

describe("Home Q reads the person's own onboarding", () => {
  it("puts it among the authorised facts when the firewall granted it", async () => {
    const { seam, request, alpha, reads } = build(true);
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(reads).toEqual([USER]);
    const sent = alpha.calls
      .flatMap((call) => call.request.messages.map((m) => m.content))
      .join("\n");
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain("Zino Mario");
    expect(facts).toContain("19 of 33 questions answered");
    expect(sent).toContain("never as a field list or a count read out");
  });

  it("reads nothing when the plan did not grant it", async () => {
    const { seam, request, reads } = build(false);
    await seam.answer(request);
    expect(reads).toEqual([]);
  });
});

describe("a turn Capital Q could not read (B1)", () => {
  it("puts the statement that nothing can be started first, and only then", async () => {
    const { environmentNotesFor, TURN_UNREAD_NOTE } =
      await import("../src/q/index.js");
    const unread = environmentNotesFor([], [], [], { turnUnread: true });
    expect(unread.startsWith(TURN_UNREAD_NOTE)).toBe(true);
    expect(environmentNotesFor([], [], [])).not.toContain(TURN_UNREAD_NOTE);
  });
});
