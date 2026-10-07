import {
  GATEQ_DECLINED,
  GATEQ_NOTE_MAX_CHARS,
  type GATEQ_INSTRUMENTS,
  type GATEQ_LEAD_STATUSES,
  type ApplicationAnswersRequest,
  type ApplicationSummaryDto,
  type PublicGatewayDto,
} from "@capital-q/contracts";

/**
 * The GateQ form (F1, 2026-10-06): what the founder answers, step by step,
 * and how the investor's rules read back. Pure, so the steps, validation
 * and wording are tested without a browser.
 *
 * Nothing here decides fit. The rule-by-rule result is the API's: GATE-001's
 * deterministic engine under the gateway's frozen policy, reported as the
 * investor's own rule labels that are unmet or still unknown. The form only
 * collects answers and shows that answer back.
 */

export const DECLINED = GATEQ_DECLINED;
export type Declined = typeof DECLINED;

export const FORM_STEPS = ["company", "round", "share", "note"] as const;
export type FormStep = (typeof FORM_STEPS)[number] | "check" | "sent";

export type Choice = { readonly value: string; readonly label: string };

export const STAGE_CHOICES: readonly Choice[] = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
  { value: "series_c_plus", label: "Later" },
];

/** Plain words; the server's taxonomy resolver decides what they mean. */
export const SECTOR_CHOICES: readonly Choice[] = [
  { value: "Fintech", label: "Fintech" },
  { value: "Health", label: "Health" },
  { value: "Agriculture", label: "Agriculture" },
  { value: "Climate", label: "Climate" },
  { value: "Commerce", label: "Commerce" },
  { value: "Software", label: "Software" },
];

export const COUNTRY_CHOICES: readonly Choice[] = [
  { value: "NG", label: "Nigeria" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "ZA", label: "South Africa" },
  { value: "EG", label: "Egypt" },
];

/** "Elsewhere" opens this longer list. ISO 3166-1 alpha-2. */
export const MORE_COUNTRIES: readonly Choice[] = [
  { value: "SN", label: "Senegal" },
  { value: "CI", label: "Côte d'Ivoire" },
  { value: "RW", label: "Rwanda" },
  { value: "UG", label: "Uganda" },
  { value: "TZ", label: "Tanzania" },
  { value: "ET", label: "Ethiopia" },
  { value: "MA", label: "Morocco" },
  { value: "TN", label: "Tunisia" },
  { value: "CM", label: "Cameroon" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "NL", label: "Netherlands" },
  { value: "IN", label: "India" },
  { value: "SG", label: "Singapore" },
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
];

/**
 * Round-size bands. A band is a quick way to find the exact figure, never a
 * figure itself: without an exact amount the round-size rule stays unknown
 * rather than being judged on a number nobody said.
 */
export const RAISE_BANDS = [
  { value: "under_500k", label: "Under $500k", min: 0, max: 500_000 },
  { value: "500k_1m", label: "$500k–$1M", min: 500_000, max: 1_000_000 },
  { value: "1m_3m", label: "$1M–$3M", min: 1_000_000, max: 3_000_000 },
  { value: "over_3m", label: "Over $3M", min: 3_000_000, max: Infinity },
] as const;

export const CURRENCIES = [
  "USD",
  "NGN",
  "KES",
  "GHS",
  "ZAR",
  "EUR",
  "GBP",
] as const;

export type Instrument = (typeof GATEQ_INSTRUMENTS)[number];
export type LeadStatus = (typeof GATEQ_LEAD_STATUSES)[number];

export const INSTRUMENT_CHOICES: readonly {
  readonly value: Instrument;
  readonly label: string;
}[] = [
  { value: "SAFE", label: "SAFE" },
  { value: "EQUITY", label: "Equity" },
  { value: "CONVERTIBLE_NOTE", label: "Convertible note" },
  { value: "NOT_DECIDED", label: "Not decided" },
];

export const LEAD_CHOICES: readonly {
  readonly value: LeadStatus;
  readonly label: string;
}[] = [
  { value: "HAS_LEAD", label: "Yes" },
  { value: "LOOKING", label: "Looking for one" },
  { value: "NOT_NEEDED", label: "Not needed" },
];

export type Material = {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
};

/** Everything the founder has answered so far. Empty string: not yet. */
export type FormAnswers = {
  readonly companyName: string;
  readonly oneLiner: string;
  /** A stage code, or DECLINED ("I'd rather not say"). */
  readonly stage: string;
  readonly sectors: readonly string[] | Declined;
  readonly otherSector: string;
  /** ISO alpha-2, or DECLINED. */
  readonly country: string;
  /** A RAISE_BANDS value, or DECLINED. */
  readonly band: string;
  readonly currency: string;
  readonly amount: string;
  readonly instrument: Instrument | Declined | "";
  readonly lead: LeadStatus | Declined | "";
  readonly materials: readonly string[];
  readonly contactName: string;
  readonly contactEmail: string;
  readonly note: string;
};

export const EMPTY_ANSWERS: FormAnswers = {
  companyName: "",
  oneLiner: "",
  stage: "",
  sectors: [],
  otherSector: "",
  country: "",
  band: "",
  currency: "USD",
  amount: "",
  instrument: "",
  lead: "",
  materials: [],
  contactName: "",
  contactEmail: "",
  note: "",
};

/** What the founder's Capital Q profile already says (signed in only). */
export type FormPrefill = {
  readonly companyName: string;
  readonly oneLiner: string | null;
  readonly stageCode: string | null;
  readonly country: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
};

export function answersFromProfile(prefill: FormPrefill | null): {
  readonly answers: FormAnswers;
  readonly fromProfile: ReadonlySet<keyof FormAnswers>;
} {
  if (prefill === null)
    return { answers: EMPTY_ANSWERS, fromProfile: new Set() };
  const fromProfile = new Set<keyof FormAnswers>(["companyName"]);
  const stage = STAGE_CHOICES.some((c) => c.value === prefill.stageCode)
    ? (prefill.stageCode ?? "")
    : "";
  if (stage !== "") fromProfile.add("stage");
  const country =
    prefill.country !== null && /^[A-Z]{2}$/.test(prefill.country)
      ? prefill.country
      : "";
  if (country !== "") fromProfile.add("country");
  if (prefill.oneLiner !== null) fromProfile.add("oneLiner");
  return {
    answers: {
      ...EMPTY_ANSWERS,
      companyName: prefill.companyName,
      oneLiner: prefill.oneLiner ?? "",
      stage,
      country,
      contactName: prefill.contactName ?? "",
      contactEmail: prefill.contactEmail ?? "",
    },
    fromProfile,
  };
}

/** Digits and one decimal point; "1,200,000" and "1 200 000" are fine. */
export function normaliseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[\s,_]/g, "");
  if (cleaned === "") return null;
  if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

/** The band an exact amount falls in, so the chip follows the figure. */
export function bandFor(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return (
    RAISE_BANDS.find((band) => value >= band.min && value < band.max)?.value ??
    ""
  );
}

export type StepErrors = Partial<Record<keyof FormAnswers, string>>;

/** What blocks Continue on a step. Unknown is always allowed. */
export function validateStep(
  step: FormStep,
  answers: FormAnswers,
  options: { readonly anonymous: boolean },
): StepErrors {
  const errors: StepErrors = {};
  if (step === "company") {
    if (answers.companyName.trim() === "") {
      errors.companyName = "Add your company's name.";
    }
    if (answers.stage === "")
      errors.stage = "Pick one, or say you'd rather not.";
    if (
      answers.sectors !== DECLINED &&
      answers.sectors.length === 0 &&
      answers.otherSector.trim() === ""
    ) {
      errors.sectors = "Pick one, or say you'd rather not.";
    }
    if (answers.country === "") {
      errors.country = "Pick one, or say you'd rather not.";
    }
  }
  if (step === "round") {
    if (answers.band === "") errors.band = "Pick one, or say you'd rather not.";
    if (answers.band !== DECLINED && answers.amount.trim() !== "") {
      if (normaliseAmount(answers.amount) === null) {
        errors.amount = "Use numbers only, like 1,200,000.";
      }
    }
  }
  if (step === "share" && options.anonymous) {
    if (answers.contactEmail.trim() === "") {
      errors.contactEmail = "Add an email so they can reply.";
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.contactEmail.trim())
    ) {
      errors.contactEmail = "That email doesn't look right.";
    }
  }
  if (step === "note" && answers.note.length > GATEQ_NOTE_MAX_CHARS) {
    errors.note = `Keep it to ${GATEQ_NOTE_MAX_CHARS} characters.`;
  }
  return errors;
}

/** The step's answers as the API's bounded request. Untouched fields are left out. */
export function requestFor(
  step: FormStep,
  answers: FormAnswers,
): ApplicationAnswersRequest {
  if (step === "company") {
    const sectors =
      answers.sectors === DECLINED
        ? DECLINED
        : [...answers.sectors, answers.otherSector.trim()].filter(
            (word) => word !== "",
          );
    return {
      companyName: answers.companyName.trim(),
      ...(answers.oneLiner.trim() === ""
        ? {}
        : { oneLiner: answers.oneLiner.trim().slice(0, 280) }),
      ...(answers.stage === "" ? {} : { stage: answers.stage }),
      ...(sectors === DECLINED || sectors.length > 0 ? { sectors } : {}),
      ...(answers.country === "" ? {} : { country: answers.country }),
    };
  }
  if (step === "round") {
    const amount = normaliseAmount(answers.amount);
    return {
      ...(answers.band === DECLINED
        ? { raise: DECLINED }
        : amount === null
          ? {}
          : { raise: { amount, currency: answers.currency } }),
      ...(answers.instrument === "" ? {} : { instrument: answers.instrument }),
      ...(answers.lead === "" ? {} : { lead: answers.lead }),
    };
  }
  if (step === "share") {
    return {
      ...(answers.contactName.trim() === ""
        ? {}
        : { contactName: answers.contactName.trim() }),
      ...(answers.contactEmail.trim() === ""
        ? {}
        : { contactEmail: answers.contactEmail.trim() }),
    };
  }
  if (step === "note") return { note: answers.note.trim() };
  return {};
}

/** A first note from the profile: the founder's to change, never sent unseen. */
export function draftNote(fund: string, answers: FormAnswers): string {
  const parts = [`Hi ${fund} team,`];
  if (answers.oneLiner.trim() !== "") {
    const line = answers.oneLiner.trim().replace(/\.$/, "");
    parts.push(`${answers.companyName.trim()}: ${line}.`);
  }
  const amount = normaliseAmount(answers.amount);
  if (answers.band !== DECLINED && amount !== null) {
    parts.push(`We're raising ${formatMoney(amount, answers.currency)}.`);
  }
  return parts.join(" ").slice(0, GATEQ_NOTE_MAX_CHARS);
}

export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (value >= 1_000_000) {
    return `${symbol}${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${value}`;
}

// ---------------------------------------------------------------------------
// The investor's rules, and how the founder stands against them
// ---------------------------------------------------------------------------

export type RuleStanding = "MEETS" | "DOES_NOT_MEET" | "NOT_ANSWERED";

export type RuleLine = {
  readonly label: string;
  readonly dimension: string;
  readonly required: boolean;
  /** Null before any answer has been checked. */
  readonly standing: RuleStanding | null;
};

const DIMENSION_WORDS: Readonly<Record<string, string>> = {
  STAGE: "Stage",
  TAXONOMY: "Sector",
  EXCLUDED_TAXONOMY: "Never",
  GEOGRAPHY: "Where",
  RAISE_SIZE: "Round size",
  CHEQUE_COMPATIBILITY: "Cheque size",
};

export function dimensionWord(dimension: string): string {
  return DIMENSION_WORDS[dimension] ?? "Rule";
}

export function ruleLines(
  gateway: Pick<PublicGatewayDto, "criteria">,
  application: Pick<ApplicationSummaryDto, "unmet" | "stillNeeded"> | null,
): readonly RuleLine[] {
  return gateway.criteria.map((criterion) => ({
    label: criterion.label,
    dimension: criterion.dimension,
    required: criterion.requiredness === "REQUIRED",
    standing:
      application === null
        ? null
        : application.unmet.includes(criterion.label)
          ? "DOES_NOT_MEET"
          : application.stillNeeded.includes(criterion.label)
            ? "NOT_ANSWERED"
            : "MEETS",
  }));
}

export type Verdict = "FITS" | "NOT_A_FIT" | "NEEDS_ANSWERS";

/** The engine's access decision, in the form's terms. Never the model's. */
export function verdictFor(
  application: Pick<ApplicationSummaryDto, "access"> | null,
): Verdict | null {
  if (application === null) return null;
  if (application.access === "MAY_APPLY") return "FITS";
  if (application.access === "MAY_NOT_APPLY") return "NOT_A_FIT";
  return "NEEDS_ANSWERS";
}

/** Only an application the engine admits can be sent; the API refuses the rest. */
export function maySend(verdict: Verdict | null): boolean {
  return verdict === "FITS";
}

export function verdictTitle(
  verdict: Verdict,
  fund: string,
  lines: readonly RuleLine[],
): string {
  const met = lines.filter((line) => line.standing === "MEETS").length;
  if (verdict === "FITS") {
    // F28: no published criteria means nothing was checked, not a fit.
    if (lines.length === 0) {
      return `${fund} has no published criteria yet; you can apply`;
    }
    return met === lines.length
      ? `You meet all ${lines.length} of ${fund}'s rules`
      : `You can apply to ${fund}`;
  }
  if (verdict === "NOT_A_FIT") {
    const miss = lines.find((line) => line.standing === "DOES_NOT_MEET");
    return miss === undefined
      ? `${fund}'s rules rule this one out`
      : `${fund} only takes companies that meet "${miss.label}"`;
  }
  return `A few answers are still missing`;
}

/** Which step answers a rule, so "Answer it" goes to the right place. */
export function stepForDimension(dimension: string): FormStep {
  return dimension === "RAISE_SIZE" || dimension === "CHEQUE_COMPATIBILITY"
    ? "round"
    : "company";
}
