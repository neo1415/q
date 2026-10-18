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
  environmentNotesFor,
  onboardingNudgeNote,
  type QOnboardingNudge,
  type QOnboardingNudgePort,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Q's setup reminder in conversation (founder directive 2026-09-27): at
 * most once per conversation, only at a natural pause, offered as trusted
 * text the model may use to close an answer — never to lead or block it.
 */

const RUN = randomUUID();

function nudge(journeyType: "founder" | "investor"): QOnboardingNudge {
  return {
    journeyType,
    doneCount: 4,
    requiredCount: 9,
    minutesLeft: 3,
    remainingTopics: ["Your raise", 'Team "and" hires'],
  };
}

/** Once per conversation, as the policy says; records what it was asked. */
function oncePerConversation(value: QOnboardingNudge) {
  const shown = new Set<string>();
  const peeks: string[] = [];
  const marks: string[] = [];
  const port: QOnboardingNudgePort = {
    peek: (actor, conversationId) => {
      peeks.push(`${actor.userId}:${conversationId}`);
      return Promise.resolve(shown.has(conversationId) ? null : value);
    },
    markShown: (_actor, conversationId) => {
      marks.push(conversationId);
      shown.add(conversationId);
      return Promise.resolve();
    },
  };
  return { port, peeks, marks };
}

function build(options: {
  readonly granted: boolean;
  readonly port: QOnboardingNudgePort;
  readonly answers?: number;
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: Array.from({ length: options.answers ?? 1 }, () => ({
      kind: "JSON" as const,
      value: {
        answer: "Your deck reads well.",
        responseShape: "CONCISE",
        insufficientEvidence: false,
        recommendation: null,
      },
    })),
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const conversationId = randomUUID();
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId: RUN,
      role: "USER",
      content: "How does my deck read?",
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
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    onboardingNudge: options.port,
  });
  const plan = {
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: options.granted ? [{ kind: "OWN_ONBOARDING" }] : [],
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
  const sent = () =>
    alpha.calls.map((call) =>
      call.request.messages.map((m) => m.content).join("\n"),
    );
  return { seam, request, sent, conversationId };
}

describe("the setup reminder note", () => {
  it("states progress and what is left, and never leads or blocks", () => {
    for (const journey of ["founder", "investor"] as const) {
      const note = onboardingNudgeNote(nudge(journey));
      expect(note).toContain("4 of 9 required steps done");
      expect(note).toContain("about 3 minutes left");
      expect(note).toContain('"Your raise"');
      expect(note).toContain('"Team and hires"');
      expect(note).toContain("never lead with this");
      expect(note).toContain("ONE short");
      expect(note).toContain(
        journey === "investor" ? "INVESTOR SETUP" : "COMPANY SETUP",
      );
    }
  });

  it("is carried only when given, and last", () => {
    const note = onboardingNudgeNote(nudge("founder"));
    expect(environmentNotesFor([], [], [])).not.toContain("UNFINISHED");
    const notes = environmentNotesFor([], [], [], {
      onboardingNudge: nudge("founder"),
    });
    expect(notes.endsWith(note)).toBe(true);
  });
});

describe("Home Q and the setup reminder", () => {
  it("offers it once in a conversation and counts it after the answer", async () => {
    const { port, peeks, marks } = oncePerConversation(nudge("investor"));
    const { seam, request, sent, conversationId } = build({
      granted: true,
      port,
      answers: 2,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const [first, second] = sent();
    expect(first).toContain("THEIR INVESTOR SETUP IS UNFINISHED");
    expect(second).not.toContain("UNFINISHED");
    expect(peeks).toEqual([
      `${USER}:${conversationId}`,
      `${USER}:${conversationId}`,
    ]);
    expect(marks).toEqual([conversationId]);
  });

  it("NEGATIVE: never asks without the person's own onboarding scope", async () => {
    const { port, peeks, marks } = oncePerConversation(nudge("founder"));
    const { seam, request, sent } = build({ granted: false, port });
    await seam.answer(request);
    expect(peeks).toEqual([]);
    expect(marks).toEqual([]);
    expect(sent()[0]).not.toContain("UNFINISHED");
  });

  it("stays out of a series of questions Q is putting to them", async () => {
    const { port, peeks } = oncePerConversation(nudge("founder"));
    const { seam, request, sent } = build({ granted: true, port });
    await seam.answer({
      ...request,
      questionSequence: { kind: "ASK", topic: "my raise", number: 1, total: 3 },
    });
    expect(peeks).toEqual([]);
    expect(sent()[0]).not.toContain("UNFINISHED");
  });

  it("a failed reminder read costs nothing but the reminder", async () => {
    const { seam, request, sent } = build({
      granted: true,
      port: {
        peek: () => Promise.reject(new Error("down")),
        markShown: () => Promise.reject(new Error("down")),
      },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(sent()[0]).not.toContain("UNFINISHED");
  });
});
