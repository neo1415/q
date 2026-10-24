import { describe, expect, it } from "vitest";

import {
  CreateQVoiceSessionRequestSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";
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
import {
  createAcknowledgementWarmup,
  onboardingAcknowledgementCopy,
} from "../src/voice/acknowledgement-warmup.js";
import { codeReading } from "../src/voice/code-reading.js";
import { resumeTurnRef } from "../src/voice/onboarding-conductor.js";
import {
  acknowledgementIn,
  acknowledgementParts,
  figuresInDigits,
  FIXED_LEAD,
  OPTIONAL_ACKNOWLEDGEMENT_TAIL,
  quickAcknowledgement,
  RESEARCH_STARTED_LINE,
} from "../src/voice/quick-acknowledgement.js";
import { withoutUnbackedFieldClaims } from "../src/voice/onboarding-flow.js";
import { scaleDroppedIn } from "../src/voice/value-support.js";
import {
  createOnboardingPort,
  currencyNamedIn,
  fieldPartOf,
  moneyFiguresIn,
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
    // Covered by its concept family's answer (live AP): not unsaved.
    expect(
      unrecordedStatedIn(
        {
          steps: [
            {
              stepKey: "I7.sector_exclusions",
              status: "OPEN",
              coveredBy: "I7.avoid",
            },
          ],
        },
        new Set(["I7.sector_exclusions"]),
      ),
    ).toEqual([]);
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

describe("live AH: a long answer reads back by its opening words", () => {
  it("never 'your what the company does'", () => {
    const reply = quickAcknowledgement({
      results: [
        {
          stepKey: "F1.description",
          outcome: "COMMITTED",
          recorded:
            "We make solar cold rooms for market traders in Accra and Kumasi, rented by the day.",
        },
      ],
      labelOf: () => "What the company does",
      next: { question: "What stage is the company at?", optional: false },
      turnIndex: 0,
    });
    expect(reply).not.toMatch(/your what/iu);
    expect(reply).toMatch(
      /We make solar cold rooms for market traders in Accra… \(what the company does\)/u,
    );
  });

  it("a translated reply uses one fixed lead, whatever the turn", () => {
    for (const turnIndex of [0, 1, 2, 3]) {
      const parts = acknowledgementParts({
        results: [
          { stepKey: "F1.stage", outcome: "COMMITTED", recorded: "Seed" },
        ],
        labelOf: () => "Stage",
        next: { question: "Where are you based?", optional: false },
        turnIndex,
        fixedLead: true,
      });
      expect(parts?.lead).toBe(FIXED_LEAD);
    }
  });

  it("research starting is a fixed line in the code reply, not a model round", () => {
    const reply = quickAcknowledgement({
      results: [
        { stepKey: "F1.stage", outcome: "COMMITTED", recorded: "Seed" },
      ],
      labelOf: () => "Stage",
      next: { question: "Where are you based?", optional: false },
      turnIndex: 0,
      aside: RESEARCH_STARTED_LINE,
    });
    expect(reply).toBe(
      `Got it, I've saved Seed (stage). ${RESEARCH_STARTED_LINE} Where are you based?`,
    );
  });
});

describe("live AH: a bare web address is the website, whatever was asked", () => {
  const website = FOUNDER_DEFINITION_CURRENT.steps.find(
    (s) => s.stepKey === "F1.website",
  );
  const problem = FOUNDER_DEFINITION_CURRENT.steps.find(
    (s) => s.stepKey === "F9.problem",
  );
  it("reads 'tidewell.africa' as the website by code", () => {
    const read = codeReading({
      utterance: "tidewell.africa",
      asked: problem,
      pendingCount: 0,
      openWebsite: website,
    });
    expect([...(read?.stated ?? [])]).toEqual(["F1.website"]);
  });
  it("not a sentence that mentions one", () => {
    expect(
      codeReading({
        utterance: "we are on tidewell.africa now",
        asked: problem,
        pendingCount: 0,
        openWebsite: website,
      }),
    ).toBeNull();
  });
});

describe("live AH: figures their words give", () => {
  it("one figure in a raise, several in a busy turn", () => {
    expect(
      moneyFiguresIn(
        "actively raising about 750 thousand dollars on a SAFE",
      ).map((f) => f.value),
    ).toEqual([750_000]);
    expect(moneyFiguresIn("raising $1.5m").map((f) => f.value)).toEqual([
      1_500_000,
    ]);
    expect(
      moneyFiguresIn("raising half a million").map((f) => f.value),
    ).toEqual([500_000]);
    expect(moneyFiguresIn("raising 750k and we burn 25k a month").length).toBe(
      2,
    );
  });
});

describe("a chosen language warms the acknowledgement copy", () => {
  it("covers the lead, labels, choices, questions and tail; hand copy is left out", () => {
    const french = onboardingAcknowledgementCopy("founder", "fr");
    expect(french).toContain(FIXED_LEAD);
    expect(french).toContain(OPTIONAL_ACKNOWLEDGEMENT_TAIL);
    expect(french).toContain("stage");
    expect(french).toContain("US dollar");
    expect(french.some((line) => /what stage/iu.test(line))).toBe(true);
    const arabic = onboardingAcknowledgementCopy("founder", "ar");
    expect(arabic.some((line) => /what stage/iu.test(line))).toBe(false);
    expect(arabic).toContain("stage");
  });

  it("asks once per language, in bounded chunks, without waiting", async () => {
    const calls: { language: string; size: number; cachedOnly: boolean }[] = [];
    const warmup = createAcknowledgementWarmup({
      localise: (_actor, language, texts, options) => {
        calls.push({
          language,
          size: texts.length,
          cachedOnly: options.cachedOnly,
        });
        return Promise.resolve([]);
      },
    });
    const who = { tenantId: actor.tenantId, userId: actor.userId };
    warmup.warm(who, "fr", ["founder"]);
    warmup.warm(who, "fr", ["founder"]);
    warmup.warm(who, "en", ["founder"]);
    await Promise.resolve();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.language === "fr" && c.cachedOnly)).toBe(true);
    expect(calls.every((c) => c.size <= 40)).toBe(true);
    const total = calls.reduce((sum, c) => sum + c.size, 0);
    expect(total).toBe(onboardingAcknowledgementCopy("founder", "fr").length);
  });
});

describe("live AI: a new investor's categories in their first answer", () => {
  it("are planned again once that answer set up their profile", async () => {
    const said =
      "We're a VC fund, we invest in Europe and North Africa, mostly climate.";
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      taxonomy: {
        europe: "a0000000-0000-4000-8000-0000000000e1",
        "north africa": "a0000000-0000-4000-8000-0000000000e2",
        climate: "a0000000-0000-4000-8000-0000000000c1",
      },
      taxonomyUntil: "I0.investor_type",
    });
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () =>
        Promise.resolve(
          reading({
            stated: ["I0.investor_type", "I3.geography", "I3.sectors"],
          }),
        ),
    });
    const results = await port.record([
      {
        stepKey: "I0.investor_type",
        value: "vc",
        quote: "a VC fund",
        basis: "STATED",
        ownWords: false,
      },
      {
        stepKey: "I3.geography",
        value: ["Europe", "North Africa"],
        quote: "Europe and North Africa",
        basis: "STATED",
        ownWords: false,
      },
      {
        stepKey: "I3.sectors",
        value: ["climate"],
        quote: "mostly climate",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(results.map((r) => r.outcome)).toEqual([
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
    ]);
    expect(world.recordedValue("I3.geography")?.type).toBe(
      "RESOURCE_REFERENCE",
    );
  });
});

describe("live AI: a stated fact off their path is kept, by code", () => {
  it("revenue for a pre-seed company goes to their notes in its own words", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.description",
      recorded: { "F0.intent": "raising_now", "F1.company_name": "Lakeline" },
      ineligible: ["F5.revenue_status"],
    });
    const port = createOnboardingPort({
      session: turn(world, AG_FOUNDER).session,
      onboardingSessionId: turn(world, AG_FOUNDER).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [AG_FOUNDER],
    });
    const kept = await port.keepStated("F5.revenue_status", AG_FOUNDER);
    expect(kept?.outcome).toBe("COMMITTED");
    const notes = world.recordedValue("F7.follow_up");
    const text = notes?.type === "TEXT" ? notes.text : "";
    expect(text).toContain("first revenue only");
    expect(text).not.toContain("cold-chain");
  });
});

describe("live AI: the spoken opening of a section link opens on that section", () => {
  it("the voice session carries the section, validated like the typed one", () => {
    const base = {
      onboarding: {
        sessionId: "a0000000-0000-4000-8000-000000000001",
        journeyType: "founder",
      },
    };
    expect(
      CreateQVoiceSessionRequestSchema.safeParse({
        ...base,
        onboarding: { ...base.onboarding, focus: "moats" },
      }).success,
    ).toBe(true);
    expect(
      CreateQVoiceSessionRequestSchema.safeParse({
        ...base,
        onboarding: { ...base.onboarding, focus: "Moats; drop table" },
      }).success,
    ).toBe(false);
  });
});

describe("live AJ: a figure keeps its scale, in any language", () => {
  it("'400 mille euros' is 400,000, and 400 is refused", () => {
    expect(
      moneyFiguresIn("nous levons 400 mille euros").map((f) => f.value),
    ).toEqual([400_000]);
    expect(scaleDroppedIn("400", "nous levons 400 mille euros")).toBe(true);
    expect(scaleDroppedIn("400000", "nous levons 400 mille euros")).toBe(false);
    expect(scaleDroppedIn("2", "2 millones de dólares")).toBe(true);
    expect(scaleDroppedIn("11", "about 11 people")).toBe(false);
    expect(scaleDroppedIn("150", "150 mil reais")).toBe(true);
    // Said in words, Arabic duals included (live AP).
    expect(scaleDroppedIn("2", "نجمع مليوني دولار")).toBe(true);
    expect(scaleDroppedIn("2000000", "نجمع مليوني دولار")).toBe(false);
    expect(scaleDroppedIn("2", "raising two million")).toBe(true);
    expect(scaleDroppedIn("2", "2 founders, raising two million")).toBe(false);
    expect(
      moneyFiguresIn("نجمع حالياً مليوني دولار").map((f) => f.value),
    ).toEqual([2_000_000]);
  });

  it("the read-back has no English note and no doubled stops", () => {
    const reply = quickAcknowledgement({
      results: [
        {
          stepKey: "F1.country",
          outcome: "COMMITTED",
          recorded: "basés au Sénégal (in their words)",
        },
        {
          stepKey: "F1.description",
          outcome: "COMMITTED",
          recorded:
            "Nous proposons une plateforme de téléconsultation pour les pharmacies rurales au Sénégal.",
        },
      ],
      labelOf: (key) =>
        key === "F1.country" ? "Country" : "What the company does",
      next: { question: "What stage is the company at?", optional: false },
      turnIndex: 0,
    });
    expect(reply).not.toMatch(/in their words|\.\.|…\./u);
  });
});

describe("live AJ: no turn opens with a request the journey must refuse", () => {
  it("the firm's name from sign-up waits for how they invest", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      recorded: {},
    });
    const port = createOnboardingPort({
      session: turn(world, "").session,
      onboardingSessionId: turn(world, "").onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
    });
    expect(
      await port.recordFromSignup("I0.organisation_name", "Corvo Ventures"),
    ).toBe(false);
    expect(world.attempts()).not.toContain("I0.organisation_name");
  });
});

describe("live AL: a choice they never named is not saved", () => {
  it("'co-invest' for a partner who never said how they take part", async () => {
    const world = investorSession({ currentStepKey: "I2.investment_role" });
    const port = createOnboardingPort({
      session: turn(world, AG_INVESTOR).session,
      onboardingSessionId: turn(world, AG_INVESTOR).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [AG_INVESTOR],
      authority: () =>
        Promise.resolve(reading({ stated: ["I0.business_title"] })),
    });
    const [result] = await port.record([
      {
        stepKey: "I2.investment_role",
        value: ["co_invest"],
        quote: "it's a small VC fund out of Lisbon",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("REJECTED");
    expect(world.recordedValue("I2.investment_role")).toBeUndefined();
  });

  it("the same choice, named in their words, is saved", async () => {
    const said = "We usually co-invest alongside a lead.";
    const world = investorSession({ currentStepKey: "I2.investment_role" });
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () => Promise.resolve(reading({})),
    });
    const [result] = await port.record([
      {
        stepKey: "I2.investment_role",
        value: ["co_invest"],
        quote: "co-invest alongside a lead",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
  });
});

describe("live AL: Arabic read-back has no English labels", () => {
  it("choices go whole through the label path, and figures are written in digits", async () => {
    const said = "نعم، نجمع حالياً مليوني دولار عبر SAFE.";
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.raising",
      recorded: { "F0.intent": "raising_now", "F1.company_name": "Rimal" },
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
                      callId: "c1",
                      name: "record_answers",
                      arguments: {
                        answers: [
                          {
                            stepKey: "F6.raising",
                            value: "active",
                            quote: "نعم، نجمع حالياً",
                          },
                          {
                            stepKey: "F6.instrument",
                            value: "safe",
                            quote: "SAFE",
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
                  text: JSON.stringify({ reply: "x", asking: null }),
                },
              },
        );
      },
    } as unknown as ModelGateway;
    const labelled: string[] = [];
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation: readerOf(
        reading({ stated: ["F6.raising", "F6.instrument"] }),
      ),
      replyByCodeAfterCleanSave: true,
      standing: {
        read: () =>
          Promise.resolve({
            personality: "AUTO",
            language: "ar" as never,
            conduct: { suspended: false } as never,
          }),
        saveConduct: () => Promise.resolve(),
        setPersonality: () => Promise.resolve(),
        setLanguage: () => Promise.resolve(),
        suspend: () => Promise.resolve(false),
      } as never,
      localiseWords: (_a, _l, texts) => Promise.resolve(texts.map(() => "ع")),
      localiseLabels: (_a, _l, labels) => {
        labelled.push(...labels);
        return Promise.resolve(labels.map(() => "خيار"));
      },
    }).turn({ ...turn(world, said), actor });
    // Written by code (one model round), with the choices in Arabic.
    expect(calls).toBe(1);
    expect(outcome.reply).toContain("خيار");
    expect(labelled).toContain("Yes, actively");
    expect(outcome.reply).not.toMatch(/Yes, actively/u);
  });

  it("'$2 million' reads back as $2,000,000", () => {
    expect(figuresInDigits("$2 million")).toBe("$2,000,000");
    expect(figuresInDigits("€1.5m")).toBe("€1,500,000");
    expect(figuresInDigits("Seed")).toBe("Seed");
  });
});

describe("live AO: a figure in a translated read-back is written in digits", () => {
  it("'$2 million' becomes $2,000,000 in the composed reply", () => {
    const parts = acknowledgementParts({
      results: [
        {
          stepKey: "F6.target_amount",
          outcome: "COMMITTED",
          recorded: "$2 million",
        },
      ],
      labelOf: () => "Raise target",
      next: { question: "What early signal do you have?", optional: false },
      turnIndex: 0,
      fixedLead: true,
    });
    expect(parts).not.toBeNull();
    const reply = acknowledgementIn(
      parts as NonNullable<typeof parts>,
      (english) => `«${english}»`,
      () => null,
      { question: null, tail: null },
      { items: "؛ ", list: "، " },
    );
    expect(reply).toContain("$2,000,000");
    expect(reply).not.toMatch(/million/u);
  });
});

describe("live AO: category names come from the classifier, not a read per node", () => {
  it("reads back the categories it just resolved without fetching each node", async () => {
    const said = "We invest in Europe and North Africa.";
    const world = investorSession({
      currentStepKey: "I3.geography",
      taxonomy: {
        europe: "a0000000-0000-4000-8000-0000000000e1",
        "north africa": "a0000000-0000-4000-8000-0000000000e2",
      },
    });
    const fetched: string[] = [];
    const base = turn(world, said).session;
    const session = {
      ...base,
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (/\/taxonomy\/nodes\/[^/?]+$/u.test(url)) fetched.push(url);
        return (base.fetch ?? fetch)(input, init);
      }) as typeof fetch,
    };
    const port = createOnboardingPort({
      session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () => Promise.resolve(reading({ stated: ["I3.geography"] })),
    });
    const [result] = await port.record([
      {
        stepKey: "I3.geography",
        value: ["Europe", "North Africa"],
        quote: "Europe and North Africa",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(result?.recorded).toMatch(/Europe/u);
    expect(fetched).toEqual([]);
  });
});
