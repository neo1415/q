import type {
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";

/**
 * What the founder is shown about fit (P7), derived only from the API's
 * deterministic answer: GateQ's access decision and the published labels
 * it named. Nothing here decides anything. A model sentence in the
 * conversation saying "you look like a fit" changes none of this.
 *
 *   fits       the published rules admit the application (MAY_APPLY)
 *   not a fit  a required rule is established as unmet (MAY_NOT_APPLY)
 *   partial    some rules are still unknown and the founder stopped there;
 *              unknown is not a no, and is never shown as one
 */
export type FitVerdict = "FITS" | "PARTIAL" | "NOT_A_FIT";

export type CriterionStanding = "MET" | "NOT_MET" | "UNKNOWN";

export type CriterionLine = {
  readonly label: string;
  readonly required: boolean;
  readonly standing: CriterionStanding;
};

export function criterionLines(
  gateway: Pick<PublicGatewayDto, "criteria">,
  application: Pick<ApplicationSummaryDto, "unmet" | "stillNeeded"> | null,
): readonly CriterionLine[] {
  return gateway.criteria.map((criterion) => ({
    label: criterion.label,
    required: criterion.requiredness === "REQUIRED",
    standing:
      application === null || application.stillNeeded.includes(criterion.label)
        ? "UNKNOWN"
        : application.unmet.includes(criterion.label)
          ? "NOT_MET"
          : "MET",
  }));
}

/**
 * The verdict to show, or null while the conversation is still finding out.
 * `stopped` is the founder saying "that's all I can share".
 */
export function verdictOf(
  application: Pick<ApplicationSummaryDto, "access" | "status"> | null,
  stopped: boolean,
): FitVerdict | null {
  if (application === null) return null;
  if (application.access === "MAY_NOT_APPLY") return "NOT_A_FIT";
  if (application.access === "MAY_APPLY") return "FITS";
  return stopped ? "PARTIAL" : null;
}

/** Only an admitted application can be shared: the API refuses the rest. */
export function mayShare(verdict: FitVerdict | null): boolean {
  return verdict === "FITS";
}
