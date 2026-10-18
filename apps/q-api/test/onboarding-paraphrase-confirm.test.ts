import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import {
  heardBack,
  readBackReplyOf,
} from "../src/voice/paraphrase-confirmation.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Owner live 2026-10-17 ("NEM Insurance"): Q refused every clean summary of
 * a spoken narrative answer because it was not the founder's exact words,
 * and asked them to say it again "in your own words". A narrative answer
 * is now summarised, read back, and saved on their yes; a summary they
 * never heard or never agreed to is still never on the record (P0-2).
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

type Answer = { stepKey: string; value: string; quote: string };

const RAMBLING =
  "Okay, so we, we are an insurance company, basically... we mainly do non-life insurance, and our specialty is in um-motor insurance, and now we are moving into life insurance and tech, so a full package of insurance";
const SUMMARY =
  "NEM Insurance is a non-life insurer focused on motor cover, now expanding into life insurance and tech.";
const READ_BACK = `So ${SUMMARY.replace(/\.$/u, "")} - shall I save that?`;

const OPPORTUNITY_SAID =
  "Salvage is a big deal here, every insurer writes off cars every week and they sell them for almost nothing, so the opportunity is getting the best price for every salvage across all the insurers in the country";
const OPPORTUNITY =
  "Every insurer writes off cars weekly and sells the salvage for almost nothing; the opportunity is the best price for every salvage across the country's insurers.";

function founderWorld() {
  return investorSession({
    journey: "founder",
    currentStepKey: "F1.description",
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "NEM Insurance",
    },
  });
}

/** One interview agent over one world, turn after turn. */
function interview(world = founderWorld()) {
  return {
    world,
    say: async (
      utterance: string,
      recentTurns: readonly { role: "person" | "q"; text: string }[],
      answers: readonly Answer[] = [],
    ) => {
      // One model per turn: each turn's first round is its record round.
      let round = 0;
      const told: string[] = [];
      const perTurn = createInterviewAgent({
        gateway: {
          execute: (request: {
            readonly messages: readonly { readonly content: string }[];
          }) => {
            told.push(request.messages.map((m) => m.content).join("\n"));
            round += 1;
            return round === 1 && answers.length > 0
              ? Promise.resolve({
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
                })
              : Promise.resolve({
                  output: {
                    kind: "TEXT",
                    text: JSON.stringify({ reply: "Noted.", asking: null }),
                  },
                });
          },
        } as unknown as ModelGateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(
          reading({ stated: answers.map((a) => a.stepKey) }),
        ),
      });
      const outcome = await perTurn.turn({
        ...turn(world, utterance),
        recentTurns: [...recentTurns],
        actor,
      });
      return { outcome, told };
    },
    pending: async () =>
      world.recommendations.pending({
        userId: actor.userId,
        sessionId: turn(world, "").onboardingSessionId,
      }),
  };
}

const REFUSALS = [
  "not in their words",
  "exact words, so",
  "in their own words, and only",
  "Only their own words can put",
];
function expectNoWordsRefusal(told: readonly string[]) {
  const last = told.at(-1) ?? "";
  for (const refusal of REFUSALS) expect(last).not.toContain(refusal);
}

describe("a narrative answer is summarised, read back and saved on their yes", () => {
  it("holds Q's summary of a rambling description instead of refusing it", async () => {
    const q = interview();
    const { told } = await q.say(
      RAMBLING,
      [],
      [{ stepKey: "F1.description", value: SUMMARY, quote: RAMBLING }],
    );
    expect(q.world.recordedValue("F1.description")).toBeUndefined();
    expectNoWordsRefusal(told);
    expect(told.at(-1)).toContain("Held for their confirmation");
    const pending = await q.pending();
    expect(pending.map((p) => p.stepKey)).toEqual(["F1.description"]);
    expect(pending[0]?.value).toEqual({ type: "TEXT", text: SUMMARY });
    // Their original words are kept with the summary as its source.
    expect(pending[0]?.rationale).toContain("we mainly do non-life insurance");
  });

  it("saves exactly the summary they agreed to, by code, on a plain yes", async () => {
    const q = interview();
    await q.say(
      RAMBLING,
      [],
      [{ stepKey: "F1.description", value: SUMMARY, quote: RAMBLING }],
    );
    const { told } = await q.say("Yes, that's right.", [
      { role: "person", text: RAMBLING },
      { role: "q", text: READ_BACK },
    ]);
    expect(q.world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: SUMMARY,
    });
    expect(await q.pending()).toEqual([]);
    expectNoWordsRefusal(told);
  });

  it("a correction saves nothing; the revised summary is held and confirmed again", async () => {
    const q = interview();
    await q.say(
      RAMBLING,
      [],
      [{ stepKey: "F1.description", value: SUMMARY, quote: RAMBLING }],
    );
    const correction = "No, life insurance is already live, not just planned";
    const revised =
      "NEM Insurance is a non-life insurer focused on motor cover, with life insurance already live and tech next.";
    await q.say(
      correction,
      [
        { role: "person", text: RAMBLING },
        { role: "q", text: READ_BACK },
      ],
      [{ stepKey: "F1.description", value: revised, quote: correction }],
    );
    expect(q.world.recordedValue("F1.description")).toBeUndefined();
    const pending = await q.pending();
    expect(pending.map((p) => p.value)).toEqual([
      { type: "TEXT", text: revised },
    ]);
    await q.say("Yes.", [
      { role: "person", text: correction },
      { role: "q", text: `So ${revised} Shall I save that?` },
    ]);
    expect(q.world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: revised,
    });
  });

  it('"go ahead and paraphrase it" after a read-back saves the summary', async () => {
    const q = interview();
    await q.say(
      RAMBLING,
      [],
      [{ stepKey: "F1.description", value: SUMMARY, quote: RAMBLING }],
    );
    await q.say(
      "No, just go ahead and paraphrase it, and save what you paraphrase. I give you permission",
      [
        { role: "person", text: RAMBLING },
        { role: "q", text: READ_BACK },
      ],
    );
    expect(q.world.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: SUMMARY,
    });
  });

  it("the opportunity from the transcript ends saved, even when permission came before any read-back", async () => {
    const q = interview();
    // Q offered no summary yet; their permission gets one held from their
    // earlier words, not a refusal that "permission is not the answer".
    const permission = "Go ahead and paraphrase it";
    const { told } = await q.say(
      permission,
      [
        { role: "q", text: "How big is the opportunity?" },
        { role: "person", text: OPPORTUNITY_SAID },
        { role: "q", text: "Got it." },
      ],
      [
        {
          stepKey: "F9.opportunity",
          value: OPPORTUNITY,
          quote: OPPORTUNITY_SAID,
        },
      ],
    );
    expectNoWordsRefusal(told);
    expect(told.at(-1)).not.toContain("do not state this about themselves");
    expect(q.world.recordedValue("F9.opportunity")).toBeUndefined();
    await q.say("Yes, save it.", [
      { role: "person", text: permission },
      { role: "q", text: `So: ${OPPORTUNITY} Shall I save that?` },
    ]);
    expect(q.world.recordedValue("F9.opportunity")).toEqual({
      type: "TEXT",
      text: OPPORTUNITY,
    });
  });
});

describe("P0-2 stays: nothing they did not hear and agree to is written", () => {
  it("a summary never read back to them is not saved by their yes", async () => {
    const q = interview();
    await q.say(
      RAMBLING,
      [],
      [{ stepKey: "F1.description", value: SUMMARY, quote: RAMBLING }],
    );
    await q.say("Yes.", [
      { role: "person", text: RAMBLING },
      { role: "q", text: "Shall I save that?" },
    ]);
    expect(q.world.recordedValue("F1.description")).toBeUndefined();
  });

  it("an unproposed invented value carried by a bare yes is held, never written", async () => {
    const q = interview();
    const invented =
      "NEM Insurance is the largest insurer in West Africa with 40 percent market share.";
    await q.say(
      "Yes.",
      [
        { role: "person", text: RAMBLING },
        { role: "q", text: READ_BACK },
      ],
      [{ stepKey: "F1.description", value: invented, quote: "Yes." }],
    );
    expect(q.world.recordedValue("F1.description")).toBeUndefined();
  });

  it("a short text step (a name, a title) still records only their own words", async () => {
    const world = investorSession({ currentStepKey: "I0.business_title" });
    const q = interview(world);
    const said = "I'm an angel, I invest personally";
    await q.say(
      said,
      [],
      [{ stepKey: "I0.business_title", value: "Angel investor", quote: said }],
    );
    expect(world.recordedValue("I0.business_title")).toBeUndefined();
    expect(await q.pending()).toEqual([]);
  });
});

describe("the read-back reply, decided by code where it is plain", () => {
  it.each([
    ["yes", "AFFIRM"],
    ["Yes, that's right.", "AFFIRM"],
    ["Go ahead and paraphrase it", "AFFIRM"],
    [
      "No, just go ahead and paraphrase it, and save what you paraphrase. I give you permission",
      "AFFIRM",
    ],
    ["save it", "AFFIRM"],
    ["No, we also do life insurance", "CORRECT"],
    ["Yes, but add that we are in Lagos", "CORRECT"],
    ["Don't save it yet", "CORRECT"],
    ["What would you save?", "UNCLEAR"],
    [RAMBLING, "UNCLEAR"],
  ] as const)("%s -> %s", (said, expected) => {
    expect(readBackReplyOf(said)).toBe(expected);
  });

  it("a summary is heard back when Q's line carries its words", () => {
    expect(heardBack(SUMMARY, READ_BACK)).toBe(true);
    expect(
      heardBack(
        "We are a non-life insurer.",
        "So you are a non-life insurer - right?",
      ),
    ).toBe(true);
    expect(
      heardBack(
        "We are not a life insurer.",
        "So you are a life insurer - right?",
      ),
    ).toBe(false);
    expect(heardBack(SUMMARY, undefined)).toBe(false);
  });
});
