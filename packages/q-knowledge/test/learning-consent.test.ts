import { describe, expect, it } from "vitest";

import {
  createPreferenceNotebook,
  NOT_NOW_DAYS,
  preferenceLearningState,
} from "../src/index.js";

/**
 * Lane ob1 (owner decision 2026-10-16): consent to learn how a person likes
 * to work. Not asked = not granted; "Not now" waits 30 days; turned off
 * is never asked again; what they state directly is kept regardless.
 */
const NOW = new Date("2026-10-16T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("preference learning consent", () => {
  it("not asked: may ask, and nothing is granted", () => {
    expect(preferenceLearningState(null, NOW)).toEqual({
      status: "NOT_ASKED",
      mayAsk: true,
      askAgainAfter: null,
    });
  });

  it("Not now waits 30 days, then may ask again", () => {
    const row = {
      status: "DECLINED" as const,
      askAgainAfter: days(NOT_NOW_DAYS),
    };
    expect(preferenceLearningState(row, days(29)).mayAsk).toBe(false);
    expect(preferenceLearningState(row, days(30)).mayAsk).toBe(true);
  });

  it("granted or turned off: never asked again", () => {
    expect(
      preferenceLearningState({ status: "GRANTED", askAgainAfter: null }, NOW)
        .mayAsk,
    ).toBe(false);
    expect(
      preferenceLearningState({ status: "REVOKED", askAgainAfter: null }, NOW)
        .mayAsk,
    ).toBe(false);
  });

  it("a preference they state is kept without asking (consent by statement)", async () => {
    const remembered: unknown[] = [];
    const notebook = createPreferenceNotebook({
      memory: {
        remember: (command) => {
          remembered.push(command);
          return Promise.resolve({
            outcome: "REMEMBERED",
            reason: "RECORDED",
            item: {} as never,
          });
        },
      },
      actor: {
        userId: "b0000000-0000-4000-8000-000000000001",
        tenantId: "c0000000-0000-4000-8000-000000000001",
        actorType: "HUMAN",
      } as never,
      sessionKey: null,
      priorUserTurns: ["Please keep your answers short from now on."],
    });
    const result = await notebook.note({
      aspect: "responseDepth",
      value: "CONCISE",
      persistence: "LONG_TERM",
      quote: "keep your answers short",
    } as never);
    expect(result.outcome).not.toBe("REFUSED");
    expect(remembered).toHaveLength(1);
  });
});
