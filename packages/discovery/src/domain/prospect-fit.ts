/**
 * Which network-visible investors a company might approach (CQ-QX-007,
 * acceptance directive E): company → investors, from the investors'
 * DECLARED, network-visible profile only.
 *
 * Not a match and not interest. An investor's mandate is investor-private
 * and must not shape anything a founder sees (doc 19 §204.9), so nothing
 * here reads one: only the profile an investor chose to make visible to
 * the network — where they are, whether they say they are deploying, and
 * what kind of investor they are. Every reason is deterministic and named;
 * there is no model in this path.
 *
 * Unknown is never a penalty: a company whose stage is unknown is simply
 * not compared on stage, and an investor who has not said where they are
 * is simply not compared on geography. A candidate with no positive reason
 * is not a prospect and is left out rather than ranked low.
 */

export const PROSPECT_FIT_VERSION = "prospect-fit.v1" as const;

/**
 * Stages each declared investor type typically writes cheques into.
 * Capital Q's own heuristic over its own codes, versioned with this
 * module; it says "typically", never "will". Types absent here (OTHER,
 * INSTITUTIONAL…) are not compared on stage.
 */
export const TYPICAL_STAGES_BY_INVESTOR_TYPE: Readonly<
  Record<string, readonly string[]>
> = {
  ANGEL: ["pre_seed", "seed"],
  ACCELERATOR: ["pre_seed", "seed"],
  SCOUT: ["pre_seed", "seed"],
  SYNDICATE: ["pre_seed", "seed", "series_a"],
  VC: ["seed", "series_a", "series_b"],
  FAMILY_OFFICE: ["seed", "series_a", "series_b", "series_c_plus"],
  CVC: ["series_a", "series_b", "series_c_plus"],
};

export const PROSPECT_WEIGHT = {
  sameCountry: 30,
  typicalStage: 25,
  activelyDeploying: 20,
  selectivelyDeploying: 10,
} as const;

export const PROSPECT_REASON_KINDS = [
  "SAME_COUNTRY",
  "TYPICAL_STAGE",
  "DEPLOYING",
] as const;
export type ProspectReasonKind = (typeof PROSPECT_REASON_KINDS)[number];

export type ProspectReason = {
  readonly kind: ProspectReasonKind;
  readonly detail: string;
};

/** What is known of the company; null is unknown, never "none". */
export type ProspectCompany = {
  /** ISO 3166-1 alpha-2, any case. */
  readonly countryCode: string | null;
  /** A Capital Q stage code: pre_seed, seed, series_a… */
  readonly stageCode: string | null;
};

/** The investor's network-visible declared profile. */
export type ProspectInvestor = {
  readonly investorType: string | null;
  readonly hqCountry: string | null;
  readonly deploymentState: string | null;
};

export type ProspectFit = {
  readonly score: number;
  readonly reasons: readonly ProspectReason[];
};

const stageWords = (code: string): string => code.replace(/_/g, " ");

export function prospectFit(
  company: ProspectCompany,
  investor: ProspectInvestor,
): ProspectFit {
  const reasons: ProspectReason[] = [];
  let score = 0;

  const country = company.countryCode?.trim().toUpperCase() ?? "";
  const hq = investor.hqCountry?.trim().toUpperCase() ?? "";
  if (country.length === 2 && hq.length === 2 && country === hq) {
    score += PROSPECT_WEIGHT.sameCountry;
    reasons.push({
      kind: "SAME_COUNTRY",
      detail: `based in the same country (${hq})`,
    });
  }

  const typical =
    investor.investorType === null
      ? undefined
      : TYPICAL_STAGES_BY_INVESTOR_TYPE[investor.investorType];
  const stage = company.stageCode?.trim().toLowerCase() ?? "";
  if (typical !== undefined && stage.length > 0 && typical.includes(stage)) {
    score += PROSPECT_WEIGHT.typicalStage;
    reasons.push({
      kind: "TYPICAL_STAGE",
      detail: `${stageWords(investor.investorType ?? "").toLowerCase()} investors typically back ${stageWords(stage)} companies`,
    });
  }

  if (investor.deploymentState === "ACTIVELY_INVESTING") {
    score += PROSPECT_WEIGHT.activelyDeploying;
    reasons.push({
      kind: "DEPLOYING",
      detail: "says it is actively investing",
    });
  } else if (investor.deploymentState === "SELECTIVE") {
    score += PROSPECT_WEIGHT.selectivelyDeploying;
    reasons.push({
      kind: "DEPLOYING",
      detail: "says it is investing selectively",
    });
  }

  return { score, reasons };
}

/**
 * The prospects among candidates: those with at least one reason, best
 * first, ties by name then id so the list is reproducible from the rows.
 */
export function rankProspects<
  T extends ProspectInvestor & {
    readonly displayName: string;
    readonly investorOrganisationId: string;
  },
>(
  company: ProspectCompany,
  candidates: readonly T[],
): readonly (T & ProspectFit)[] {
  return candidates
    .map((candidate) => ({ ...candidate, ...prospectFit(company, candidate) }))
    .filter((candidate) => candidate.reasons.length > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.displayName.localeCompare(b.displayName) ||
        a.investorOrganisationId.localeCompare(b.investorOrganisationId),
    );
}
