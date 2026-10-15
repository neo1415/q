import type { ApplicationCoverageDto } from "@capital-q/contracts";

/**
 * The live "What we have / What's still needed" reading of an application
 * (directive C2). Built only from the server's coverage check, which reads
 * the durable recorded facts after every completed turn: nothing here is a
 * client-side checkmark, a guess about what was said, or a score.
 *
 * Statuses are the coverage check's own: answered (with where it came
 * from), not known, preferred not to say, still needed (with why, in the
 * check's bounded vocabulary), and answers that disagree. A self-reported
 * traction or revenue answer is also listed as an evidence follow-up: it
 * stays the applicant's claim until a document supports it.
 */

type Coverage = ApplicationCoverageDto["coverage"];
type Missing = Coverage["missing"][number];

export type CoverageHave = {
  readonly dimension: string;
  readonly label: string;
  readonly summary: string;
  /** Where the answer came from, in words; never "verified". */
  readonly source: string;
};

export type CoverageNeed = {
  readonly dimension: string;
  readonly label: string;
  readonly why: string;
  /** Required by the published mandate: listed first. */
  readonly required: boolean;
};

export type CoveragePanelModel = {
  readonly have: readonly CoverageHave[];
  readonly needed: readonly CoverageNeed[];
  readonly notKnown: readonly string[];
  readonly declined: readonly string[];
  readonly conflicts: readonly string[];
  readonly evidenceFollowUps: readonly string[];
  /** One polite sentence for screen readers when the picture changes. */
  readonly status: string;
};

const SOURCE: Record<Coverage["answered"][number]["provenance"], string> = {
  APPLICANT_PROVIDED: "Your answer",
  DOCUMENT_SUPPORTED: "Supported by a shared document",
  ESTIMATED: "Your estimate",
  UNKNOWN: "Source not recorded",
};

const WHY: Record<Missing["reason"], (fund: string) => string> = {
  REQUIRED_BY_GATEWAY: (fund) => `${fund}'s published mandate requires this`,
  PREFERRED_BY_GATEWAY: (fund) => `${fund}'s mandate prefers this`,
  CONTRADICTION: () => "Two answers disagree; one clarification settles it",
  UNDERSTANDING: () => "Helps the investor understand the company",
};

/** Claims an investor will want supported, not merely stated. */
const EVIDENCE_GROUPS: ReadonlySet<string> = new Set(["TRACTION"]);

const RANK: Record<Missing["reason"], number> = {
  REQUIRED_BY_GATEWAY: 0,
  CONTRADICTION: 1,
  PREFERRED_BY_GATEWAY: 2,
  UNDERSTANDING: 3,
};

export function coveragePanelModel(
  dto: ApplicationCoverageDto,
  fund: string,
): CoveragePanelModel {
  const coverage = dto.coverage;
  const have = coverage.answered.map((item) => ({
    dimension: item.dimension,
    label: item.label,
    summary: item.summary,
    source: SOURCE[item.provenance],
  }));
  const needed = [...coverage.missing]
    .sort((a, b) => RANK[a.reason] - RANK[b.reason])
    .map((item) => ({
      dimension: item.dimension,
      label: item.label,
      why: WHY[item.reason](fund),
      required: item.reason === "REQUIRED_BY_GATEWAY",
    }));
  const evidenceFollowUps = coverage.answered
    .filter(
      (item) =>
        EVIDENCE_GROUPS.has(item.group) &&
        item.provenance !== "DOCUMENT_SUPPORTED",
    )
    .map((item) => item.label);
  const parts = [
    `${String(have.length)} answered`,
    `${String(needed.length)} still needed`,
  ];
  if (coverage.contradictions.length > 0)
    parts.push(`${String(coverage.contradictions.length)} to clarify`);
  return {
    have,
    needed,
    notKnown: coverage.unknown.map((item) => item.label),
    declined: coverage.declined.map((item) => item.label),
    conflicts: [...coverage.contradictions],
    evidenceFollowUps,
    status: `Saved: ${parts.join(", ")}.`,
  };
}
