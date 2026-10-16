import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInterviewAgent,
  turnNotesFor,
  unrecordedStatedIn,
} from "../src/voice/interview-agent.js";
import { resumeTurnRef } from "../src/voice/onboarding-conductor.js";
import { withoutUnbackedFieldClaims } from "../src/voice/onboarding-flow.js";
import {
  currencyNamedIn,
  fieldPartOf,
  phrasesNamedIn,
} from "../src/voice/onboarding-port.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/** Live acceptance on release AG (2026-10-16), each defect pinned. */

const AG_FOUNDER =
  "So basically we run cold-chain trucking software for fishermen around Lake Victoria, connecting them to buyers in Kampala. We're kind of pre-seed. Based in Uganda. I'm the chief everything officer, honestly, plus I write code. Three founders, two full time, about 11 people. We already have first revenue only, from two co-ops. We're actively raising about 500 thousand dollars, probably on a SAFE.";
const AG_INVESTOR =
  "Hey, so I'm a partner at Corvo Ventures, it's a small VC fund out of Lisbon. We're actively investing, cheques usually 150k to 400k euros, typical maybe 250k, mostly seed, sometimes pre-seed. We like climate, logistics and anything that makes ports less painful. Europe and North Africa. Honestly we also back a lot of second-time founders, and we never do gambling or tobacco.";

const currencyStep = () => {
  const step = FOUNDER_DEFINITION_CURRENT.steps.find(
    (s) => s.stepKey === "F6.currency",
  );
  if (step === undefined) throw new Error("no currency step");
  return step;
};

describe("a currency they named is theirs, never asked again", () => {
  it("'500 thousand dollars' with no other currency is the US dollar", () => {
    expect(currencyNamedIn("founder", currencyStep(), AG_FOUNDER)).toEqual({
      optionKey: "usd",
      quote: "dollars",
    });
  });

  it("other unambiguous names hold too", () => {
    for (const [text, key] of [
      ["raising 2 million euros", "eur"],
      ["about 300k pounds", "gbp"],
      ["50 million naira", "ngn"],
      ["1.5m dirhams", "aed"],
      ["2 million singapore dollars", "sgd"],
    ] as const) {
      const named = currencyNamedIn("founder", currencyStep(), text);
      expect(
        named === null || named === "SEVERAL" ? named : named.optionKey,
        text,
      ).toBe(key);
    }
  });

  it("another country's dollar, two currencies, or no figure: nothing is assumed", () => {
    expect(
      currencyNamedIn("founder", currencyStep(), "2 million Canadian dollars"),
    ).toBeNull();
    expect(
      currencyNamedIn(
        "founder",
        currencyStep(),
        "500k, part euros part dollars",
      ),
    ).toBe("SEVERAL");
    expect(
      currencyNamedIn("founder", currencyStep(), "we sell in dollars mostly"),
    ).toBeNull();
  });

  it("code records it in the turn, and the reply reads it back as US dollars", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.target_amount",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Lakeline Cold Chain",
        "F6.raising": "active",
      },
    });
    let calls = 0;
    const gateway = {
      execute: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                output: {
                  kind: "TOOL_CALLS",
                  calls: [
                    {
                      callId: "call_1",
                      name: "record_answers",
                      arguments: {
                        answers: [
                          {
                            stepKey: "F6.target_amount",
                            value: 500_000,
                            quote: "about 500 thousand dollars",
                          },
                        ],
                      },
                    },
                  ],
                },
              }
            : {
                output: {
                  kind: "TEXT",
                  text: JSON.stringify({ reply: "Next?", asking: null }),
                },
              },
        );
      },
    } as unknown as ModelGateway;
    const said = "We're raising about 500 thousand dollars.";
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F6.target_amount"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(world.recordedValue("F6.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "usd",
    });
    expect(outcome.reply).toContain("US dollars");
    expect(outcome.reply).not.toMatch(/which currency/iu);
  });
});

describe("categories they named are their statement, not Q's proposal", () => {
  it("every phrase is in their quote", () => {
    expect(
      phrasesNamedIn(["Europe", "North Africa"], "Europe and North Africa"),
    ).toBe(true);
    expect(
      phrasesNamedIn(
        ["climate", "logistics"],
        "We like climate, logistics and anything that makes ports less painful",
      ),
    ).toBe(true);
    expect(phrasesNamedIn(["fintech"], "anything that helps farmers")).toBe(
      false,
    );
  });
});

describe("only the field's part of their words is saved for it", () => {
  it("the exclusions, not the whole opening statement", () => {
    const part = fieldPartOf(AG_INVESTOR, "gambling, tobacco");
    expect(part).toContain("gambling or tobacco");
    expect(part).not.toMatch(/Lisbon|Corvo|cheques/u);
  });

  it("a short quote stands as it is", () => {
    expect(fieldPartOf("Based in Uganda", "Uganda")).toBe("Based in Uganda");
  });
});

describe("no field is said to be saved unless it is on the record", () => {
  it("drops the live claim about geography and sectors", () => {
    const reply =
      "I've saved your role, cheque range, stages, geography, sectors, founder preference, and exclusions. One thing remains: how adventurous should discovery be?";
    const out = withoutUnbackedFieldClaims(reply, ["Geography", "Sectors"]);
    expect(out).not.toMatch(/saved/iu);
    expect(out).toMatch(/how adventurous should discovery be\?$/u);
  });

  it("keeps a claim about fields that are saved, and an honest 'not yet'", () => {
    const saved = "Saved your stage and cheque range. Where do you invest?";
    expect(withoutUnbackedFieldClaims(saved, ["Geography"])).toBe(saved);
    const honest = "Geography isn't saved yet. Where do you invest?";
    expect(withoutUnbackedFieldClaims(honest, ["Geography"])).toBe(honest);
  });
});

describe("stated but not on the record: the next round is told to record it", () => {
  it("names each open stated step first in the notes", () => {
    const open = unrecordedStatedIn(
      {
        steps: [
          { stepKey: "I3.geography", status: "OPEN" },
          { stepKey: "I2.stages", status: "ANSWERED" },
        ],
      },
      new Set(["I3.geography", "I2.stages"]),
    );
    expect(open).toEqual(["I3.geography"]);
    const notes = turnNotesFor({
      pausing: false,
      lookup: null,
      pronounce: null,
      unrecordedStated: ["Geography (I3.geography)"],
    });
    expect(notes).toMatch(/^NOT SAVED YET: .*Geography \(I3\.geography\)/u);
  });
});

describe("one resume line per reopening", () => {
  it("two opens of the same state share one idempotent reference", () => {
    const a = resumeTurnRef("s1", "2|t|Picking up where we left off.");
    expect(resumeTurnRef("s1", "2|t|Picking up where we left off.")).toBe(a);
    expect(resumeTurnRef("s1", "3|u|Picking up where we left off.")).not.toBe(
      a,
    );
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const firewall: ContextFirewallPort = {
  plan: () =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: {
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
      } as unknown as PermittedContextPlan,
    }),
};
