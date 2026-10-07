import type {
  DiscoveryReasonDto,
  InvestorGateFitDto,
} from "@capital-q/contracts";

/**
 * "What this investor looks for" (Q.05; design
 * docs/design/2026-10-07/overdeliver, "investor"), as words.
 *
 * Built ONLY from what the investor publishes: their public profile (and
 * the founder's Discover reasons, which are computed against that public
 * profile) and their published GateQ criteria with the founder's own
 * standing on each (met / not met / not known yet), as the API computed
 * it. The private mandate never reaches this code: no field here can carry
 * it, and the API that fills it never reads it for a founder.
 *
 * Unknown is never a "no": a criterion the founder's profile cannot answer
 * reads "Not known yet" with what would answer it.
 */

export type LooksForStanding = "MET" | "NOT_MET" | "UNKNOWN";

export type LooksForRow = {
  readonly label: string;
  readonly standing: LooksForStanding;
  /** The founder's fit in words. */
  readonly words: string;
  readonly required: boolean;
};

export const STANDING_WORDS: Readonly<Record<LooksForStanding, string>> = {
  MET: "Met",
  NOT_MET: "Not met",
  UNKNOWN: "Not known yet",
};

type Dimension = InvestorGateFitDto["criteria"][number]["dimension"];

const SUBJECT: Readonly<Record<Dimension, string>> = {
  TAXONOMY: "sector",
  EXCLUDED_TAXONOMY: "sector",
  GEOGRAPHY: "location",
  STAGE: "stage",
  RAISE_SIZE: "raise",
  CHEQUE_COMPATIBILITY: "raise",
};

const ANSWER_WHERE: Readonly<Record<Dimension, string>> = {
  TAXONOMY: "Add your sectors to your profile.",
  EXCLUDED_TAXONOMY: "Add your sectors to your profile.",
  GEOGRAPHY: "Add where you are based to your profile.",
  STAGE: "Add your stage to your profile.",
  RAISE_SIZE: "Save your raise on Capital.",
  CHEQUE_COMPATIBILITY: "Save your raise on Capital.",
};

export function criterionWords(
  dimension: Dimension,
  standing: LooksForStanding,
): string {
  const subject = SUBJECT[dimension];
  if (standing === "UNKNOWN") {
    return `Your ${subject} isn't on your profile yet. ${ANSWER_WHERE[dimension]}`;
  }
  if (dimension === "EXCLUDED_TAXONOMY") {
    return standing === "MET"
      ? "Your sector is not one they exclude."
      : "Your sector is one they exclude.";
  }
  return standing === "MET"
    ? `Your ${subject} is within what they publish.`
    : `Your ${subject} is outside what they publish.`;
}

export function gateRows(gate: InvestorGateFitDto | null): LooksForRow[] {
  if (gate === null) return [];
  return gate.criteria.map((criterion) => ({
    label: criterion.label,
    standing: criterion.standing,
    words: criterionWords(criterion.dimension, criterion.standing),
    required: criterion.requiredness === "REQUIRED",
  }));
}

/** Discover's reasons are public-profile matches: each is a "met". */
export function profileRows(
  reasons: readonly DiscoveryReasonDto[],
): LooksForRow[] {
  const LABEL: Partial<Record<DiscoveryReasonDto["kind"], string>> = {
    STAGE_IN_RANGE: "Stage",
    SECTOR_MATCH: "Sector",
    GEOGRAPHY_MATCH: "Geography",
    BUSINESS_MODEL_MATCH: "Business model",
    CUSTOMER_TYPE_MATCH: "Customer type",
    DECLARED_DEPLOYING: "Deploying now",
  };
  return reasons.flatMap((reason) => {
    const label = LABEL[reason.kind];
    return label === undefined
      ? []
      : [
          {
            label,
            standing: "MET" as const,
            words: reason.detail,
            required: false,
          },
        ];
  });
}

/** Where "Draft my application" goes: the gate's own form, or nowhere. */
export function draftHref(gate: InvestorGateFitDto | null): string | null {
  if (gate === null || !gate.acceptingApplications) return null;
  return `/g/${encodeURIComponent(gate.publicId)}`;
}

export function standingTally(rows: readonly LooksForRow[]): string {
  const met = rows.filter((row) => row.standing === "MET").length;
  const unknown = rows.filter((row) => row.standing === "UNKNOWN").length;
  const parts = [`You meet ${String(met)} of ${String(rows.length)}`];
  if (unknown > 0) parts.push(`${String(unknown)} not known yet`);
  return parts.join("; ");
}
