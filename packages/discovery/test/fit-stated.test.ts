import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  FitProfileDtoSchema,
  type CompanyDeckView,
  type CompanyRaiseView,
  type DeckSection,
} from "@capital-q/contracts";

import { FIT_CONFIG_V4 } from "../src/fit/config.js";
import { assessFit } from "../src/fit/model.js";
import { observeFit, type DeclaredFitFacts } from "../src/fit/observe.js";
import { statedEvidenceFrom } from "../src/fit/stated.js";
import { renderFitReason } from "../src/fit/templates.js";
import { fitProfileText } from "../src/fit/service.js";

/**
 * What a company STATED where the reader may see it, beside the fit (lead
 * review 2026-10-12, Tensorgate: "Cheque size: Unknown, Round: Unknown"
 * beside a pitch and a confirmed deck saying "$4m on a post-money SAFE,
 * $30m cap"). The statement is named as stated; outcomes, band and
 * confidence never move, so the fit's scoring is unchanged.
 */

const COMPANY = "bf55d6e1-567a-470b-954d-054ae05990e2";
const NOW = new Date("2026-10-12T04:00:00.000Z");

const fact = (label: string, value: string | null) => ({
  label,
  value,
  unknownReason: value === null ? ("NOT_IN_DECK" as const) : null,
  kind: "TEXT" as const,
  asOf: null,
  pages: [],
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  confidence: "HIGH" as const,
});

function deck(
  ask: ReturnType<typeof fact>[] | null,
  options: { readonly downloadable?: boolean; readonly shown?: boolean } = {},
): CompanyDeckView {
  const sections: DeckSection[] = DECK_SECTIONS.map((section) =>
    section === "THE_ASK" && ask !== null
      ? {
          section,
          status: "PRESENT",
          summary: "The ask.",
          pages: [12],
          facts: ask,
          confidence: "HIGH",
        }
      : section === "TRACTION"
        ? {
            section,
            status: "PRESENT",
            summary: "Traction.",
            pages: [7],
            facts: [fact("Contracted ARR", "$360k"), fact("Retention", null)],
            confidence: "HIGH",
          }
        : {
            section,
            status: "NOT_IN_DECK",
            summary: null,
            pages: [],
            facts: [],
            confidence: "LOW",
          },
  );
  return {
    viewer: "INVESTOR",
    companyId: COMPANY,
    deck: {
      documentId: "c975d2d2-21ee-4fd8-a6eb-e64bdd660fd0",
      title: "Seed deck",
      versionNumber: 1,
      pageCount: 13,
      uploadedAt: "2026-10-06T12:50:57.494Z",
      downloadable: options.downloadable ?? true,
      scanned: false,
    },
    // A private deck, or one with nothing confirmed, reaches an investor
    // with no reading at all.
    extraction:
      options.shown === false
        ? null
        : {
            extractionId: "11111111-1111-4111-8111-111111111111",
            readAt: "2026-10-06T13:00:00.000Z",
            versionNumber: 1,
            confirmed: true,
            sections,
          },
    coaching: null,
  };
}

const TENSORGATE_ASK = [
  fact("Amount sought", "$4m"),
  fact("Instrument", "Post-money SAFE"),
  fact("Valuation cap", "$30m"),
  fact("Minimum cheque", "$100k"),
  fact("Engineering allocation", "45% — GPU enclave support and SDKs"),
  fact("Committed investors", null),
];

const pitch = (amount: string, currency = "USD"): CompanyRaiseView => ({
  source: "PITCH_CLAIM",
  money: { amount, currency },
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  visibility: "network_visible",
  asOf: null,
  pitch: {
    pitchId: "278ec231-a070-4540-b599-396b0d6e68b3",
    atSeconds: 43,
  },
});

const disclosed: CompanyRaiseView = {
  source: "DISCLOSED_OBJECTIVE",
  money: { amount: "4000000", currency: "USD" },
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  visibility: "network_visible",
  asOf: "2026-10-01T00:00:00.000Z",
  pitch: null,
};

const MANDATE: DeclaredFitFacts = {
  cheque: { currency: "USD", typical: "250000" },
  leadPolicy: "SOMETIMES",
  mandateStages: "seed",
  companyStage: "seed",
};

function fitWith(declared: DeclaredFitFacts) {
  const observed = observeFit({
    companyId: COMPANY,
    snapshot: null,
    declared,
    eligibilityReasons: [],
    config: FIT_CONFIG_V4,
    now: NOW,
  });
  const profile = assessFit(observed, FIT_CONFIG_V4, NOW.toISOString()).profile;
  const row = (parameter: "CHEQUE_SIZE" | "ROUND_TERMS") => {
    const found = profile.parameters.find((p) => p.parameter === parameter);
    if (found === undefined) throw new Error(parameter);
    return found;
  };
  return { profile, cheque: row("CHEQUE_SIZE"), terms: row("ROUND_TERMS") };
}

describe("what a company stated, beside the fit (Tensorgate, 2026-10-12)", () => {
  it("Tensorgate: the pitch and the confirmed deck name the raise and the SAFE, never scored", () => {
    const said = statedEvidenceFrom({
      raise: pitch("4000000"),
      deck: deck(TENSORGATE_ASK),
    });
    expect(said.statedRound).toMatchObject({
      raise: "$4M, said in their pitch and deck",
      minimumCheque: "$100k",
      terms: "Post-money SAFE, $30m cap in their deck",
    });
    const withStated = fitWith({ ...MANDATE, statedRound: said.statedRound });
    const without = fitWith(MANDATE);
    expect(withStated.cheque.reason).toBe(
      "Raising $4M, said in their pitch and deck, minimum cheque $100k; not shared as a round size, so not scored.",
    );
    expect(withStated.terms.reason).toBe(
      "Post-money SAFE, $30m cap in their deck; whether they need a lead is not stated.",
    );
    // The row shows the values themselves, each with its source, and
    // says separately what is not concluded (2026-10-12).
    expect(withStated.cheque.context).toEqual({
      items: [
        { label: "Raise", value: "$4M", source: "PITCH_AND_DECK" },
        { label: "Your cheque", value: "$250k", source: "YOUR_MANDATE" },
        { label: "Minimum cheque", value: "$100k", source: "DECK" },
      ],
      open: "Ticket fit: not scored until the round is shared",
    });
    expect(withStated.terms.context).toEqual({
      items: [
        { label: "Instrument", value: "Post-money SAFE", source: "DECK" },
        { label: "Valuation cap", value: "$30m", source: "DECK" },
      ],
      open: "Lead investor required: not stated",
    });
    expect(without.cheque.context).toEqual({
      items: [{ label: "Your cheque", value: "$250k", source: "YOUR_MANDATE" }],
      open: "Round amount: not shared with you",
    });
    expect(withStated.cheque.stated).toBe(true);
    expect(withStated.terms.stated).toBe(true);
    expect(without.cheque.stated).toBeUndefined();
    // Scoring is unchanged: the same outcomes, band and confidence.
    expect(withStated.cheque.outcome).toBe("UNKNOWN");
    expect(withStated.terms.outcome).toBe("UNKNOWN");
    expect(withStated.profile.band).toBe(without.profile.band);
    expect(withStated.profile.confidence).toBe(without.profile.confidence);
    expect(
      withStated.profile.parameters.map((p) => [p.outcome, p.applicable]),
    ).toEqual(without.profile.parameters.map((p) => [p.outcome, p.applicable]));
    FitProfileDtoSchema.parse(withStated.profile);
  });

  it("gives Q the deck's facts, and its gaps as gaps", () => {
    const said = statedEvidenceFrom({
      raise: pitch("4000000"),
      deck: deck(TENSORGATE_ASK),
    });
    expect(said.evidence).toContainEqual({
      source: "DECK",
      label: "The ask · Valuation cap",
      value: "$30m",
    });
    expect(said.evidence).toContainEqual({
      source: "DECK",
      label: "The ask · Committed investors",
      value: null,
    });
    expect(said.evidence).toContainEqual({
      source: "PITCH",
      label: "Pitch · Raise",
      value: "$4M",
    });
    expect(said.confidential).toBe(false);
  });

  it("a raise formally shared is the raise: it is scored, and nothing is called 'stated'", () => {
    const said = statedEvidenceFrom({
      raise: disclosed,
      deck: deck(TENSORGATE_ASK),
    });
    const { cheque } = fitWith({
      ...MANDATE,
      round: {
        amount: "4000000",
        currency: "USD",
        evidenceStatus: "SELF_REPORTED",
      },
      statedRound: said.statedRound,
    });
    expect(cheque.outcome).toBe("STRONG");
    expect(cheque.reason).toBe("$4M round; your $250k fits.");
    expect(cheque.stated).toBeUndefined();
  });

  it("a pitch-only raise, no deck: named as said in their pitch", () => {
    const said = statedEvidenceFrom({ raise: pitch("2500000"), deck: null });
    expect(said.statedRound).toMatchObject({
      raise: "$2.5M, said in their pitch",
    });
    expect(
      fitWith({ ...MANDATE, statedRound: said.statedRound }).cheque.reason,
    ).toBe(
      "Raising $2.5M, said in their pitch; not shared as a round size, so not scored.",
    );
  });

  it("no investor cheque preference: still not scored, and the stated raise is named", () => {
    const said = statedEvidenceFrom({
      raise: pitch("4000000"),
      deck: deck(TENSORGATE_ASK),
    });
    const { cheque } = fitWith({
      ...MANDATE,
      cheque: null,
      statedRound: said.statedRound,
    });
    expect(cheque.applicable).toBe(false);
    expect(cheque.reason).toBe(
      "Raising $4M, said in their pitch and deck, minimum cheque $100k; you have not set a cheque size.",
    );
  });

  it("a shared round in another currency says so, instead of 'not shared'", () => {
    const { cheque } = fitWith({
      ...MANDATE,
      round: {
        amount: "2000000",
        currency: "EUR",
        evidenceStatus: "SELF_REPORTED",
      },
    });
    expect(cheque.outcome).toBe("UNKNOWN");
    // The exact reason, as words and as a code Q states (owner 23 Oct).
    expect(cheque.reason).toBe(
      "Raising €2M; your cheque is in USD and no exchange rate is stored, so not compared.",
    );
    expect(cheque.unknownReason).toBe("CURRENCY_DIFFERS_NO_RATE");
  });

  it("no pitch: the confirmed deck alone", () => {
    const said = statedEvidenceFrom({
      raise: null,
      deck: deck(TENSORGATE_ASK),
    });
    expect(said.statedRound?.raise).toBe("$4m, in their deck");
  });

  it("a pitch and a deck that differ are both named (contradictions coexist)", () => {
    const said = statedEvidenceFrom({
      raise: pitch("5000000"),
      deck: deck(TENSORGATE_ASK),
    });
    expect(said.statedRound?.raise).toBe(
      "$5M in their pitch and $4m in their deck",
    );
  });

  it("a private deck, or nothing confirmed: no deck statement and no deck evidence", () => {
    const said = statedEvidenceFrom({
      raise: null,
      deck: deck(TENSORGATE_ASK, { shown: false }),
    });
    expect(said.statedRound).toBeNull();
    expect(said.evidence).toEqual([]);
    const { cheque, terms } = fitWith({ ...MANDATE, statedRound: null });
    expect(cheque.reason).toBe(
      "The company has not shared its round size with you.",
    );
    expect(cheque.unknownReason).toBe("ROUND_NOT_SHARED");
    expect(terms.reason).toBe("Round terms not shared.");
  });

  it("a deck reached through a grant is confidential for a model", () => {
    expect(
      statedEvidenceFrom({
        raise: null,
        deck: deck(TENSORGATE_ASK, { downloadable: false }),
      }).confidential,
    ).toBe(true);
  });

  it("lead requirement: the instrument never answers it, whatever the investor's lead policy", () => {
    const statedRound = statedEvidenceFrom({
      raise: null,
      deck: deck(TENSORGATE_ASK),
    }).statedRound;
    for (const leadPolicy of ["ALWAYS", "SOMETIMES", "NEVER"] as const) {
      const { terms } = fitWith({ ...MANDATE, leadPolicy, statedRound });
      expect(terms.outcome, leadPolicy).toBe("UNKNOWN");
      expect(terms.applicable, leadPolicy).toBe(true);
    }
    const none = fitWith({ ...MANDATE, leadPolicy: null, statedRound }).terms;
    expect(none.applicable).toBe(false);
    expect(none.reason).toBe(
      "Post-money SAFE, $30m cap in their deck; you have not said whether you lead.",
    );
    // A stated need for a lead is still scored exactly as before.
    expect(
      fitWith({
        ...MANDATE,
        leadPolicy: "NEVER",
        roundTerms: {
          needsLead: true,
          summary: "SAFE, lead wanted",
          evidenceStatus: "SELF_REPORTED",
        },
      }).terms.outcome,
    ).toBe("MISMATCH");
  });

  it("every sentence an input without stated facts produced before is unchanged", () => {
    // fit-reasons.v2: the cheque unknown says plainly what is missing.
    expect(renderFitReason("CHEQUE_SIZE", "UNKNOWN", {})).toBe(
      "The company has not shared its round size with you.",
    );
    expect(renderFitReason("ROUND_TERMS", "UNKNOWN", {})).toBe(
      "Round terms not shared.",
    );
    expect(renderFitReason("CHEQUE_SIZE", "NO_PREFERENCE", {})).toBe(
      "You have not set a cheque size.",
    );
    expect(renderFitReason("ROUND_TERMS", "NO_PREFERENCE", {})).toBe(
      "You have not said whether you lead.",
    );
  });
});

/**
 * Owner 23 Oct 2026 (Zino Aviation on Halyard Security): "you know how much
 * I am offering. So what do you mean by you don't know the cheque
 * compatibility". A raise said in a pitch the investor may play counts,
 * recorded as from the pitch; a round in another currency is compared as
 * an ESTIMATE at the stored ECB rate; an unknown says its exact reason.
 */
describe("cheque fit from the pitch, across currencies (fit-reasons.v2)", () => {
  // ECB reference rates for 23 Oct 2026 (units per euro), as stored.
  const fx = {
    source: "ECB_EUROFXREF" as const,
    rateDate: "2026-10-23",
    perEuro: new Map([
      ["GBP", "0.86"],
      ["USD", "1.08"],
    ]),
  };
  const zino: DeclaredFitFacts = {
    cheque: { currency: "EUR", typical: "3000000" },
  };

  it("a raise said in their pitch is scored, and says it is from the pitch", () => {
    const said = statedEvidenceFrom({ raise: pitch("4000000"), deck: null });
    expect(said.pitchMoney).toEqual({ amount: "4000000", currency: "USD" });
    const { cheque } = fitWith({
      ...MANDATE,
      round: {
        amount: "4000000",
        currency: "USD",
        evidenceStatus: "SELF_REPORTED",
        source: "PITCH",
      },
    });
    expect(cheque.outcome).toBe("STRONG");
    expect(cheque.reason).toBe(
      "$4M (from their pitch) round; your $250k fits.",
    );
    expect(cheque.context?.items[0]).toEqual({
      label: "Round",
      value: "$4M",
      source: "PITCH",
    });
    expect(cheque.estimate).toBeUndefined();
  });

  it("Halyard: a £3M round against a €3M cheque is compared approximately, at the ECB rate of the day, as an estimate", () => {
    const { cheque } = fitWith({
      ...zino,
      fx,
      round: {
        amount: "3000000",
        currency: "GBP",
        evidenceStatus: "SELF_REPORTED",
        source: "PITCH",
      },
    });
    // £3M / 0.86 per EUR ≈ €3.49M; a €3M cheque is 86% of the round.
    expect(cheque.outcome).toBe("STRONG");
    expect(cheque.reason).toBe(
      "£3M (from their pitch) round, about €3.5M at the ECB rate of 23 Oct 2026; your €3M fits.",
    );
    expect(cheque.estimate).toEqual({
      method: "ECB_REFERENCE_RATE",
      rateDate: "2026-10-23",
      truthClass: "ESTIMATE",
    });
    expect(cheque.context?.open).toBe(
      "Approximately, at the ECB rate of 23 Oct 2026",
    );
    expect(cheque.unknownReason).toBeUndefined();
  });

  it("an estimate can also say the cheque is too large for the round", () => {
    const { cheque } = fitWith({
      cheque: { currency: "EUR", typical: "3000000" },
      fx,
      round: {
        amount: "1000000",
        currency: "GBP",
        evidenceStatus: "SELF_REPORTED",
      },
    });
    // £1M ≈ €1.16M: a €3M cheque is more than the whole round.
    expect(cheque.outcome).not.toBe("UNKNOWN");
    expect(cheque.outcome).not.toBe("STRONG");
    expect(cheque.estimate?.truthClass).toBe("ESTIMATE");
  });

  it("without a stored rate the currencies are named, never guessed", () => {
    const { cheque } = fitWith({
      ...zino,
      round: {
        amount: "3000000",
        currency: "GBP",
        evidenceStatus: "SELF_REPORTED",
        source: "PITCH",
      },
    });
    expect(cheque.outcome).toBe("UNKNOWN");
    expect(cheque.unknownReason).toBe("CURRENCY_DIFFERS_NO_RATE");
    expect(cheque.reason).toBe(
      "Raising £3M; your cheque is in EUR and no exchange rate is stored, so not compared.",
    );
    expect(cheque.context?.open).toBe(
      "Ticket fit: not compared, the round is in GBP and your cheque in EUR",
    );
  });

  it("the same currency is compared exactly, never as an estimate", () => {
    const { cheque } = fitWith({
      ...zino,
      fx,
      round: {
        amount: "5000000",
        currency: "EUR",
        evidenceStatus: "SELF_REPORTED",
      },
    });
    expect(cheque.outcome).toBe("STRONG");
    expect(cheque.estimate).toBeUndefined();
  });
});

describe("what Q reads about cheque fit (owner 23 Oct 2026)", () => {
  it("an unknown carries its exact reason as a code, and an estimate says it is one", () => {
    const unknown = fitWith({
      cheque: { currency: "EUR", typical: "3000000" },
      round: {
        amount: "3000000",
        currency: "GBP",
        evidenceStatus: "SELF_REPORTED",
      },
    });
    const text = fitProfileText("Halyard Security", unknown.profile);
    expect(text).toContain(
      "[why unknown: CURRENCY_DIFFERS_NO_RATE, the round and your cheque are in different currencies and no exchange rate is stored; the only reason]",
    );
    const estimated = fitWith({
      cheque: { currency: "EUR", typical: "3000000" },
      fx: {
        source: "ECB_EUROFXREF",
        rateDate: "2026-10-23",
        perEuro: new Map([["GBP", "0.86"]]),
      },
      round: {
        amount: "3000000",
        currency: "GBP",
        evidenceStatus: "SELF_REPORTED",
      },
    });
    expect(fitProfileText("Halyard Security", estimated.profile)).toContain(
      "[ESTIMATE: approximately, at the ECB reference rate of 2026-10-23; not exact, not verified]",
    );
  });
});
