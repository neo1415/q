import { describe, expect, it } from "vitest";

import {
  createPostgresPreferenceLearningConsent,
  createPreferenceNotebook,
  NOT_NOW_DAYS,
  preferenceLearningState,
} from "../src/index.js";

/**
 * Lane ob1 (owner decision 2026-10-16): consent to learn how a person likes
 * to work. Owner 2026-10-17: Q learns by default and never asks; an
 * earlier "Not now" or turning it off is respected; what they state
 * directly is kept regardless.
 */
const NOW = new Date("2026-10-16T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("preference learning consent", () => {
  it("no decision: never asked, and learning is on", () => {
    expect(preferenceLearningState(null, NOW)).toEqual({
      status: "NOT_ASKED",
      mayAsk: false,
      askAgainAfter: null,
    });
  });

  it("an earlier Not now is kept and never asked again", () => {
    const row = {
      status: "DECLINED" as const,
      askAgainAfter: days(NOT_NOW_DAYS),
    };
    expect(preferenceLearningState(row, days(29)).mayAsk).toBe(false);
    expect(preferenceLearningState(row, days(31)).mayAsk).toBe(false);
  });

  it("granted: no row, or GRANTED; a no, or a failed read, is not", async () => {
    const consent = (rows: unknown[] | Error) =>
      createPostgresPreferenceLearningConsent({
        sql: (() =>
          rows instanceof Error
            ? Promise.reject(rows)
            : Promise.resolve(rows)) as never,
      });
    const actor = {
      userId: "b0000000-0000-4000-8000-000000000001",
      tenantId: "c0000000-0000-4000-8000-000000000001",
    } as never;
    expect(await consent([]).granted(actor)).toBe(true);
    expect(
      await consent([{ status: "GRANTED", ask_again_after: null }]).granted(
        actor,
      ),
    ).toBe(true);
    expect(
      await consent([{ status: "REVOKED", ask_again_after: null }]).granted(
        actor,
      ),
    ).toBe(false);
    expect(
      await consent([{ status: "DECLINED", ask_again_after: null }]).granted(
        actor,
      ),
    ).toBe(false);
    expect(await consent(new Error("down")).granted(actor)).toBe(false);
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
