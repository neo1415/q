import {
  deckAskTerms,
  type CompanyProfileDto,
  type DeckFact,
  type DeckSection,
  type DeckSectionCode,
  type PitchClaimDto,
  type RelationshipStateV2,
} from "@capital-q/contracts";

import { compactMoneyText } from "../money-text";
import { pitchMoment } from "../overview-sections";
import { raiseWords, type RaiseWords } from "../raise-words";
import type { Evidence } from "./parts";

/**
 * What the decision brief shows, read from what this reader was sent
 * (profile option 1). Pure: no access is decided here, and nothing is
 * invented. A fact the reader does not have stays "not known yet"; a
 * company's figure is always its claim unless a document supports it.
 */

/** The relationship chip's words beside the company's facts. */
export function relationshipWords(
  state: RelationshipStateV2 | null,
): string | null {
  switch (state) {
    case null:
    case "DISCOVERED":
      return null;
    case "INTEREST_EXPRESSED":
      return "Interest sent";
    case "CONNECTED":
      return "Connected";
    case "MEETING_HELD":
      return "Met";
    case "IN_DILIGENCE":
      return "In diligence";
    case "PAUSED":
      return "Paused";
    case "PASSED":
      return "Passed";
    case "DECLINED":
      return "Declined";
    case "INVESTED":
      return "Invested";
  }
}

export type HeaderRaise = {
  /** "$4M post-money safe, $30m cap"; null: no raise shared. */
  readonly words: string | null;
  /** Where the figure comes from, for its popover. */
  readonly source: string;
};

/** The raise as the header says it, with where it comes from. */
export function headerRaise(input: {
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly deck: readonly DeckSection[] | null;
}): HeaderRaise {
  const overview = input.profile.overview;
  if (overview === null) return { words: null, source: "" };
  const terms = deckAskTerms(input.deck);
  const view =
    overview.raiseView === undefined
      ? null
      : raiseWords(overview.raiseView, input.own);
  const said = overview.raiseFromPitch;
  const amount =
    view?.amount ??
    (overview.raise !== null
      ? compactMoneyText(overview.raise)
      : said?.money !== null && said?.money !== undefined
        ? compactMoneyText(said.money)
        : (terms.amount ?? null));
  if (amount === null) return { words: null, source: "" };
  const instrument =
    terms.instrument ??
    overview.pitchClaims.find((claim) => claim.kind === "INSTRUMENT")
      ?.instrument ??
    null;
  const cap = terms.valuationCap;
  const words = [
    instrument === null ? amount : `${amount} ${instrument.toLowerCase()}`,
    cap === undefined ? null : `${cap} cap`,
  ]
    .filter((part) => part !== null)
    .join(", ");
  const pitch = overview.raiseView?.pitch ?? said;
  const fromPitch =
    view?.source === "PITCH_CLAIM" || (view === null && said !== null);
  const where = [
    fromPitch && pitch !== null && pitch !== undefined
      ? `Pitch video at ${pitchMoment(pitch.atSeconds)}`
      : view?.source === "DISCLOSED_OBJECTIVE" || overview.raise !== null
        ? "Declared by the company on Capital Q"
        : null,
    terms.amount !== undefined || cap !== undefined ? "the deck" : null,
  ]
    .filter((part) => part !== null)
    .join(" and ");
  return {
    words,
    source: `${where === "" ? "The deck" : where}. Founder’s claim, self-reported. Not verified.`,
  };
}

export type KeyNumber = {
  readonly label: string;
  readonly value: string;
  /** The raise cell: the one raise read's words (R2), same as Discover. */
  readonly raise?: RaiseWords | undefined;
};

const LOOK: readonly (readonly [string, DeckSectionCode[], RegExp])[] = [
  [
    "Contracted ARR",
    ["TRACTION", "FINANCIALS"],
    /\b(arr|recurring revenue)\b/iu,
  ],
  ["Revenue", ["TRACTION", "FINANCIALS"], /\b(revenue|mrr|sales|gmv)\b/iu],
  [
    "Customers",
    ["TRACTION"],
    /\b(contracts?|customers?|clients?|clinics?|users?|partners?|merchants?)\b/iu,
  ],
  ["Runway", ["FINANCIALS", "THE_ASK"], /\brunway\b/iu],
  ["Monthly burn", ["FINANCIALS"], /\bburn\b/iu],
];

function factIn(
  deck: readonly DeckSection[],
  codes: readonly DeckSectionCode[],
  pattern: RegExp,
  taken: ReadonlySet<DeckFact>,
): DeckFact | undefined {
  for (const section of deck) {
    if (!codes.includes(section.section) || section.status !== "PRESENT")
      continue;
    const found = section.facts.find(
      (fact) =>
        fact.value !== null &&
        fact.value.length <= 40 &&
        pattern.test(fact.label) &&
        !taken.has(fact),
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Up to six key numbers, the round first: only what the deck (or the
 * pitch) states; never a placeholder for what it does not.
 */
export function keyNumbers(input: {
  readonly deck: readonly DeckSection[] | null;
  readonly raise: string | null;
  /** The server's one raise read for this reader, where it sent one. */
  readonly raiseWords?: RaiseWords | null | undefined;
}): readonly KeyNumber[] {
  const deck = input.deck ?? [];
  const terms = deckAskTerms(deck);
  const out: KeyNumber[] = [];
  const words = input.raiseWords ?? null;
  if (words !== null && (words.amount !== null || terms.amount === undefined)) {
    // The same raise, in the same words, as the Discover card (R2).
    out.push({
      label: "Raising",
      value: words.amount ?? words.label,
      raise: words,
    });
  } else {
    const raising = terms.amount ?? input.raise;
    if (raising !== null) out.push({ label: "Raising", value: raising });
  }
  if (terms.valuationCap !== undefined)
    out.push({ label: "Valuation cap", value: terms.valuationCap });
  else if (terms.valuation !== undefined)
    out.push({ label: "Valuation", value: terms.valuation });
  if (terms.minimumCheque !== undefined)
    out.push({ label: "Minimum cheque", value: terms.minimumCheque });
  const taken = new Set<DeckFact>();
  for (const [, codes, pattern] of LOOK) {
    if (out.length >= 6) break;
    const fact = factIn(deck, codes, pattern, taken);
    if (fact === undefined || fact.value === null) continue;
    taken.add(fact);
    out.push({ label: fact.label, value: fact.value });
  }
  return out.slice(0, 6);
}

/** "Deck, slide 7": a deck fact's place, never its verification. */
export function deckWhere(fact: DeckFact): string | null {
  const page = [...fact.pages].sort((a, b) => a - b)[0];
  return page === undefined ? "Deck" : `Deck, slide ${String(page)}`;
}

export function deckEvidence(fact: DeckFact): Evidence {
  if (fact.value === null) return "unk";
  return fact.evidenceStatus === "DOCUMENT_SUPPORTED" ? "doc" : "claim";
}

/** "Pitch video, 0:43". */
export function pitchWhere(claim: Pick<PitchClaimDto, "atSeconds">): string {
  return `Pitch video, ${pitchMoment(claim.atSeconds)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
