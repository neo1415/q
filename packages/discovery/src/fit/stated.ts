import {
  DECK_SECTION_LABELS,
  deckAskTerms,
  type CompanyDeckView,
  type CompanyRaiseView,
  type FitContextItem,
} from "@capital-q/contracts";

import type { DeclaredFitFacts } from "./observe.js";
import { formatMoney } from "./observe.js";

/**
 * What a company has STATED about itself where this reader may see it,
 * beside the fit (lead review 2026-10-12, Tensorgate): the raise said in a
 * pitch they may play, and the deck sections the founder confirmed for
 * investors. Before this, the fit read only a formally shared raise, so a
 * $4M post-money SAFE with a $30M cap, plain in the pitch and the deck,
 * showed as "Round size not shared" and Q asked the investor to find it.
 *
 * Two uses, both outside scoring:
 *   statedRound  named in the cheque and round-terms sentences as stated,
 *                never moving an outcome, the band or the confidence;
 *   evidence     the lines Q's view may read, so it asks only what is
 *                genuinely open ("not in the deck" lines say what is).
 *
 * Inputs are already the reader's: the raise view from the one raise
 * reader (disclosure, playback rule, a founder's hidden raise respected)
 * and the deck view from the deck service (investors see confirmed or
 * corrected sections only). Deterministic; no model reads anything here.
 */

export type FitEvidenceLine = {
  readonly source: "PITCH" | "DECK";
  /** "The ask · Instrument". */
  readonly label: string;
  /** The company's own words or figure; null: the deck does not say. */
  readonly value: string | null;
};

/** Each evidence line is bounded for the prompt. */
const EVIDENCE_VALUE_MAX = 200;

export type FitStatedEvidence = {
  readonly statedRound: NonNullable<DeclaredFitFacts["statedRound"]> | null;
  /**
   * The raise said in a pitch this reader may play, as money (owner 23 Oct
   * 2026: investor-visible material counts toward cheque fit). Null when
   * no pitch they may play states an amount.
   */
  readonly pitchMoney?:
    { readonly amount: string; readonly currency: string } | null | undefined;
  readonly evidence: readonly FitEvidenceLine[];
  /**
   * The deck facts reached this reader other than as a deck offered to all
   * investors (a relationship grant): a model may read them only at
   * CONFIDENTIAL. Conservative: a deck not downloadable by investors counts.
   */
  readonly confidential: boolean;
  /**
   * The raise as this reader sees it, read once for the fit (coordinator
   * 2026-10-26: the fit tool read it a second time for its cards). Never
   * scored: what the cards and Q say, exactly as raiseFor gives it.
   */
  readonly raiseView?: CompanyRaiseView | undefined;
};

export const FIT_EVIDENCE_LINES_MAX = 60;

/** "$4M" and "$4m" are the same statement; "$4M" and "$5m" are not. */
function sameFigure(a: string, b: string): boolean {
  const bare = (s: string) => s.toLowerCase().replace(/[\s,]/gu, "");
  return bare(a) === bare(b);
}

export function statedEvidenceFrom(input: {
  readonly raise: CompanyRaiseView | null;
  readonly deck: CompanyDeckView | null;
}): FitStatedEvidence {
  const pitch =
    input.raise?.source === "PITCH_CLAIM" && input.raise.money !== null
      ? formatMoney(input.raise.money.amount, input.raise.money.currency)
      : null;
  const sections = (input.deck?.extraction?.sections ?? []).filter(
    (section) => section.status === "PRESENT",
  );
  const ask = deckAskTerms(sections);
  const deckAmount = ask.amount;
  const instrument = ask.instrument;
  const minimumCheque = ask.minimumCheque;

  // Contradictions coexist: a pitch and a deck that differ are both named.
  const raise =
    pitch !== null && deckAmount !== undefined
      ? sameFigure(pitch, deckAmount)
        ? `${pitch}, said in their pitch and deck`
        : `${pitch} in their pitch and ${deckAmount} in their deck`
      : pitch !== null
        ? `${pitch}, said in their pitch`
        : deckAmount !== undefined
          ? `${deckAmount}, in their deck`
          : undefined;
  const capWords =
    ask.valuationCap !== undefined
      ? `${ask.valuationCap} cap`
      : ask.valuation !== undefined
        ? `${ask.valuation} valuation`
        : undefined;
  const termsList = [instrument, capWords].filter(
    (part): part is string => part !== undefined,
  );
  const terms =
    termsList.length === 0
      ? undefined
      : `${termsList.join(", ")} in their deck`;

  // The same as values with their sources, for the row itself.
  const raiseItems: FitContextItem[] =
    pitch !== null && deckAmount !== undefined && sameFigure(pitch, deckAmount)
      ? [{ label: "Raise", value: pitch, source: "PITCH_AND_DECK" }]
      : [
          ...(pitch === null
            ? []
            : [{ label: "Raise", value: pitch, source: "PITCH" as const }]),
          ...(deckAmount === undefined
            ? []
            : [{ label: "Raise", value: deckAmount, source: "DECK" as const }]),
        ];
  const termsItems: FitContextItem[] = [
    ...(instrument === undefined
      ? []
      : [{ label: "Instrument", value: instrument, source: "DECK" as const }]),
    ...(ask.valuationCap !== undefined
      ? [
          {
            label: "Valuation cap",
            value: ask.valuationCap,
            source: "DECK" as const,
          },
        ]
      : ask.valuation !== undefined
        ? [
            {
              label: "Valuation",
              value: ask.valuation,
              source: "DECK" as const,
            },
          ]
        : []),
  ];

  const statedRound =
    raise === undefined && terms === undefined && minimumCheque === undefined
      ? null
      : {
          ...(raise === undefined ? {} : { raise }),
          ...(minimumCheque === undefined ? {} : { minimumCheque }),
          ...(terms === undefined ? {} : { terms }),
          raiseItems,
          termsItems,
        };

  const evidence: FitEvidenceLine[] = [];
  if (pitch !== null) {
    evidence.push({ source: "PITCH", label: "Pitch · Raise", value: pitch });
  }
  for (const section of sections) {
    for (const fact of section.facts) {
      evidence.push({
        source: "DECK",
        label: `${DECK_SECTION_LABELS[section.section]} · ${fact.label}`,
        value:
          fact.value === null ? null : fact.value.slice(0, EVIDENCE_VALUE_MAX),
      });
    }
  }
  const confidential =
    sections.length > 0 && input.deck?.deck?.downloadable !== true;
  return {
    statedRound,
    pitchMoney:
      input.raise?.source === "PITCH_CLAIM" && input.raise.money !== null
        ? {
            amount: input.raise.money.amount,
            currency: input.raise.money.currency,
          }
        : null,
    evidence: evidence.slice(0, FIT_EVIDENCE_LINES_MAX),
    confidential,
  };
}
