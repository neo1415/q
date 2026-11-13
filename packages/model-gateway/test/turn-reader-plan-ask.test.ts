import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import { PLAN_F03_ASK, TurnReaderV86ResultSchema } from "@capital-q/q-core";

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
  it("asks the provider with the active (v83) schema and the lenient fields", async () => {
    const { gateway, options } = fake(BASE);
    await read(gateway, "What should I do this week?");
    expect(options[0]).toMatchObject({ schema: TurnReaderV86ResultSchema });
    expect(TURN_READER_LENIENT_FIELDS).toEqual(
      expect.arrayContaining([
        "planAsk",
        "directsWork",
        "acceptsOffer",
        "investmentMemo",
      ]),
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

  it("v75: an IC memo on a company reaches the caller as investmentMemo; absent is false", async () => {
    const memo = await read(
      fake({ ...BASE, teamJob: true, investmentMemo: true }).gateway,
      "Write me an IC memo on Portside",
    );
    expect(memo?.investmentMemo).toBe(true);
    const plain = await read(fake(BASE).gateway, "What should I do this week?");
    expect(plain?.investmentMemo).toBe(false);
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
    const kept = acceptStructuredOutput(raw, TurnReaderV86ResultSchema, {
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

/**
 * C10 (TURN_READER v83): the navigation intent reaches the caller from the
 * one reading; "don't open it" is no move whatever mode was written beside
 * it, and a malformed intent is not read (code's word fallback), never a
 * lost reading.
 */
describe("the turn reader's navigation intent (v83, v84 CONTEXT, v85 destination)", () => {
  it("reaches the caller, with negation read as no move", async () => {
    const none = { destination: null };
    for (const [navigation, expected] of [
      [
        { mode: "GO", negated: false },
        { mode: "GO", negated: false, ...none },
      ],
      [{ mode: "OFFER_ONLY" }, { mode: "OFFER_ONLY", negated: false, ...none }],
      [{ mode: "CONTEXT" }, { mode: "CONTEXT", negated: false, ...none }],
      [
        { mode: "CONTEXT", destination: "CRM_PIPELINE" },
        { mode: "CONTEXT", negated: false, destination: "CRM_PIPELINE" },
      ],
      [
        { mode: "CONTEXT", negated: true, destination: "CRM_PIPELINE" },
        { mode: "NONE", negated: true, ...none },
      ],
      [
        { mode: "GO", negated: true },
        { mode: "NONE", negated: true, ...none },
      ],
      [undefined, null],
    ] as const) {
      const { gateway } = fake({ ...BASE, navigation });
      const reading = await read(gateway, "don't open it, just tell me");
      expect(reading?.navigation ?? null).toEqual(expected);
    }
    expect(TURN_READER_LENIENT_FIELDS).toContain("navigation");
  });

  it("v86: the company media ask reaches the caller; a malformed one is none", async () => {
    for (const [companyMedia, expected] of [
      [
        { pitch: true, picture: false },
        { pitch: true, picture: false },
      ],
      [{ picture: true }, { pitch: false, picture: true }],
      [undefined, null],
    ] as const) {
      const { gateway } = fake({ ...BASE, companyMedia });
      const reading = await read(gateway, "can I watch their pitch?");
      expect(reading?.companyMedia ?? null).toEqual(expected);
    }
    expect(TURN_READER_LENIENT_FIELDS).toContain("companyMedia");
    const kept = acceptStructuredOutput(
      JSON.stringify({ ...BASE, companyMedia: "the video" }),
      TurnReaderV86ResultSchema,
      { lenientFields: TURN_READER_LENIENT_FIELDS },
    );
    expect(kept.ok && kept.value.companyMedia).toBeNull();
  });

  it("a malformed navigation intent costs itself, never the reading", () => {
    const raw = JSON.stringify({ ...BASE, navigation: "take me there" });
    const kept = acceptStructuredOutput(raw, TurnReaderV86ResultSchema, {
      lenientFields: TURN_READER_LENIENT_FIELDS,
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value).toMatchObject({
      kind: "QUESTION_TO_Q",
      navigation: null,
    });
  });
});
