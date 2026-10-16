import Link from "next/link";

import type { InvestorGateFitDto } from "@capital-q/contracts";

import { GateStandingBadge } from "@/features/assumptions/standing-badge";

import { gateSummary } from "./gate-words";
import { Words } from "@/features/i18n/language";

/**
 * Q.05 on a founder's investor card: the investor's published gate, each
 * criterion by the investor's own label with met / not met / not known
 * yet against the founder's own company, and one sentence. Only what the
 * gate publishes; never a mandate, never a score. The founder checks and
 * applies on the gate's own page.
 */
/** Criteria a card lists before "more on their page". */
const CARD_ROWS = 3;

export function GateFit({
  gate,
  apply = true,
  compact = false,
}: {
  readonly gate: InvestorGateFitDto;
  /** False inside a card that is itself a link (no nested links). */
  readonly apply?: boolean;
  /**
   * On a card: what is met is counted, and only what is not met or not
   * known yet is listed (live check 2026-10-16: six rows per card made the
   * grid's rows tall and left the cards without a gate mostly empty). The
   * investor's page lists every criterion.
   */
  readonly compact?: boolean;
}) {
  const met = gate.criteria.filter((c) => c.standing === "MET").length;
  const listed = compact
    ? gate.criteria.filter((c) => c.standing !== "MET")
    : gate.criteria;
  const shown = compact ? listed.slice(0, CARD_ROWS) : listed;
  return (
    <div className="flex flex-col gap-2" data-gate-fit={gate.publicId}>
      <span className="cq-label inline-flex w-fit items-center gap-1.5 border border-(--cq-accent) px-2 py-0.5 text-(--cq-accent)">
        <Words>
          {gate.criteria.length === 0
            ? "Has a gate · no published criteria yet"
            : `Has a gate · ${String(gate.criteria.length)} ${gate.criteria.length === 1 ? "criterion" : "criteria"}`}
        </Words>
      </span>
      {compact && met > 0 ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          <Words>
            {`${
              met === gate.criteria.length
                ? `All ${String(met)} met`
                : `${String(met)} of ${String(gate.criteria.length)} met`
            }${listed.length === 0 ? "." : "; the rest:"}`}
          </Words>
        </p>
      ) : null}
      {shown.length === 0 ? null : (
        <ul
          className="flex flex-col gap-1.5"
          aria-label={
            compact
              ? "Their criteria not met or not known yet"
              : "Their published criteria"
          }
        >
          {shown.map((criterion) => (
            // Standing, then the criterion with its weight under it: a
            // narrow card no longer wraps "Required" onto a line of its own
            // between rows (redesign 2026-10-16).
            <li
              key={criterion.label}
              className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-2 [&>:first-child]:justify-self-start"
            >
              <GateStandingBadge standing={criterion.standing} />
              <span className="flex min-w-0 flex-col">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  <Words>{criterion.label}</Words>
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  <Words>
                    {criterion.requiredness === "REQUIRED"
                      ? "Required"
                      : "Preferred"}
                  </Words>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {listed.length > shown.length ? (
        <p className="cq-caption text-(--cq-text-tertiary)">
          <Words>{`${String(listed.length - shown.length)} more on their page`}</Words>
        </p>
      ) : null}
      <p className="cq-body-sm text-(--cq-text-secondary)">
        <Words>{gateSummary(gate)}</Words>
      </p>
      {apply && gate.acceptingApplications ? (
        <Link
          href={`/g/${encodeURIComponent(gate.publicId)}`}
          className="cq-body-sm inline-flex min-h-11 w-fit items-center font-medium text-(--cq-accent) underline-offset-4 hover:underline"
        >
          <Words>Check and apply</Words>
        </Link>
      ) : null}
    </div>
  );
}
