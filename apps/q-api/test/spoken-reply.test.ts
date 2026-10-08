import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import { spokenFactsOf, type SpokenFacts } from "@capital-q/q-core";

// The founder's live turns (c10b845f), one fixture for every layer.
import {
  C10B_CARDS,
  C10B_FIT_BLOCKS,
  C10B_OPEN_BLOCKS,
  C10B_TURNS,
} from "../../../packages/q-core/test/fixtures/voice-c10b845f.js";
import { createSpokenReplier } from "../src/voice/spoken-reply.js";

/**
 * Eval (deterministic, no live calls): the standard voice line says a
 * code-built answer in Q's own words, and only words that pass the
 * fidelity checks; anything else, or anything late, is the fact-built
 * line. Founder live 2026-10-08, conversation c10b845f.
 */

const logger = createLogger({ service: "test", level: "silent" });
const ATTRIBUTION = {
  tenantId: "t",
  userId: "u",
  correlationId: "c",
} as const;

function facts(turn: "topThree" | "third"): SpokenFacts {
  const built =
    turn === "topThree"
      ? spokenFactsOf({
          asked: C10B_TURNS.topThree.asked,
          text: C10B_TURNS.topThree.said,
          blocks: C10B_FIT_BLOCKS,
        })
      : spokenFactsOf({
          asked: C10B_TURNS.third.asked,
          text: C10B_TURNS.third.said,
          blocks: C10B_OPEN_BLOCKS,
          shown: C10B_CARDS,
        });
  if (built === null) throw new Error("no facts");
  return built;
}

function gatewaySaying(
  say: string,
  delayMs = 0,
): { gateway: ModelGateway; prompts: string[] } {
  const prompts: string[] = [];
  const gateway = {
    execute: (
      request: { readonly messages: readonly { readonly content: string }[] },
      options: { readonly signal?: AbortSignal },
    ) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ output: { kind: "STRUCTURED", value: { say } } }),
          delayMs,
        );
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

describe("the standard line's spoken reply", () => {
  it("says the voice's own words when they keep to the facts", async () => {
    const own =
      "So, your top three: Halyard, Clearwater and Tensorgate, all level at 8.8, and four others are right there with them. Want me to go through one?";
    const { gateway, prompts } = gatewaySaying(own);
    const reply = await createSpokenReplier({ gateway, logger }).say({
      facts: facts("topThree"),
      asked: C10B_TURNS.topThree.asked,
      lastSaid: "",
      attribution: ATTRIBUTION,
    });
    expect(reply).toEqual({ text: own, source: "MODEL", issues: [] });
    // The facts reach the model fenced as data; the rules are the shared ones.
    expect(prompts[0]).toContain("SPEAKING FROM FACTS");
    expect(prompts[0]).toContain('"askedFor":3');
    expect(prompts[0]).not.toContain("companyId");
  });

  it.each([
    [
      "the template the founder heard",
      C10B_TURNS.topThree.said,
      ["COUNT", "MUST_SAY", "TIE", "BANNED"],
    ],
    [
      "a tie said as a ranking",
      "Halyard Security fits best at 8.8, then Clearwater Assurance and Tensorgate.",
      ["TIE"],
    ],
    [
      "an invented figure",
      "Halyard Security, Clearwater Assurance and Tensorgate are level at 8.8, all with 40% growth.",
      ["NUMBER"],
    ],
  ])("never says %s: the fact-built line instead", async (_name, bad, why) => {
    const { gateway } = gatewaySaying(bad);
    const built = facts("topThree");
    const reply = await createSpokenReplier({ gateway, logger }).say({
      facts: built,
      asked: C10B_TURNS.topThree.asked,
      lastSaid: "",
      attribution: ATTRIBUTION,
    });
    expect(reply.source).toBe("FALLBACK");
    expect(reply.text).toBe(built.fallback);
    expect(reply.issues).toEqual(expect.arrayContaining(why));
  });

  it("is bounded: a late rewrite is not waited for", async () => {
    const { gateway } = gatewaySaying("Tensorgate, sure: 8.8.", 5_000);
    const built = facts("third");
    const started = Date.now();
    const reply = await createSpokenReplier({
      gateway,
      logger,
      deadlineMs: 50,
    }).say({
      facts: built,
      asked: C10B_TURNS.third.asked,
      lastSaid: "",
      attribution: ATTRIBUTION,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(reply.source).toBe("FALLBACK");
    expect(reply.text).toBe(built.fallback);
    expect(reply.text).not.toMatch(/^Opening/u);
  });

  it("talks about the third company instead of only opening it", async () => {
    const own =
      "Tensorgate, sure. They're seed stage in the US, 8.8 on your mandate; stage and sector line up, cheque size we don't know yet. I've pulled them up. Want more?";
    const { gateway } = gatewaySaying(own);
    const reply = await createSpokenReplier({ gateway, logger }).say({
      facts: facts("third"),
      asked: C10B_TURNS.third.asked,
      lastSaid: "",
      attribution: ATTRIBUTION,
    });
    expect(reply.source).toBe("MODEL");
    expect(reply.text).toBe(own);
  });
});
