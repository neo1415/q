import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader, createTurnSkimmer } from "../src/q/index.js";
import { TENANT, USER } from "./fixtures.js";

/**
 * K fast lane: the skim is one quick call over a prompt a fraction of the
 * full turn reader's, asking for four fields. Fakes only: the sizes below
 * are what each call sends, measured here, and stand in for its latency
 * (input to read, output to write) until a live check is approved.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

const SKIM = {
  kind: "DISCOVER_COMPANIES",
  confidence: "HIGH",
  count: 3,
  discover: {
    sectors: ["fintech"],
    countries: ["NG"],
    stages: [],
    ranking: "NONE",
    mandateRelevant: false,
    previous: false,
  },
};

type Recorded = {
  readonly taskClass?: string;
  readonly budget?: { readonly maxOutputTokens?: number };
  readonly messages?: readonly { readonly content: string }[];
};

function recording(value: unknown, fail = false) {
  const requests: Recorded[] = [];
  const gateway = {
    execute: (request: Recorded) => {
      requests.push(request);
      return fail
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { gateway, requests };
}

const characters = (request: Recorded | undefined) =>
  (request?.messages ?? []).reduce(
    (sum, message) => sum + message.content.length,
    0,
  );

const attribution = {
  tenantId: TENANT,
  userId: USER,
  correlationId: "cor_skim",
};
const SAID = "show me three fintech companies in Nigeria";

describe("the turn skim (K)", () => {
  it("reads companies of a kind in one quick call over a fraction of the reader's prompt", async () => {
    const skim = recording(SKIM);
    expect(
      await createTurnSkimmer({ gateway: skim.gateway }).skim({
        utterance: SAID,
        recentTurns: [],
        attribution,
      }),
    ).toEqual(SKIM);
    expect(skim.requests).toHaveLength(1);
    expect(skim.requests[0]?.taskClass).toBe("FAST_CLASSIFICATION");

    const read = recording({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
    });
    await createQTurnReader({ gateway: read.gateway, logger }).read({
      utterance: SAID,
      recentTurns: [],
      modality: "TEXT",
      attribution,
    });
    const skimChars = characters(skim.requests[0]);
    const readChars = characters(read.requests[0]);
    // Measured: well under half of the reader's prompt, and an output
    // budget a seventh of its (four fields, not the whole reading).
    expect(skimChars * 2).toBeLessThan(readChars);
    expect(skim.requests[0]?.budget?.maxOutputTokens).toBeLessThanOrEqual(160);
    expect(
      (skim.requests[0]?.budget?.maxOutputTokens ?? 0) * 7,
    ).toBeLessThanOrEqual(read.requests[0]?.budget?.maxOutputTokens ?? 0);
  });

  it("answers null, never a guess, when the call fails or says something unreadable", async () => {
    for (const side of [recording(null, true), recording({ kind: "MAYBE" })]) {
      expect(
        await createTurnSkimmer({ gateway: side.gateway }).skim({
          utterance: "three fintech",
          recentTurns: [],
          attribution,
        }),
      ).toBeNull();
    }
  });
});
