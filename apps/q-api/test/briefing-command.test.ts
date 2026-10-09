import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";

import { createBriefingCommandReader } from "../src/composition/briefing-command.js";

/**
 * Zino 2026-10-08: any words about the briefing's cards become typed card
 * verbs. Deterministic (a scripted gateway, no live calls): the person's
 * words and the cards reach the model fenced as data; only cards on their
 * screen come back; a failed read is "unclear", never a guess.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const who = { tenantId: "t", userId: "u" };
const CARDS = [
  {
    ref: "c1",
    kind: "HELD" as const,
    to: "Spheros",
    theyWrote: null,
    message: "Hi Ada, would 20 minutes next week work?",
    summary: "Q held a message",
  },
  {
    ref: "c2",
    kind: "APPROVAL" as const,
    to: "Tensorgate",
    theyWrote: "Want the deck, or 20 minutes on Thursday?",
    message: "Thursday works. What time suits you?",
    summary: "Reply ready to send",
  },
];

function gatewayAnswering(value: unknown): {
  gateway: ModelGateway;
  prompts: string[];
} {
  const prompts: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

describe("the briefing's free-form words", () => {
  it("reads 'send the Tensorgate one but make it warmer' into one rewrite, and keeps only cards on screen", async () => {
    const { gateway, prompts } = gatewayAnswering({
      actions: [
        {
          ref: "c2",
          verb: "REWRITE",
          rewrite: "Hi Daniel, Thursday would be lovely. What time suits you?",
        },
        { ref: "c9", verb: "SEND", rewrite: null },
      ],
      unclear: false,
    });
    const read = createBriefingCommandReader({ gateway, logger });
    const result = await read(who, {
      words: "send the Tensorgate one but make it warmer",
      timeZone: "Africa/Lagos",
      cards: CARDS,
    });
    expect(result).toEqual({
      actions: [
        {
          ref: "c2",
          verb: "REWRITE",
          rewrite: "Hi Daniel, Thursday would be lovely. What time suits you?",
        },
      ],
      unclear: false,
    });
    expect(prompts[0]).toContain("TASK: BRIEFING_COMMAND");
    expect(prompts[0]).toContain("send the Tensorgate one but make it warmer");
    expect(prompts[0]).toContain("Tensorgate");
  });

  it("drops a rewrite without text, and a failed call is unclear", async () => {
    const empty = createBriefingCommandReader({
      gateway: gatewayAnswering({
        actions: [{ ref: "c1", verb: "REWRITE", rewrite: null }],
        unclear: false,
      }).gateway,
      logger,
    });
    expect(
      await empty(who, { words: "change it", timeZone: null, cards: CARDS }),
    ).toEqual({ actions: [], unclear: true });
    const failing = createBriefingCommandReader({
      gateway: gatewayAnswering(new Error("down")).gateway,
      logger,
    });
    expect(
      await failing(who, {
        words: "ignore Spheros",
        timeZone: null,
        cards: CARDS,
      }),
    ).toEqual({ actions: [], unclear: true });
  });
});
