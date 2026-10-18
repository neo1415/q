import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Unknown stays unknown, at the write (ACC 2026-09-25, P5/P7): a turn
 * wrote cheque_typical = 62500, the midpoint of a range the person gave,
 * and business_title = "Angel investor" from "I'm an angel". Asserted on
 * what the session holds after the model's own tool calls.
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
function firewall(): ContextFirewallPort {
  const plan = {
    tenantId: actor.tenantId,
    actor: { userId: actor.userId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [
      {
        kind: "OWN_ONBOARDING",
        filter: { tenantId: actor.tenantId, userId: actor.userId },
        sensitivity: "CONFIDENTIAL",
      },
    ],
    maxSensitivity: "CONFIDENTIAL",
  } as unknown as PermittedContextPlan;
  return { plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }) };
}

type Answer = {
  stepKey: string;
  value: string | number;
  quote: string;
  basis?: "STATED" | "DELEGATED";
};

/** A model that records `answers` once, then replies; keeps what it was told. */
function recordingModel(answers: readonly Answer[]) {
  const seen: string[] = [];
  let round = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      round += 1;
      if (round === 1) {
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: [
              {
                callId: "call_1",
                name: "record_answers",
                arguments: { answers },
              },
            ],
          },
        });
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({ reply: "Noted.", asking: null }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

async function run(
  answers: readonly Answer[],
  utterance: string,
  recentTurns: readonly { role: "person" | "q"; text: string }[] = [],
  handed: readonly string[] = [],
) {
  const world = investorSession({ currentStepKey: "I2.cheque_min" });
  const { gateway, seen } = recordingModel(answers);
  const agent = createInterviewAgent({
    gateway,
    firewall: firewall(),
    logger,
    recommendations: world.recommendations,
    // The reading finds every STATED item stated, so these tests isolate
    // the value-support layer; the self-statement gate has its own.
    delegation: readerOf(
      reading({
        handed,
        stated: answers
          .filter((a) => a.basis !== "DELEGATED")
          .map((a) => a.stepKey),
      }),
    ),
  });
  const outcome = await agent.turn({
    ...turn(world, utterance),
    recentTurns: [...recentTurns],
    actor,
  });
  return { world, outcome, seen };
}

describe("a stated figure must be in the person's words", () => {
  it("records the ends of the range they gave and refuses a midpoint nobody said", async () => {
    const said = "cheques from 25 to 100 thousand US dollars";
    const { world, outcome, seen } = await run(
      [
        { stepKey: "I2.cheque_min", value: 25000, quote: said },
        { stepKey: "I2.cheque_max", value: 100000, quote: said },
        { stepKey: "I2.cheque_typical", value: 62500, quote: said },
      ],
      said,
    );
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "25000",
    });
    expect(world.recordedValue("I2.cheque_max")).toEqual({
      type: "RANGE",
      value: "100000",
    });
    expect(world.recordedValue("I2.cheque_typical")).toBeUndefined();
    expect(outcome.recorded).not.toContain("I2.cheque_typical");
    // The model is told why, so its reply can be honest about it.
    expect(seen.at(-1)).toContain("not one they stated");
  });

  it("a figure Q read back and they confirmed is theirs", async () => {
    const { world } = await run(
      [{ stepKey: "I2.cheque_typical", value: 50000, quote: "yes" }],
      "yes",
      [
        { role: "person", text: "typically about fifty thousand" },
        { role: "q", text: "A typical cheque of $50,000 — is that right?" },
      ],
    );
    expect(world.recordedValue("I2.cheque_typical")).toEqual({
      type: "RANGE",
      value: "50000",
    });
  });

  it("an advisory question writes nothing, whatever figure the model reaches for", async () => {
    const asked = "what's a typical cheque size at pre-seed?";
    const { world } = await run(
      [{ stepKey: "I2.cheque_typical", value: 50000, quote: asked }],
      asked,
    );
    expect(world.recordedValue("I2.cheque_typical")).toBeUndefined();
  });

  it("a figure they explicitly delegated is Q's choice by their authority", async () => {
    const asked = "pick a sensible typical cheque for me and go with it";
    const { world } = await run(
      [
        {
          stepKey: "I2.cheque_typical",
          value: 50000,
          quote: asked,
          basis: "DELEGATED",
        },
      ],
      asked,
      [],
      ["I2.cheque_typical"],
    );
    expect(world.recordedValue("I2.cheque_typical")).toEqual({
      type: "RANGE",
      value: "50000",
    });
  });
});

describe("a figure stated once answers one step", () => {
  it("an end of the range they gave is not also their typical cheque", async () => {
    const said = "cheques from 25 to 100 thousand US dollars";
    const { world } = await run(
      [
        { stepKey: "I2.cheque_min", value: 25000, quote: said },
        { stepKey: "I2.cheque_typical", value: 25000, quote: said },
      ],
      said,
    );
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "25000",
    });
    expect(world.recordedValue("I2.cheque_typical")).toBeUndefined();
  });

  it("a figure they said twice can answer two steps", async () => {
    const said = "minimum 25k, and typically 25k as well";
    const { world } = await run(
      [
        { stepKey: "I2.cheque_min", value: 25000, quote: said },
        { stepKey: "I2.cheque_typical", value: 25000, quote: said },
      ],
      said,
    );
    expect(world.recordedValue("I2.cheque_typical")).toEqual({
      type: "RANGE",
      value: "25000",
    });
  });
});

describe("a question is never a delegation", () => {
  it("a figure labelled DELEGATED on an advisory question writes nothing", async () => {
    const asked = "What's a typical cheque for pre-seed these days?";
    const { world } = await run(
      [
        {
          stepKey: "I2.cheque_typical",
          value: 50000,
          quote: asked,
          basis: "DELEGATED",
        },
      ],
      asked,
    );
    expect(world.recordedValue("I2.cheque_typical")).toBeUndefined();
  });
});

describe("free text must be the person's own words", () => {
  it("refuses another step's answer restated as a title, and keeps their own words", async () => {
    const said =
      "I'm an angel, I invest personally through Harrow Road Capital, I'm a partner there";
    const { world } = await run(
      [
        { stepKey: "I0.business_title", value: "Angel investor", quote: said },
        {
          stepKey: "I0.organisation_name",
          value: "Harrow Road Capital",
          quote: said,
        },
      ],
      said,
    );
    expect(world.recordedValue("I0.business_title")).toBeUndefined();
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Harrow Road Capital",
    });

    const second = await run(
      [{ stepKey: "I0.business_title", value: "Partner", quote: said }],
      said,
    );
    expect(second.world.recordedValue("I0.business_title")).toEqual({
      type: "TEXT",
      text: "Partner",
    });
  });
});
