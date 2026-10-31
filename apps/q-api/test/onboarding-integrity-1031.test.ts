import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingPort,
  saysBeyond,
} from "../src/voice/onboarding-port.js";
import {
  figuresOf,
  withoutUnsavedRecordClaims,
} from "../src/voice/typed-onboarding.js";
import { categoryNamedIn } from "../src/voice/value-support.js";

import { reading as authorityReading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live check 2026-10-31 ~20:20-20:45Z on production 857aa249a (fictional
 * investor "Fjordlight Harbour Capital", founder "Kivisild Locker
 * Network", typed). No live model: the category chooser is a fake.
 *
 * 1. "We back B2B companies with recurring revenue": the reader gave "B2B"
 *    for the business models; the lookup's one candidate was "B2B SaaS"
 *    (not exact), taken as named, and the mandate saved B2B SaaS with
 *    source user_selected: Q's reading recorded as their declaration.
 * 2. "3 paying customers, 40 lockers in 12 towns": "Paying customers" was
 *    named by its label, so the chooser (and its `beyond`) never ran and
 *    the lockers were saved nowhere; after "Skip the rest." Q said "Your
 *    profile reflects … 40 lockers across 12 towns".
 */
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000001",
};
const COMPANY = {
  type: "COMPANY" as const,
  id: "e0000000-0000-4000-8000-0000000000aa",
};
const B2B_SAAS = "d0000000-0000-4000-8000-0000000000b5";
const BUSINESS_CUSTOMER = "d0000000-0000-4000-8000-0000000000b6";
const MODELS = "I4.business_models";
const SAID = "We back B2B companies with recurring revenue.";

function modelsWorld() {
  return investorSession({
    currentStepKey: MODELS,
    subject: FIRM,
    servesTurnSteps: true,
    recorded: {
      "I0.investor_type": "vc",
      "I0.organisation_name": "Fjordlight Harbour Capital",
    },
    // As live: "B2B" in the business-model vocabulary finds one category,
    // not by its name ("CANDIDATES", candidateCount 1).
    taxonomyAmbiguous: {
      b2b: [{ nodeId: B2B_SAAS, displayName: "B2B SaaS" }],
    },
    // In the customer-type vocabulary "B2B" is a listed synonym (EXACT).
    taxonomy: { "business customer": BUSINESS_CUSTOMER },
  });
}

function portFor(
  w: ReturnType<typeof modelsWorld>,
  options: {
    readonly affirmed?: readonly string[];
    readonly said?: readonly string[];
  } = {},
) {
  return createOnboardingPort({
    session: turn(w, SAID).session,
    onboardingSessionId: turn(w, SAID).onboardingSessionId,
    journeyType: "investor",
    ownerUserId: actor.userId,
    personTurns: options.said ?? [SAID],
    recommendations: w.recommendations,
    authority: () => Promise.resolve(authorityReading({ stated: [MODELS] })),
    ...(options.affirmed === undefined
      ? {}
      : { affirmed: new Set(options.affirmed) }),
  });
}

describe("1. a mandate category their words do not name is Q's reading, held for their yes", () => {
  it('"B2B" is never saved as B2B SaaS: held as Q\'s suggestion, nothing recorded', async () => {
    const w = modelsWorld();
    const [result] = await portFor(w).record([
      {
        stepKey: MODELS,
        value: ["B2B"],
        quote: SAID,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("REJECTED");
    expect(result?.reason).toMatch(/B2B SaaS is your reading/u);
    expect(result?.reason).toMatch(/Never say it is saved/u);
    expect(w.recordedValue(MODELS)).toBeUndefined();
    const held = w
      .heldSuggestions()
      .filter((s) => s.stepKey === MODELS && s.status === "PENDING");
    expect(held.map((s) => s.value)).toEqual([
      {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [B2B_SAAS],
      },
    ]);
  });

  it("their yes to it is their choice: recorded", async () => {
    const w = modelsWorld();
    const [result] = await portFor(w, {
      affirmed: [MODELS],
      said: ["Yes, B2B SaaS is right.", SAID],
    }).record([
      {
        stepKey: MODELS,
        value: ["B2B"],
        quote: "Yes, B2B SaaS is right.",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(w.recordedValue(MODELS)).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [B2B_SAAS],
    });
  });

  it("a category they name is saved as theirs at once", async () => {
    const w = investorSession({
      currentStepKey: "I3.sectors",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Fjordlight Harbour Capital",
      },
      taxonomy: { fintech: "d0000000-0000-4000-8000-0000000000f1" },
    });
    const said = "Sectors: fintech.";
    const [result] = await createOnboardingPort({
      session: turn(w, said).session,
      onboardingSessionId: turn(w, said).onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [said],
      recommendations: w.recommendations,
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["I3.sectors"] })),
    }).record([
      {
        stepKey: "I3.sectors",
        value: ["fintech"],
        quote: said,
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    expect(w.heldSuggestions()).toEqual([]);
  });

  it("named, structurally: every word of the category's name is theirs", () => {
    expect(categoryNamedIn("B2B SaaS", [SAID])).toBe(false);
    expect(categoryNamedIn("Fintech", ["fintech and payments"])).toBe(true);
    expect(categoryNamedIn("Healthcare", ["health and care"])).toBe(true);
    expect(
      categoryNamedIn("Manufacturing & Industrial", ["industrial automation"]),
    ).toBe(false);
    expect(categoryNamedIn("Nordics", ["the Nordic countries"])).toBe(true);
  });
});

describe("2a. their words beyond an option named by its label are kept", () => {
  const LOCKERS = "3 paying customers, 40 lockers in 12 towns";

  it('"40 lockers in 12 towns" is the note beside "Paying customers"', async () => {
    const w = investorSession({
      journey: "founder",
      currentStepKey: "F5.signal",
      subject: COMPANY,
      servesTurnSteps: true,
      recorded: { "F1.stage": "seed" },
    });
    const asked: string[] = [];
    const port = createOnboardingPort({
      session: turn(w, LOCKERS).session,
      onboardingSessionId: turn(w, LOCKERS).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [LOCKERS],
      authority: () =>
        Promise.resolve(authorityReading({ stated: ["F5.signal"] })),
      chooseCategories: (choice) => {
        asked.push(choice.sentence);
        const paying = choice.candidates.find(
          (c) => c.displayName === "Paying customers",
        );
        return Promise.resolve(
          Object.assign(paying === undefined ? [] : [paying.nodeId], {
            beyond: "40 lockers in 12 towns",
          }),
        );
      },
    });
    const [result] = await port.record([
      {
        stepKey: "F5.signal",
        // As live: named by its label, so no reading by meaning ran.
        value: "Paying customers",
        quote: "3 paying customers",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(result?.outcome).toBe("COMMITTED");
    // Their whole turn is read (the answer may be resolved more than once).
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set([LOCKERS]));
    expect(w.recordedValue("F5.signal")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "paying",
    });
    expect(w.recordedNote("F5.signal")).toBe("40 lockers in 12 towns");
    const state = await port.state();
    expect(state.steps.find((s) => s.stepKey === "F5.signal")?.value).toMatch(
      /Also said: 40 lockers in 12 towns/u,
    );
  });

  it("a turn that is the option and its count asks no reading", () => {
    expect(saysBeyond("3 paying customers", ["Paying customers"])).toBe(false);
    expect(saysBeyond("We have paying customers", ["Paying customers"])).toBe(
      false,
    );
    expect(saysBeyond(LOCKERS, ["Paying customers"])).toBe(true);
  });
});

describe("2b. Q never says the record holds what it does not", () => {
  const row = (stepKey: string, value: string | null) => ({
    stepKey,
    question: stepKey,
    kind: "ONE_OF" as const,
    required: true,
    status: value === null ? ("OPEN" as const) : ("ANSWERED" as const),
    value,
  });
  const state = {
    steps: [
      row("F1.stage", "Seed"),
      row("F5.signal", "Paying customers"),
      row("F5.customers", "3"),
      row("F4.team_size", "6"),
      row("F4.founder_count", "2"),
    ],
  };

  it('the live line after "Skip the rest.": the unsaved claim is taken out', () => {
    const reply =
      "Understood — we'll leave the remaining profile details for now. Your profile reflects Kivisild Locker Network's seed-stage raise, three paying customers, 40 lockers across 12 towns, and a six-person team with two full-time founders.";
    expect(withoutUnsavedRecordClaims(reply, state, "Skip the rest.")).toBe(
      "Understood — we'll leave the remaining profile details for now.",
    );
  });

  it("a claim the record holds, and their latest words acknowledged, are kept", () => {
    const backed =
      "Your profile now has three paying customers and a team of six.";
    expect(withoutUnsavedRecordClaims(backed, state, "ok")).toBe(backed);
    const latest =
      "Noted: 40 lockers in 12 towns. What does the founding team cover?";
    expect(
      withoutUnsavedRecordClaims(
        latest,
        state,
        "We have 40 lockers in 12 towns",
      ),
    ).toBe(latest);
  });

  it("reads figures in digits, with a scale, and in words", () => {
    expect(
      [...figuresOf("€1.5 million, 300k and twelve towns")].sort(
        (a, b) => a - b,
      ),
    ).toEqual([12, 300000, 1500000]);
  });
});
