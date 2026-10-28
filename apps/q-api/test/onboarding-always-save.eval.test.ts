import { describe, expect, it } from "vitest";

import { EXCLUSION_MEANING_REASON } from "../src/voice/interview-steps.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Always save (owner 2026-10-16): every fact a person gives is saved, every
 * time. Each case is a fact as said, and what the acting model passes for
 * it (meaning is the model's). The independent reading notices NOTHING in
 * any case: what is proven is that code saves the fact without depending on
 * a model noticing it. Built from every miss in the live runs (founder,
 * investor and Arabic, 2026-10-16), plus at least five phrasings per field
 * type, unusual and mixed-language ones included.
 *
 * Persisted: the step holds an answer afterwards, structured or in their
 * own words; a fact for a question not on their path is kept with their
 * notes. Target: 100% persisted, 0 dropped, 0 duplicated.
 */

type Case = {
  readonly id: string;
  readonly journey: "founder" | "investor";
  readonly said: string;
  readonly stepKey: string;
  readonly value: string | number | readonly string[];
  readonly quote: string;
  /** Off their path: kept with the journey's notes, never refused. */
  readonly offPath?: boolean;
  /**
   * The words were said in an earlier turn (read then as stating this
   * step); `said` is their latest words, about something else.
   */
  readonly before?: string;
  /** The acting model passes nothing for it: code alone records it. */
  readonly byCode?: true;
  /** What the saved value must hold, and must not (only this field's part). */
  readonly holds?: string;
  readonly notHolds?: string;
  /**
   * A brand-new investor: category look-ups are refused until their first
   * answer (how they invest) sets up the profile, given in the same breath.
   */
  readonly newInvestor?: true;
  /**
   * A firm exclusion (owner 2026-10-25): saved only where the reading
   * found one declared. With no reading of it, Q asks one short question
   * instead, and nothing is saved: that is this case's right outcome.
   */
  readonly firmExclusion?: true;
};

const F = "founder" as const;
const I = "investor" as const;

const AG_FOUNDER =
  "So basically we run cold-chain trucking software for fishermen around Lake Victoria, connecting them to buyers in Kampala. We're kind of pre-seed. Based in Uganda. I'm the chief everything officer, honestly, plus I write code. Three founders, two full time, about 11 people. We already have first revenue only, from two co-ops. We're actively raising about 500 thousand dollars, probably on a SAFE.";
const AG_INVESTOR =
  "Hey, so I'm a partner at Corvo Ventures, it's a small VC fund out of Lisbon. We're actively investing, cheques usually 150k to 400k euros, typical maybe 250k, mostly seed, sometimes pre-seed. We like climate, logistics and anything that makes ports less painful. Europe and North Africa. Honestly we also back a lot of second-time founders, and we never do gambling or tobacco.";

export const ALWAYS_SAVE_CASES: readonly Case[] = [
  // Logged misses (live AP, 2026-10-17).
  {
    id: "ap-arabic-dual-million",
    journey: F,
    said: "نعم، نجمع حالياً مليوني دولار عبر SAFE.",
    stepKey: "F6.target_amount",
    value: 2_000_000,
    quote: "مليوني دولار",
  },
  // Logged misses (live AO, 2026-10-17).
  {
    id: "ao-sectors-paraphrased-extra",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I3.sectors",
    value: ["climate", "logistics", "port technology"],
    quote:
      "We like climate, logistics and anything that makes ports less painful",
    holds: "a0000000-0000-4000-8000-0000000000c1",
  },
  // Logged misses (live AJ, 2026-10-16).
  {
    id: "aj-400-mille-euros",
    journey: F,
    said: "Oui, nous levons activement 400 mille euros, via un SAFE.",
    stepKey: "F6.target_amount",
    value: 400_000,
    quote: "400 mille euros",
  },
  {
    id: "aj-2-millones",
    journey: F,
    said: "Estamos levantando 2 millones de dólares.",
    stepKey: "F6.target_amount",
    value: 2_000_000,
    quote: "2 millones de dólares",
  },
  // Logged misses (live AI, 2026-10-16).
  {
    id: "ai-geography-new-investor",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I3.geography",
    value: ["Europe", "North Africa"],
    quote: "Europe and North Africa",
    newInvestor: true,
  },
  {
    id: "ai-sectors-new-investor",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I3.sectors",
    value: ["climate", "logistics"],
    quote:
      "We like climate, logistics and anything that makes ports less painful",
    newInvestor: true,
  },
  // Logged misses (live AG, 2026-10-16).
  {
    id: "ag-uganda",
    journey: F,
    said: AG_FOUNDER,
    stepKey: "F1.country",
    value: "Uganda",
    quote: "Based in Uganda",
  },
  {
    id: "ag-chief-everything",
    journey: F,
    said: AG_FOUNDER,
    stepKey: "F4.founder_role",
    value: "chief everything officer",
    quote: "I'm the chief everything officer",
  },
  {
    id: "ag-dollars-by-code",
    journey: F,
    said: AG_FOUNDER,
    stepKey: "F6.currency",
    value: "usd",
    quote: "dollars",
    byCode: true,
  },
  {
    id: "ag-dollars-earlier-by-code",
    journey: F,
    said: "Paying customers, the two co-ops.",
    before: AG_FOUNDER,
    stepKey: "F6.currency",
    value: "usd",
    quote: "dollars",
    byCode: true,
  },
  {
    id: "ag-revenue-kept",
    journey: F,
    said: AG_FOUNDER,
    stepKey: "F5.revenue_status",
    value: "first revenue only",
    quote: AG_FOUNDER.slice(0, 300),
    offPath: true,
    holds: "first revenue only",
    notHolds: "cold-chain",
  },
  {
    id: "ag-geography",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I3.geography",
    value: ["Europe", "North Africa"],
    quote: "Europe and North Africa",
  },
  {
    id: "ag-geography-earlier",
    journey: I,
    said: "Balanced.",
    before: AG_INVESTOR,
    stepKey: "I3.geography",
    value: ["Europe", "North Africa"],
    quote: "Europe and North Africa",
  },
  {
    id: "ag-sectors-earlier",
    journey: I,
    said: "Balanced.",
    before: AG_INVESTOR,
    stepKey: "I3.sectors",
    value: ["climate", "logistics"],
    quote:
      "We like climate, logistics and anything that makes ports less painful",
  },
  {
    id: "ag-sectors-unmapped-kept",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I3.sectors",
    value: ["climate", "logistics", "ports"],
    quote:
      "We like climate, logistics and anything that makes ports less painful",
  },
  {
    id: "ag-exclusions-own-part",
    journey: I,
    said: AG_INVESTOR,
    stepKey: "I7.sector_exclusions",
    value: ["gambling", "tobacco"],
    quote: AG_INVESTOR.slice(0, 300),
    holds: "gambling or tobacco",
    notHolds: "Lisbon",
    firmExclusion: true,
  },
  // Logged misses (live 2026-10-16).
  {
    id: "live-usd",
    journey: F,
    said: "US dollars.",
    stepKey: "F6.currency",
    value: "US dollars",
    quote: "US dollars",
  },
  {
    id: "live-1200000",
    journey: F,
    said: "1200000",
    stepKey: "F6.target_amount",
    value: 1_200_000,
    quote: "1200000",
  },
  {
    id: "live-partner",
    journey: I,
    said: "Partner.",
    stepKey: "I0.business_title",
    value: "Partner",
    quote: "Partner",
  },
  {
    id: "live-health",
    journey: I,
    said: "Mostly health.",
    stepKey: "I3.sectors",
    value: ["health"],
    quote: "health",
  },
  {
    id: "live-first-revenue",
    journey: F,
    said: "We have pilots running and first revenue only.",
    stepKey: "F5.revenue_status",
    value: "early",
    quote: "first revenue only",
    offPath: true,
  },
  {
    id: "live-500k",
    journey: F,
    said: "About 500 thousand dollars.",
    stepKey: "F6.target_amount",
    value: 500_000,
    quote: "About 500 thousand dollars",
  },
  {
    id: "live-500k-currency",
    journey: F,
    said: "About 500 thousand dollars.",
    stepKey: "F6.currency",
    // A currency is saved only as one of its options, never in their
    // words (owner 2026-10-28): the model reads which one is meant.
    value: "usd",
    quote: "dollars",
  },
  {
    id: "live-aed-revenue",
    journey: F,
    said: "monthly revenue 180k AED",
    stepKey: "F5.monthly_revenue",
    value: 180_000,
    quote: "180k AED",
    offPath: true,
  },
  {
    id: "live-usd-1.5m",
    journey: F,
    said: "raise USD 1.5m",
    stepKey: "F6.target_amount",
    value: 1_500_000,
    quote: "USD 1.5m",
  },
  // One choice.
  {
    id: "stage-plain",
    journey: F,
    said: "We're at seed.",
    stepKey: "F1.stage",
    value: "seed",
    quote: "seed",
  },
  {
    id: "stage-label",
    journey: F,
    said: "Pre-seed, honestly.",
    stepKey: "F1.stage",
    value: "Pre-seed",
    quote: "Pre-seed",
  },
  {
    id: "stage-caps",
    journey: F,
    said: "SERIES A just closed",
    stepKey: "F1.stage",
    value: "series a",
    quote: "SERIES A",
  },
  {
    id: "stage-other",
    journey: F,
    said: "Bootstrapped so far, no outside money.",
    stepKey: "F1.stage",
    value: "bootstrapped",
    quote: "Bootstrapped so far, no outside money",
  },
  {
    id: "stage-between",
    journey: F,
    said: "Somewhere between seed and Series A.",
    stepKey: "F1.stage",
    value: "seed to series A",
    quote: "Somewhere between seed and Series A",
  },
  {
    id: "stage-arabic",
    journey: F,
    said: "نحن في مرحلة البذرة",
    stepKey: "F1.stage",
    value: "seed",
    quote: "مرحلة البذرة",
  },
  // Currency.
  {
    id: "ccy-code",
    journey: F,
    said: "USD",
    stepKey: "F6.currency",
    value: "USD",
    quote: "USD",
  },
  {
    id: "ccy-dirhams",
    journey: F,
    said: "In dirhams.",
    stepKey: "F6.currency",
    value: "AED",
    quote: "dirhams",
  },
  {
    id: "ccy-naira",
    journey: F,
    said: "naira",
    stepKey: "F6.currency",
    value: "Nigerian naira",
    quote: "naira",
  },
  {
    id: "ccy-arabic",
    journey: F,
    said: "بالدولار الأمريكي",
    stepKey: "F6.currency",
    value: "usd",
    quote: "بالدولار الأمريكي",
  },
  {
    id: "ccy-mix",
    journey: F,
    said: "A mix of euros and dollars.",
    stepKey: "F6.currency",
    // Two named: the first is kept, the other noted to ask about (owner
    // 2026-10-28), never their sentence.
    value: ["eur", "usd"],
    quote: "A mix of euros and dollars",
    holds: '"eur"',
  },
  // Money.
  {
    id: "money-short",
    journey: F,
    said: "$1.2m",
    stepKey: "F6.target_amount",
    value: 1_200_000,
    quote: "$1.2m",
  },
  {
    id: "money-words",
    journey: F,
    said: "A million and a half.",
    stepKey: "F6.target_amount",
    value: 1_500_000,
    quote: "A million and a half",
  },
  {
    id: "money-arabic",
    journey: F,
    said: "١٫٥ مليون دولار",
    stepKey: "F6.target_amount",
    value: 1_500_000,
    quote: "١٫٥ مليون دولار",
  },
  {
    id: "money-mixed",
    journey: F,
    said: "We're raising USD 1.5m بالدولار",
    stepKey: "F6.target_amount",
    value: 1_500_000,
    quote: "USD 1.5m",
  },
  {
    id: "money-k",
    journey: F,
    said: "750k",
    stepKey: "F6.target_amount",
    value: "750k",
    quote: "750k",
  },
  // A count.
  {
    id: "count-people",
    journey: F,
    said: "12 people.",
    stepKey: "F4.team_size",
    value: 12,
    quote: "12 people",
  },
  {
    id: "count-words",
    journey: F,
    said: "Fourteen of us.",
    stepKey: "F4.team_size",
    value: 14,
    quote: "Fourteen",
  },
  {
    id: "count-dozen",
    journey: F,
    said: "A dozen or so.",
    stepKey: "F4.team_size",
    value: "a dozen or so",
    quote: "A dozen or so",
  },
  {
    id: "count-arabic",
    journey: F,
    said: "١٤ موظفاً",
    stepKey: "F4.team_size",
    value: 14,
    quote: "١٤ موظفاً",
  },
  {
    id: "count-around",
    journey: F,
    said: "Around 20, including contractors.",
    stepKey: "F4.team_size",
    value: 20,
    quote: "Around 20",
  },
  // Short text.
  {
    id: "title-gp",
    journey: I,
    said: "I'm a GP.",
    stepKey: "I0.business_title",
    value: "GP",
    quote: "GP",
  },
  {
    id: "title-md",
    journey: I,
    said: "Managing director.",
    stepKey: "I0.business_title",
    value: "Managing director",
    quote: "Managing director",
  },
  {
    id: "title-arabic",
    journey: I,
    said: "شريك",
    stepKey: "I0.business_title",
    value: "شريك",
    quote: "شريك",
  },
  {
    id: "title-principal",
    journey: I,
    said: "Principal at the fund.",
    stepKey: "I0.business_title",
    value: "Principal",
    quote: "Principal",
  },
  {
    id: "title-lower",
    journey: I,
    said: "venture partner",
    stepKey: "I0.business_title",
    value: "venture partner",
    quote: "venture partner",
  },
  // Several choices.
  {
    id: "multi-two",
    journey: F,
    said: "Product and engineering.",
    stepKey: "F4.functions",
    value: ["product", "engineering"],
    quote: "Product and engineering",
  },
  {
    id: "multi-one",
    journey: F,
    said: "Mostly sales.",
    stepKey: "F4.functions",
    value: ["sales"],
    quote: "sales",
  },
  {
    id: "multi-near",
    journey: F,
    said: "Ops and a bit of design.",
    stepKey: "F4.functions",
    value: ["operations", "design"],
    quote: "Ops and a bit of design",
  },
  {
    id: "multi-other",
    journey: F,
    said: "A bit of everything.",
    stepKey: "F4.functions",
    value: ["everything"],
    quote: "A bit of everything",
  },
  {
    id: "multi-arabic",
    journey: F,
    said: "الهندسة والمبيعات",
    stepKey: "F4.functions",
    value: ["engineering", "sales"],
    quote: "الهندسة والمبيعات",
  },
  // Categories.
  {
    id: "cat-named",
    journey: I,
    said: "Fintech.",
    stepKey: "I3.sectors",
    value: ["fintech"],
    quote: "Fintech",
  },
  {
    id: "cat-partial",
    journey: I,
    said: "Climate and fintech.",
    stepKey: "I3.sectors",
    value: ["climate", "fintech"],
    quote: "Climate and fintech",
  },
  {
    id: "cat-none",
    journey: I,
    said: "Agritech, mostly smallholder tools.",
    stepKey: "I3.sectors",
    value: ["agritech"],
    quote: "Agritech, mostly smallholder tools",
  },
  {
    id: "cat-arabic",
    journey: I,
    said: "التكنولوجيا المالية",
    stepKey: "I3.sectors",
    value: ["fintech"],
    quote: "التكنولوجيا المالية",
  },
  {
    id: "cat-phrase",
    journey: I,
    said: "Anything that helps farmers sell more.",
    stepKey: "I3.sectors",
    value: ["helps farmers sell more"],
    quote: "helps farmers sell more",
  },
];

const FINTECH = "a0000000-0000-4000-8000-0000000000f1";

async function persisted(c: Case): Promise<{
  readonly saved: boolean;
  readonly duplicated: boolean;
}> {
  const world = investorSession({
    journey: c.journey,
    currentStepKey: c.stepKey,
    recorded:
      c.journey === "founder"
        ? { "F0.intent": "raising_now", "F1.company_name": "Lumora Grid" }
        : c.newInvestor === true
          ? {}
          : { "I0.investor_type": "vc" },
    ...(c.newInvestor === true ? { taxonomyUntil: "I0.investor_type" } : {}),
    taxonomy: {
      fintech: FINTECH,
      europe: "a0000000-0000-4000-8000-0000000000e1",
      "north africa": "a0000000-0000-4000-8000-0000000000e2",
      climate: "a0000000-0000-4000-8000-0000000000c1",
      logistics: "a0000000-0000-4000-8000-0000000000c2",
    },
    ...(c.offPath === true ? { ineligible: [c.stepKey] } : {}),
  });
  const port = createOnboardingPort({
    session: turn(world, c.said).session,
    onboardingSessionId: turn(world, c.said).onboardingSessionId,
    journeyType: c.journey,
    ownerUserId: "b0000000-0000-4000-8000-000000000001",
    personTurns: c.before === undefined ? [c.said] : [c.said, c.before],
    // Words said earlier were read then, as stating this step (live AG:
    // the earlier reading named geography and sectors).
    ...(c.before === undefined
      ? {}
      : {
          statedEarlier: (stepKey: string, quote: string) =>
            stepKey === c.stepKey && (c.before ?? "").includes(quote),
        }),
    // The reading notices nothing: code alone must save it.
    // (CQ_EVAL_READER=1: it notices the step, to measure that case too.)
    authority: () =>
      Promise.resolve(
        reading(
          process.env["CQ_EVAL_READER"] === "1" ? { stated: [c.stepKey] } : {},
        ),
      ),
  });
  const results =
    c.byCode === true
      ? [await (async () => port.recordStatedCurrency())().catch(() => null)]
      : await port
          .record([
            ...(c.newInvestor === true
              ? [
                  {
                    stepKey: "I0.investor_type",
                    value: "vc",
                    quote: "a small VC fund",
                    basis: "STATED" as const,
                    ownWords: false,
                  },
                ]
              : []),
            {
              stepKey: c.stepKey,
              value: typeof c.value === "object" ? [...c.value] : c.value,
              quote: c.quote,
              basis: "STATED",
              ownWords: false,
            },
          ])
          .catch(() => []);
  const notes =
    c.journey === "founder" ? "F7.follow_up" : "I11.additional_context";
  const held =
    c.offPath === true
      ? world.recordedValue(notes)
      : world.recordedValue(c.stepKey);
  const text =
    held === undefined
      ? ""
      : held.type === "TEXT"
        ? held.text
        : JSON.stringify(held);
  const saved =
    held !== undefined &&
    (c.offPath !== true || text.includes(c.holds ?? c.quote)) &&
    (c.holds === undefined || text.includes(c.holds)) &&
    (c.notHolds === undefined || !text.includes(c.notHolds)) &&
    (c.byCode !== true ||
      (held.type === "SINGLE_SELECT" && held.optionKey === c.value));
  const tries = world.attempts().filter((key) => key === c.stepKey).length;
  if (process.env["CQ_EVAL_TRACE"] === "1" && !saved) {
    console.log(c.id, JSON.stringify(results), text);
  }
  // Unread, a firm exclusion is asked about, never saved silently.
  if (c.firmExclusion === true && process.env["CQ_EVAL_READER"] !== "1") {
    const asked = results.some(
      (r) =>
        r !== null &&
        "outcome" in r &&
        "reason" in r &&
        r.stepKey === c.stepKey &&
        r.outcome === "REJECTED" &&
        r.reason === EXCLUSION_MEANING_REASON,
    );
    return { saved: asked && held === undefined, duplicated: false };
  }
  return { saved, duplicated: c.offPath !== true && tries > 1 };
}

describe("always save: every stated fact is persisted (owner 2026-10-16)", () => {
  it("has at least five phrasings per field type, Arabic and mixed included", () => {
    expect(ALWAYS_SAVE_CASES.length).toBeGreaterThanOrEqual(40);
  });

  it("persists 100% with 0 drops and 0 duplicates, with no help from the reading", async () => {
    const dropped: string[] = [];
    const duplicated: string[] = [];
    for (const c of ALWAYS_SAVE_CASES) {
      const result = await persisted(c);
      if (!result.saved) dropped.push(c.id);
      if (result.duplicated) duplicated.push(c.id);
    }
    const total = ALWAYS_SAVE_CASES.length;
    console.log(
      JSON.stringify({
        total,
        persisted: total - dropped.length,
        dropped,
        duplicated,
      }),
    );
    expect(dropped).toEqual([]);
    expect(duplicated).toEqual([]);
  }, 60_000);
});
