import { describe, expect, it } from "vitest";

import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QTurnAuthority } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import { createOnboardingConversation } from "../src/voice/onboarding-conversation.js";
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live 2026-10-31 (production f42b28f7b, typed onboarding): "skip the
 * rest" took 15.8 s (founder) and 19.5 s (investor), the final yes 16.8 s,
 * against ~4 s for a normal turn. Such a turn waited for Q's ordinary reply
 * model -- whose words it never uses -- before it even said what it was
 * doing, then for the reading of their words, then for the finish. Fake
 * timings, no live model: the reading of intent 300 ms, the unused reply
 * 1,200 ms (a slow model), the reading of their words 600 ms.
 *
 * Measured with these fakes: before this change the first line (and the
 * stage) came with the whole turn at 1,254 ms; after it, the stage and the
 * first line at 346 ms and the read-back at 662 ms.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000001",
};
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const INTENT_MS = 300;
const REPLY_MS = 1_200;
const READING_MS = 600;

function essentials(): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const s of INVESTOR_DEFINITION_V1.steps) {
    if (!s.required) continue;
    const c = s.configuration;
    if (c.stepType === "confirmation") continue;
    recorded[s.stepKey] =
      c.stepType === "single_select" || c.stepType === "multi_select"
        ? (c.options[0]?.optionKey ?? "")
        : c.stepType === "reference_select"
          ? "d0000000-0000-4000-8000-000000000001"
          : c.stepType === "range"
            ? "10"
            : "Nordlicht Saatgut Capital";
  }
  return recorded;
}

function world(authority: () => QTurnAuthority) {
  const w = investorSession({
    currentStepKey: "I2.investment_role",
    subject: FIRM,
    servesTurnSteps: true,
    recorded: essentials(),
  });
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: w.fetch,
    logger,
    readAfterMs: 5,
    recommendations: w.recommendations,
    reader: {
      read: async () => {
        await sleep(READING_MS);
        return { answers: [], declined: [], notKnown: [] };
      },
    },
  });
  let replies = 0;
  let stopped = 0;
  const gateway = {
    execute: async (_request: unknown, options?: { signal?: AbortSignal }) => {
      replies += 1;
      options?.signal?.addEventListener("abort", () => {
        stopped += 1;
      });
      await sleep(REPLY_MS);
      return {
        output: {
          kind: "STRUCTURED",
          value: { reply: "Anything else?", asking: null, readBack: false },
        },
      };
    },
  } as unknown as ModelGateway;
  const typed = createTypedOnboarding({
    conversation,
    gateway,
    recommendations: w.recommendations,
    delegation: {
      read: async () => {
        await sleep(INTENT_MS);
        return authority();
      },
    },
    logger,
  });
  const say = async (words: string) => {
    const started = Date.now();
    let first: number | null = null;
    let stagedAt: number | null = null;
    const sentences: string[] = [];
    const outcome = await typed.turn({
      ...turn(w, words),
      actor,
      onSentence: (sentence) => {
        first ??= Date.now() - started;
        sentences.push(sentence);
      },
      onStage: () => {
        stagedAt ??= Date.now() - started;
      },
    });
    if (outcome === null) throw new Error("the typed path declined the turn");
    const ms = Date.now() - started;
    return { outcome, ms, first: first ?? ms, stagedAt, sentences };
  };
  return { say, replies: () => replies, stopped: () => stopped };
}

describe("onboarding wrap-up: the reply comes first (live 2026-10-31)", () => {
  it('"skip the rest": the first line goes out on the reading of intent; the unused reply is never waited for', async () => {
    const { say, stopped } = world(() => authorityReading({ finishing: true }));
    const skip = await say("Skip the rest, that is everything.");
    console.info(
      `skip the rest: first line ${String(skip.first)} ms, stage ${String(skip.stagedAt)} ms, whole turn ${String(skip.ms)} ms`,
    );
    expect(skip.first).toBeLessThan(INTENT_MS + 200);
    expect(skip.stagedAt).not.toBeNull();
    expect(skip.stagedAt ?? Infinity).toBeLessThan(INTENT_MS + 200);
    // Bounded by the reading of their words, never by the unused reply.
    expect(skip.ms).toBeLessThan(REPLY_MS);
    expect(stopped()).toBe(1);
    // The streamed line stays part of the whole reply, read-back after it.
    expect(skip.sentences[0]).toMatch(/I'll check what I have saved/u);
    expect(skip.outcome.reply).toMatch(
      /^Understood\. I'll check what I have saved and read it back to you\. \S/u,
    );
  });

  it("an ordinary turn still waits for, and uses, Q's reply", async () => {
    const { say, stopped } = world(() => authorityReading({}));
    const plain = await say("We lead or co-lead.");
    expect(plain.outcome.reply).toBe("Anything else?");
    expect(plain.ms).toBeGreaterThanOrEqual(REPLY_MS - 20);
    expect(stopped()).toBe(0);
  });
});
