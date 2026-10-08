import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import { pleasantryOf, pleasantryReply } from "@capital-q/q-core";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * RECOVERY-2026-10 B5 (audit B-05): greetings and small talk are cheap.
 * Before: every turn, "hi Q" included, paid for the turn reader, the
 * analyst's prefetch (warm) and a tool-bearing analyst call. After: a pure
 * pleasantry costs no model call at all, and other small talk one short
 * tool-free call instead of the analyst. No founder or investor setup is
 * needed: the actor here has no organisation. Every turn still ends in a
 * stored answer (ANSWERED with a message).
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

// A person mid-onboarding: no organisation, no membership.
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER },
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

const SMALL_TALK = {
  kind: "SMALL_TALK",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

/** Counts every paid step of a turn. */
function seam(options: {
  readonly reading?: QTurnReading;
  readonly smallTalk?: "REPLY" | "FAILS" | "ABSENT";
}) {
  const calls = { reader: 0, warm: 0, analyst: 0, smallTalk: 0 };
  const lines: QConversationMessage[] = [];
  const conversationId = randomUUID();
  const turns: QTurnReader = {
    read: () => {
      calls.reader += 1;
      return Promise.resolve(options.reading ?? SMALL_TALK);
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => {
        calls.warm += 1;
      },
      answer: () => {
        calls.analyst += 1;
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
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          lines.push(row);
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
    ...(options.smallTalk === "ABSENT" || options.smallTalk === undefined
      ? {}
      : {
          smallTalk: () => {
            calls.smallTalk += 1;
            return Promise.resolve(
              options.smallTalk === "REPLY"
                ? "Why did the founder cross the road? To get to Series A."
                : null,
            );
          },
        }),
  });
  const say = async (said: string, spoken = false) => {
    lines.push({
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      ...(spoken ? { utteranceRef: `utt_${randomUUID()}` } : {}),
    } as unknown as QConversationMessage);
    const outcome = await answer.answer(request());
    return { outcome, last: lines.at(-1) };
  };
  return { say, calls, answer };
}

describe("the cost of a greeting (B-05), before and after", () => {
  it("before: 'hi Q' paid for the reader, the prefetch and the analyst", async () => {
    // The old path, reproduced: no small-talk reply, and a greeting that is
    // not a pure pleasantry (so the code path does not catch it).
    const run = seam({ smallTalk: "ABSENT" });
    await run.say("hi Q, tell me a joke");
    expect(run.calls).toEqual({ reader: 1, warm: 1, analyst: 1, smallTalk: 0 });
  });

  it("after: a pure pleasantry pays for nothing: no reader, no prefetch, no model", async () => {
    for (const said of [
      "hi Q",
      "Hello!",
      "thanks",
      "good morning",
      "how are you?",
    ]) {
      const run = seam({ smallTalk: "REPLY" });
      const { outcome, last } = await run.say(said);
      expect(run.calls, said).toEqual({
        reader: 0,
        warm: 0,
        analyst: 0,
        smallTalk: 0,
      });
      // The turn still ends ANSWERED with a stored line.
      expect(
        outcome.kind === "ANSWERED" && outcome.messageId,
        said,
      ).not.toBeNull();
      expect(last?.role).toBe("Q");
    }
  });

  it("after: other small talk is one tool-free call instead of the analyst", async () => {
    const run = seam({ smallTalk: "REPLY" });
    const { outcome, last } = await run.say("hi Q, tell me a joke");
    expect(run.calls).toEqual({ reader: 1, warm: 1, analyst: 0, smallTalk: 1 });
    expect(outcome.kind).toBe("ANSWERED");
    expect(last?.content).toMatch(/Series A/u);
  });

  it("falls back to the full path, never silence, when the cheap reply fails", async () => {
    const run = seam({ smallTalk: "FAILS" });
    await run.say("hi Q, tell me a joke");
    expect(run.calls).toEqual({ reader: 1, warm: 1, analyst: 1, smallTalk: 1 });
  });

  it("a request in the same breath still goes the full way", async () => {
    const run = seam({
      smallTalk: "REPLY",
      reading: {
        ...SMALL_TALK,
        kind: "QUESTION_TO_Q",
      } as unknown as QTurnReading,
    });
    await run.say("hi Q, what needs my attention?");
    expect(run.calls.analyst).toBe(1);
    expect(run.calls.smallTalk).toBe(0);
  });

  it("spoken: a bare 'thanks' mid-call is the reader's to judge (it may be for the room)", async () => {
    const run = seam({ smallTalk: "REPLY" });
    await run.say("what's our runway?", true);
    await run.say("thanks", true);
    expect(run.calls.reader).toBe(2);
    const named = seam({ smallTalk: "REPLY" });
    await named.say("what's our runway?", true);
    await named.say("thanks, Q", true);
    expect(named.calls.reader).toBe(1);
  });
});

describe("pleasantries, read by code", () => {
  it.each([
    ["hi Q", "GREETING"],
    ["Hey there!", "GREETING"],
    ["good evening, Q", "GREETING"],
    ["how are you doing today?", "HOW_ARE_YOU"],
    ["hi Q, how's it going?", "HOW_ARE_YOU"],
    ["Thank you so much!", "THANKS"],
    ["cheers Q", "THANKS"],
    ["bye for now", "GOODBYE"],
    ["see you tomorrow", "GOODBYE"],
  ])("%j is %s", (said, kind) => {
    expect(pleasantryOf(said)).toBe(kind);
  });

  it.each([
    "hi Q, what needs my attention?",
    "thanks, now send it",
    "hello, can you compare Halyard and Savanna",
    "ok",
    "yes please",
  ])("%j is not a pure pleasantry", (said) => {
    expect(pleasantryOf(said)).toBeNull();
  });

  it("varies, and never repeats the line Q said last", () => {
    const first = pleasantryReply("GREETING", "run-1");
    expect(pleasantryReply("GREETING", "run-1", first)).not.toBe(first);
  });
});
