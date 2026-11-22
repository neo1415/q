import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  type QOnboardingNudgePort,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

// W4-F (audit finding 9): fake time, so no assertion here depends on how
// fast the machine is; every wait below advances the clock instead.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * W4-F: run fake time forward in small steps until `work` settles, so a
 * deadline or a slow stub plays out exactly, however busy the machine.
 */
async function settled<T>(work: Promise<T>, stepMs = 5): Promise<T> {
  let done = false;
  // Watched, not consumed: a rejection still reaches the caller.
  void work.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let at = 0; !done && at < 120_000; at += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return work;
}

const RUN = randomUUID();

function build(options: {
  readonly granted: boolean;
  readonly port: QOnboardingNudgePort;
  readonly answers?: number;
  readonly settings?: Record<string, unknown>;
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
    ...options.settings,
  });
  const plan = {
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: options.granted
      ? [
          {
            kind: "OWN_ONBOARDING",
            filter: { tenantId: TENANT, userId: USER },
          },
        ]
      : [],
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

/**
 * L1 latency sweep (2026-10-06): the person's settings for an answer (the
 * setup reminder, their Q personality, how they ask, their etiquette
 * guides) were read one after another before the model was asked. They are
 * now read side by side. Each read takes 100 ms here.
 */
const READ_MS = 100;

function slowReads() {
  let inFlight = 0;
  let most = 0;
  const slow = <T>(value: T) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    return new Promise<T>((resolve) =>
      setTimeout(() => {
        inFlight -= 1;
        resolve(value);
      }, READ_MS),
    );
  };
  const port: QOnboardingNudgePort = {
    peek: () => slow(null),
    markShown: () => Promise.resolve(),
  };
  const settings = {
    personalityOf: () => slow(null),
    askerOf: () => slow(null),
    etiquetteOf: () => slow(null),
  };
  return { port, settings, most: () => most };
}

describe("an answer's settings reads", () => {
  it("before: four reads one after another took >= 400 ms; after: side by side, ~100 ms", async () => {
    const reads = slowReads();
    const { seam, request } = build({
      granted: true,
      port: reads.port,
      settings: reads.settings,
    });
    const started = Date.now();
    expect((await settled(seam.answer(request))).kind).toBe("ANSWERED");
    const took = Date.now() - started;
    expect(reads.most()).toBe(4);
    expect(took).toBeLessThan(4 * READ_MS);
  });
});
