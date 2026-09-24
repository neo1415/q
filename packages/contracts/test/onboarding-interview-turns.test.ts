import { describe, expect, it } from "vitest";

import {
  AppendOnboardingInterviewTurnsRequestSchema,
  ListOnboardingInterviewTurnsQuerySchema,
  ListOnboardingInterviewTurnsResponseSchema,
} from "../src/http/onboarding.js";

const TURN_REF = "7f1e2d3c-4b5a-4968-8776-655443322110";

describe("AppendOnboardingInterviewTurnsRequestSchema", () => {
  it("accepts one exchange: the person's words and Q's reply", () => {
    const parsed = AppendOnboardingInterviewTurnsRequestSchema.parse({
      turnRef: TURN_REF,
      turns: [
        {
          role: "PERSON",
          text: "We are raising a seed round.",
          stepKey: "raise.amount",
          channel: "VOICE",
        },
        { role: "Q", text: "How much are you raising?", channel: "VOICE" },
      ],
    });
    expect(parsed.turns).toHaveLength(2);
  });

  it("refuses an empty exchange, more than two turns, or a role twice", () => {
    const turn = { role: "Q", text: "Hello.", channel: "TEXT" } as const;
    for (const turns of [[], [turn, turn], [turn, turn, turn]]) {
      expect(
        AppendOnboardingInterviewTurnsRequestSchema.safeParse({
          turnRef: TURN_REF,
          turns,
        }).success,
      ).toBe(false);
    }
  });

  it("refuses blank or oversized text, an unknown role or channel, and extra fields", () => {
    const base = { role: "PERSON", text: "Hi", channel: "TEXT" };
    for (const bad of [
      { ...base, text: "" },
      { ...base, text: "a".repeat(4001) },
      { ...base, role: "SYSTEM" },
      { ...base, channel: "VIDEO" },
      { ...base, stepKey: "not a key!" },
      { ...base, sessionOwner: "someone" },
    ]) {
      expect(
        AppendOnboardingInterviewTurnsRequestSchema.safeParse({
          turnRef: TURN_REF,
          turns: [bad],
        }).success,
      ).toBe(false);
    }
    expect(
      AppendOnboardingInterviewTurnsRequestSchema.safeParse({
        turnRef: "not-a-uuid",
        turns: [base],
      }).success,
    ).toBe(false);
  });
});

describe("ListOnboardingInterviewTurnsQuerySchema", () => {
  it("defaults to 50 and caps at 100", () => {
    expect(ListOnboardingInterviewTurnsQuerySchema.parse({}).limit).toBe(50);
    expect(
      ListOnboardingInterviewTurnsQuerySchema.parse({ limit: "7" }).limit,
    ).toBe(7);
    expect(
      ListOnboardingInterviewTurnsQuerySchema.safeParse({ limit: "101" })
        .success,
    ).toBe(false);
    expect(
      ListOnboardingInterviewTurnsQuerySchema.safeParse({ limit: "0" }).success,
    ).toBe(false);
  });
});

describe("ListOnboardingInterviewTurnsResponseSchema", () => {
  it("carries no step, id or owner -- only what the thread shows", () => {
    expect(
      ListOnboardingInterviewTurnsResponseSchema.safeParse({
        items: [
          {
            role: "Q",
            text: "Welcome back.",
            channel: "TEXT",
            createdAt: "2026-09-24T10:00:00.000Z",
            stepKey: "intent",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
