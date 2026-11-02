import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 23:02Z on production 24af1559a (fictional investor
 * "Nordbrücke Ventures", typed). After 3ad1a6726 held B2B SaaS as Q's
 * reading of "recurring revenue", Q asked "should I keep recurring revenue
 * as your business-model preference"; "Yes, keep it" then wrote B2B SaaS
 * as user_selected STRONG (source_modality SELECTION) -- a category never
 * said to them. Two routes could write it: the held suggestion accepted on
 * the reading's "approved" (typed path), and an affirmed reading whose
 * category check was skipped. Both now bind the yes to the Q line it
 * answered: a category that line did not name stays Q's reading.
 * No live model: the taxonomy lookup and the authority are fakes.
 */
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000002",
  tenantId: "c0000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000002",
};
const B2B_SAAS = "d0000000-0000-4000-8000-0000000000c5";
const MODELS = "I4.business_models";
const SAID = "We back B2B companies with recurring revenue.";
const YES = "Yes, keep it.";
const KEEP_WORDS =
  "Should I keep recurring revenue as your business-model preference?";
const NAMED = 'I read "recurring revenue" as B2B SaaS. Is that right?';
const SAAS = {
  type: "RESOURCE_REFERENCE" as const,
  resourceType: "TAXONOMY_NODE" as const,
  resourceIds: [B2B_SAAS],
};

function world() {
  return investorSession({
    currentStepKey: MODELS,
    subject: FIRM,
    servesTurnSteps: true,
    recorded: {
      "I0.investor_type": "vc",
      "I0.organisation_name": "Nordbrücke Ventures",
    },
    // The lookup's nearest category for their words, not by its name.
    taxonomyAmbiguous: {
      "recurring revenue": [{ nodeId: B2B_SAAS, displayName: "B2B SaaS" }],
    },
  });
}

function portFor(
  w: ReturnType<typeof world>,
  options: {
    readonly said: readonly string[];
    readonly lastQTurn?: string;
    readonly affirmed?: readonly string[];
    readonly approved?: readonly string[];
  },
) {
  const latest = options.said[0] ?? SAID;
  return createOnboardingPort({
    session: turn(w, latest).session,
    onboardingSessionId: turn(w, latest).onboardingSessionId,
    journeyType: "investor",
    ownerUserId: actor.userId,
    personTurns: options.said,
    recommendations: w.recommendations,
    authority: () =>
      Promise.resolve(
        authorityReading({
          stated: options.approved === undefined ? [MODELS] : [],
          approved: options.approved ?? [],
        }),
      ),
    ...(options.lastQTurn === undefined
      ? {}
      : { lastQTurn: options.lastQTurn }),
    ...(options.affirmed === undefined
      ? {}
      : { affirmed: new Set(options.affirmed) }),
  });
}

/** Their first words: B2B SaaS held as Q's reading, nothing recorded. */
async function held(w: ReturnType<typeof world>) {
  const [first] = await portFor(w, { said: [SAID] }).record([
    {
      stepKey: MODELS,
      value: ["recurring revenue"],
      quote: SAID,
      basis: "STATED",
      ownWords: false,
    },
  ]);
  expect(first?.outcome).toBe("REJECTED");
  expect(w.recordedValue(MODELS)).toBeUndefined();
}

const pending = (w: ReturnType<typeof world>) =>
  w
    .heldSuggestions()
    .filter((s) => s.stepKey === MODELS && s.status === "PENDING")
    .map((s) => s.value);

describe("a yes binds to the Q line it answered (live 2026-10-31 23:02)", () => {
  it("accept: 'Yes, keep it' to their own words never accepts B2B SaaS", async () => {
    const w = world();
    await held(w);
    const [result] = await portFor(w, {
      said: [YES, SAID],
      lastQTurn: KEEP_WORDS,
      approved: [MODELS],
    }).accept([MODELS]);
    expect(result?.outcome).toBe("REJECTED");
    expect(result?.reason).toMatch(/did not name B2B SaaS/u);
    expect(w.recordedValue(MODELS)).toBeUndefined();
    expect(pending(w)).toEqual([SAAS]);
  });

  it("accept: a yes to the line that named it is their choice", async () => {
    const w = world();
    await held(w);
    const [result] = await portFor(w, {
      said: [YES, SAID],
      lastQTurn: NAMED,
      approved: [MODELS],
    }).accept([MODELS]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(w.recordedValue(MODELS)).toEqual(SAAS);
  });

  it("accept: no Q line known is never a yes to a category", async () => {
    const w = world();
    await held(w);
    const [result] = await portFor(w, {
      said: [YES, SAID],
      approved: [MODELS],
    }).accept([MODELS]);
    expect(result?.outcome).toBe("REJECTED");
    expect(w.recordedValue(MODELS)).toBeUndefined();
  });

  it("reading: an affirmed 'yes' to their own words holds the category, records nothing", async () => {
    const w = world();
    const [result] = await portFor(w, {
      said: [YES, SAID],
      lastQTurn: KEEP_WORDS,
      affirmed: [MODELS],
    }).record([
      {
        stepKey: MODELS,
        value: ["recurring revenue"],
        quote: YES,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("REJECTED");
    expect(result?.reason).toMatch(/B2B SaaS is your reading/u);
    expect(w.recordedValue(MODELS)).toBeUndefined();
    expect(pending(w)).toEqual([SAAS]);
  });

  it("reading: an affirmed 'yes' to the line that named it is recorded", async () => {
    const w = world();
    const [result] = await portFor(w, {
      said: [YES, SAID],
      lastQTurn: NAMED,
      affirmed: [MODELS],
    }).record([
      {
        stepKey: MODELS,
        value: ["recurring revenue"],
        quote: YES,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(w.recordedValue(MODELS)).toEqual(SAAS);
  });
});
