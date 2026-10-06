import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ModelGateway } from "../src/index.js";
import { createWordsReaders } from "../src/q/index.js";

/**
 * Founder brief J7: people's words read by meaning. Each reader is one
 * pinned FAST_CLASSIFICATION prompt through the gateway; a call that fails
 * or answers out of shape is null, the caller's safe default. No provider
 * is called: the gateway is a fake.
 */

const WHO = { tenantId: randomUUID(), userId: randomUUID() };

function gateway(answer: (task: string) => unknown) {
  const calls: { task: string; taskClass: string }[] = [];
  const fake = {
    execute: (request: {
      taskClass: string;
      messages: { content: unknown }[];
    }) => {
      const prompt = JSON.stringify(request.messages);
      const task = /TASK: ([A-Z_]+)/u.exec(prompt)?.[1] ?? "?";
      calls.push({ task, taskClass: request.taskClass });
      const value = answer(task);
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { fake, calls };
}

describe("words readers (J7)", () => {
  it("reads each through its own prompt on FAST_CLASSIFICATION", async () => {
    const { fake, calls } = gateway((task) =>
      task === "ONBOARDING_MOVE_READER"
        ? { move: "SKIP" }
        : task === "MEETING_OUTCOME_READER"
          ? { outcome: "DILIGENCE" }
          : task === "UTTERANCE_CHECK"
            ? { answer: "YES" }
            : {
                mentions: [
                  { id: "0", polarity: "EXCLUDED" },
                  { id: "9", polarity: "WANTED" },
                ],
              },
    );
    const readers = createWordsReaders({ gateway: fake });
    expect(
      await readers.onboardingMove(WHO, {
        question: "What stage are you at?",
        options: ["Seed"],
        utterance: "let's leave that for now",
      }),
    ).toBe("SKIP");
    expect(
      await readers.meetingOutcome(WHO, ["Apex will begin diligence"]),
    ).toBe("DILIGENCE");
    expect(
      await readers.check(WHO, { question: "Any hour?", utterance: "24/7" }),
    ).toBe("YES");
    // Only ids it was asked about come back.
    expect(
      await readers.preferencePolarity(WHO, [
        { id: "0", term: "Gambling", sentence: "never gambling" },
      ]),
    ).toEqual(new Map([["0", "EXCLUDED"]]));
    expect(calls.map((call) => call.taskClass)).toEqual([
      "FAST_CLASSIFICATION",
      "FAST_CLASSIFICATION",
      "FAST_CLASSIFICATION",
      "FAST_CLASSIFICATION",
    ]);
  });

  it("is null when the call fails or answers out of shape (the safe default)", async () => {
    const failing = createWordsReaders({
      gateway: gateway(() => new Error("provider down")).fake,
    });
    expect(
      await failing.onboardingMove(WHO, {
        question: "Q",
        options: [],
        utterance: "skip",
      }),
    ).toBeNull();
    expect(
      await failing.preferencePolarity(WHO, [
        { id: "0", term: "x", sentence: "x" },
      ]),
    ).toBeNull();
    const odd = createWordsReaders({
      gateway: gateway(() => ({ answer: "MAYBE" })).fake,
    });
    expect(
      await odd.check(WHO, { question: "Q", utterance: "words" }),
    ).toBeNull();
    // Nothing to read: no call.
    const { fake, calls } = gateway(() => ({ outcome: "NONE" }));
    expect(
      await createWordsReaders({ gateway: fake }).meetingOutcome(WHO, []),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
