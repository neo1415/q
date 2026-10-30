import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import { PLAN_F03_ASK, TurnReaderV74ResultSchema } from "@capital-q/q-core";

import type { ModelGateway } from "../src/index.js";
import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  createQTurnReader,
  TURN_READER_LENIENT_FIELDS,
} from "../src/q/turn-reader.js";

/**
 * Situation-first planning (design 2026-10-28, S3, addendum 3): the
 * reader's planAsk and directsWork reach the caller from a model's
 * reading, and a malformed one costs itself, never the reading.
 */
const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);
const attribution = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "cor_test",
};
const BASE = { kind: "QUESTION_TO_Q", confidence: "HIGH", transcript: "CLEAR" };

/** A gateway that returns one fake structured reading. */
const fake = (
  value: unknown,
): { gateway: ModelGateway; options: unknown[] } => {
  const options: unknown[] = [];
  const gateway = {
    execute: (_request: unknown, opts: unknown) => {
      options.push(opts);
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
  return { gateway, options };
};

const read = (gateway: ModelGateway, utterance: string) =>
  createQTurnReader({ gateway, logger }).read({
    utterance,
    recentTurns: [],
    modality: "TEXT",
    attribution,
  });

describe("the turn reader's planAsk and directsWork (v70)", () => {
  it("asks the provider with the active (v74) schema and the lenient fields", async () => {
    const { gateway, options } = fake(BASE);
    await read(gateway, "What should I do this week?");
    expect(options[0]).toMatchObject({ schema: TurnReaderV74ResultSchema });
    expect(TURN_READER_LENIENT_FIELDS).toEqual(
      expect.arrayContaining(["planAsk", "directsWork", "acceptsOffer"]),
    );
  });

  it("v74: a yes to Q's offer reaches the caller as acceptsOffer; absent is false", async () => {
    const taken = await read(
      fake({ ...BASE, acceptsOffer: true }).gateway,
      "yes",
    );
    expect(taken?.acceptsOffer).toBe(true);
    const plain = await read(fake(BASE).gateway, "What should I do this week?");
    expect(plain?.acceptsOffer).toBe(false);
  });

  it("an investor's 'better deal flow' reaches the caller as an IMPROVE plan ask", async () => {
    const { gateway } = fake({
      ...BASE,
      planAsk: { kind: "IMPROVE", research: "MARKET", side: "INVESTOR" },
    });
    const reading = await read(gateway, "How do I get better deal flow?");
    expect(reading?.planAsk).toEqual({
      kind: "IMPROVE",
      research: "MARKET",
      side: "INVESTOR",
      subject: "OWN",
      deliverable: "PLAN",
    });
    expect(reading?.directsWork).toBe(false);
  });

  it("addendum 3: the F03 ask reads as their own company, a document review", async () => {
    const { gateway } = fake({
      ...BASE,
      kind: "TOOL_REQUEST",
      teamJob: true,
      planAsk: { kind: "GOAL", subject: "OWN", deliverable: "DOCUMENT_REVIEW" },
    });
    const reading = await read(gateway, PLAN_F03_ASK);
    expect(reading?.planAsk).toMatchObject({
      subject: "OWN",
      deliverable: "DOCUMENT_REVIEW",
    });
    expect(reading?.namedOther ?? null).toBeNull();
  });

  it("a direction to running work reaches the caller", async () => {
    const { gateway } = fake({
      ...BASE,
      kind: "TOOL_REQUEST",
      directsWork: true,
    });
    const reading = await read(gateway, "Focus on the fintech ones first.");
    expect(reading?.directsWork).toBe(true);
    expect(reading?.planAsk).toBeNull();
  });

  it("a malformed plan ask costs the plan ask, never the reading", () => {
    const raw = JSON.stringify({
      ...BASE,
      planAsk: { kind: "IMPROVE", research: "EVERYTHING" },
      directsWork: "maybe",
      discoverWhom: "INVESTORS",
    });
    const kept = acceptStructuredOutput(raw, TurnReaderV74ResultSchema, {
      lenientFields: TURN_READER_LENIENT_FIELDS,
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value).toMatchObject({
      kind: "QUESTION_TO_Q",
      planAsk: null,
      directsWork: false,
      discoverWhom: "INVESTORS",
    });
  });
});
