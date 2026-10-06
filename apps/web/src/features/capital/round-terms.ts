import type {
  CapitalRoundTerms,
  CapitalRoundTermsInput,
  ProRataRights,
  ValuationBasis,
} from "@capital-q/contracts";

/**
 * A round's terms as the form holds them (strings, "" = not said) and the
 * exact request the API takes (plan P8). Pure: the form, the edit sheet and
 * the tests share it. Amounts are typed in the round's own currency; a
 * grouping comma or space is presentation and is dropped, a symbol is not
 * accepted. Empty means unknown, never zero.
 */

export type TermsDraft = {
  readonly targetCloseOn: string;
  readonly valuationAmount: string;
  readonly valuationBasis: ValuationBasis;
  readonly valuationCap: string;
  readonly discountPercent: string;
  readonly hardCap: string;
  readonly proRataRights: ProRataRights | "";
  /** "" none; "rel:<uuid>" a relationship; "named" the typed name below. */
  readonly leadChoice: string;
  readonly leadName: string;
  readonly extendsRoundId: string;
  readonly reportedRaised: string;
};

export const EMPTY_DRAFT: TermsDraft = {
  targetCloseOn: "",
  valuationAmount: "",
  valuationBasis: "POST_MONEY",
  valuationCap: "",
  discountPercent: "",
  hardCap: "",
  proRataRights: "",
  leadChoice: "",
  leadName: "",
  extendsRoundId: "",
  reportedRaised: "",
};

export function draftOf(terms: CapitalRoundTerms): TermsDraft {
  return {
    targetCloseOn: terms.targetCloseOn ?? "",
    valuationAmount: terms.valuation?.amount ?? "",
    valuationBasis: terms.valuation?.basis ?? "POST_MONEY",
    valuationCap: terms.valuationCap ?? "",
    discountPercent: terms.discountPercent ?? "",
    hardCap: terms.hardCap ?? "",
    proRataRights: terms.proRataRights ?? "",
    leadChoice:
      terms.lead === null
        ? ""
        : terms.lead.kind === "RELATIONSHIP"
          ? `rel:${terms.lead.relationshipId}`
          : "named",
    leadName: terms.lead?.kind === "NAMED" ? terms.lead.name : "",
    extendsRoundId: terms.extendsRoundId ?? "",
    reportedRaised: terms.reportedRaised ?? "",
  };
}

const AMOUNT = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;
const PERCENT = /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/;

/** "1,500,000" -> "1500000"; "" stays "". */
export function cleanAmount(value: string): string {
  return value.replace(/[\s,]/g, "");
}

function minor(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

export type TermsResult =
  | { readonly ok: true; readonly terms: CapitalRoundTermsInput }
  | { readonly ok: false; readonly message: string };

/**
 * The terms to send, or the one sentence that says what to fix. Every field
 * is sent (an emptied one as null) so an edit can clear a term.
 */
export function termsFromDraft(
  draft: TermsDraft,
  context: { readonly target: string; readonly currency: string },
): TermsResult {
  const amount = (value: string, words: string, positive = true) => {
    const clean = cleanAmount(value);
    if (clean === "") return { ok: true as const, value: null };
    if (!AMOUNT.test(clean) || (positive && !/[1-9]/.test(clean))) {
      return {
        ok: false as const,
        message: `Write the ${words} in ${context.currency} as a number, like 1500000.`,
      };
    }
    return { ok: true as const, value: clean };
  };
  const valuation = amount(draft.valuationAmount, "valuation");
  if (!valuation.ok) return valuation;
  const cap = amount(draft.valuationCap, "valuation cap");
  if (!cap.ok) return cap;
  const hardCap = amount(draft.hardCap, "hard cap");
  if (!hardCap.ok) return hardCap;
  const reported = amount(draft.reportedRaised, "amount raised", false);
  if (!reported.ok) return reported;
  const discount = draft.discountPercent.replace(/[\s%]/g, "");
  if (discount !== "" && (!PERCENT.test(discount) || !/[1-9]/.test(discount))) {
    return { ok: false, message: "A discount is a percent above 0 and below 100, like 20." };
  }
  const target = cleanAmount(context.target);
  if (
    hardCap.value !== null &&
    AMOUNT.test(target) &&
    minor(hardCap.value) < minor(target)
  ) {
    return { ok: false, message: "The hard cap can't be below the target." };
  }
  if (draft.leadChoice === "named" && draft.leadName.trim() === "") {
    return { ok: false, message: "Add the lead investor's name, or pick none." };
  }
  return {
    ok: true,
    terms: {
      targetCloseOn: draft.targetCloseOn === "" ? null : draft.targetCloseOn,
      valuation:
        valuation.value === null
          ? null
          : { amount: valuation.value, basis: draft.valuationBasis },
      valuationCap: cap.value,
      discountPercent: discount === "" ? null : discount,
      hardCap: hardCap.value,
      proRataRights: draft.proRataRights === "" ? null : draft.proRataRights,
      lead: draft.leadChoice.startsWith("rel:")
        ? { kind: "RELATIONSHIP", relationshipId: draft.leadChoice.slice(4) }
        : draft.leadChoice === "named"
          ? { kind: "NAMED", name: draft.leadName.trim() }
          : null,
      extendsRoundId: draft.extendsRoundId === "" ? null : draft.extendsRoundId,
      reportedRaised: reported.value,
    },
  };
}

/** Only the terms that were said (a new round sends no nulls). */
export function saidTerms(
  terms: CapitalRoundTermsInput,
): CapitalRoundTermsInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(terms)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out as CapitalRoundTermsInput;
}

/** Only the terms that differ from what the round has: an edit sends just those. */
export function changedTerms(
  before: CapitalRoundTerms,
  after: CapitalRoundTermsInput,
): CapitalRoundTermsInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const was = (before as Record<string, unknown>)[key];
    if (JSON.stringify(was ?? null) !== JSON.stringify(value ?? null)) {
      out[key] = value;
    }
  }
  return out as CapitalRoundTermsInput;
}
