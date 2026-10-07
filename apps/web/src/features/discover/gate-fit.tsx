import Link from "next/link";

import type { InvestorGateFitDto } from "@capital-q/contracts";

import { GateStandingBadge } from "@/features/assumptions/standing-badge";

import { gateSummary } from "./gate-words";

/**
 * Q.05 on a founder's investor card: the investor's published gate, each
 * criterion by the investor's own label with met / not met / not known
 * yet against the founder's own company, and one sentence. Only what the
 * gate publishes; never a mandate, never a score. The founder checks and
 * applies on the gate's own page.
 */
export function GateFit({
  gate,
  apply = true,
}: {
  readonly gate: InvestorGateFitDto;
  /** False inside a card that is itself a link (no nested links). */
  readonly apply?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" data-gate-fit={gate.publicId}>
      <span className="cq-label inline-flex w-fit items-center gap-1.5 rounded-full border border-(--cq-accent) px-2 py-0.5 text-(--cq-accent)">
        Has a gate · {gate.criteria.length}{" "}
        {gate.criteria.length === 1 ? "criterion" : "criteria"}
      </span>
      {gate.criteria.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5" aria-label="Their published criteria">
          {gate.criteria.map((criterion) => (
            <li
              key={criterion.label}
              className="flex flex-wrap items-center gap-2"
            >
              <GateStandingBadge standing={criterion.standing} />
              <span className="cq-body-sm text-(--cq-text-primary)">
                {criterion.label}
              </span>
              <span className="cq-caption text-(--cq-text-tertiary)">
                {criterion.requiredness === "REQUIRED" ? "Required" : "Preferred"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {gateSummary(gate)}
      </p>
      {apply && gate.acceptingApplications ? (
        <Link
          href={`/g/${encodeURIComponent(gate.publicId)}`}
          className="cq-body-sm inline-flex min-h-11 w-fit items-center font-medium text-(--cq-accent) underline-offset-4 hover:underline"
        >
          Check and apply
        </Link>
      ) : null}
    </div>
  );
}
