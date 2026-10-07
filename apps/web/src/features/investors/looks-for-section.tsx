import Link from "next/link";

import {
  discoverInvestors,
  getInvestorGates,
  type ApiSession,
} from "@capital-q/api-client";
import type { InvestorGateFitDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { founderFormContext } from "@/features/gateq/form/founder-prefill";

import {
  draftHref,
  gateRows,
  profileRows,
  STANDING_WORDS,
  standingTally,
  type LooksForRow,
  type LooksForStanding,
} from "./looks-for";

/**
 * "What this investor looks for" and "Draft my application" on the
 * investor page (Q.05; design docs/design/2026-10-07/overdeliver,
 * "investor"). Every read is under the founder's own session: Discover's
 * public-profile reasons and the investor's published gate with the
 * founder's standing. Never the private mandate.
 *
 * The draft is prepared from the founder's own profile and goes nowhere
 * from here: "Review and send" opens the investor's GateQ form, prefilled
 * with exactly this, and only the founder pressing Send there submits it
 * (Prepare → Recommend → Human approval → Execute).
 */

const TONE: Readonly<Record<LooksForStanding, string>> = {
  MET: "text-(--cq-positive) bg-(--cq-positive-soft)",
  NOT_MET: "text-(--cq-warning) bg-(--cq-warning-soft)",
  UNKNOWN: "text-(--cq-text-secondary) bg-(--cq-surface-subtle)",
};

export function StandingBadge({
  standing,
}: {
  readonly standing: LooksForStanding;
}) {
  return (
    <span
      className={`cq-label inline-flex shrink-0 items-center gap-1.5 rounded-full py-0.5 ps-2 pe-2.5 whitespace-nowrap ${TONE[standing]}`}
      data-standing={standing}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {standing === "MET" ? (
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        ) : standing === "NOT_MET" ? (
          <rect
            x="2.5"
            y="2.5"
            width="7"
            height="7"
            transform="rotate(45 6 6)"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        ) : (
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeDasharray="2 1.6"
          />
        )}
      </svg>
      {STANDING_WORDS[standing]}
    </span>
  );
}

async function readGate(
  session: ApiSession,
  investorOrganisationId: string,
): Promise<InvestorGateFitDto | null> {
  const gates = await getInvestorGates(session, [investorOrganisationId]).catch(
    () => ({ items: [] }),
  );
  return (
    gates.items.find(
      (gate) =>
        gate.investorOrganisationId.toLowerCase() ===
        investorOrganisationId.toLowerCase(),
    ) ?? null
  );
}

async function readProfileRows(
  session: ApiSession,
  investorOrganisationId: string,
): Promise<LooksForRow[]> {
  const slate = await discoverInvestors(session).catch(() => null);
  const item = slate?.items.find(
    (entry) =>
      entry.investorOrganisationId.toLowerCase() ===
      investorOrganisationId.toLowerCase(),
  );
  return item === undefined ? [] : profileRows(item.reasons);
}

function Rows({ rows }: { readonly rows: readonly LooksForRow[] }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)">
      {rows.map((row) => (
        <li
          key={`${row.label}-${row.words}`}
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-t border-(--cq-border-subtle) px-4 py-3 first:border-t-0"
        >
          <span className="cq-body font-semibold text-(--cq-text-primary)">
            {row.label}
            {row.required ? (
              <span className="cq-body-sm font-normal text-(--cq-text-tertiary)">
                {" "}
                · required
              </span>
            ) : null}
          </span>
          <StandingBadge standing={row.standing} />
          <span className="cq-body-sm col-span-2 text-(--cq-text-secondary)">
            {row.words}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function LooksForSection({
  session,
  investorOrganisationId,
  investorName,
}: {
  readonly session: ApiSession;
  readonly investorOrganisationId: string;
  readonly investorName: string;
}) {
  const [gate, profile, form] = await Promise.all([
    readGate(session, investorOrganisationId),
    readProfileRows(session, investorOrganisationId),
    founderFormContext().catch(() => null),
  ]);
  const criteria = gateRows(gate);
  const href = draftHref(gate);
  const prefill = form?.prefill ?? null;
  return (
    <>
      <section
        id="looks-for"
        aria-labelledby="investor-looks-for"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="investor-looks-for"
            className="cq-title-md text-(--cq-text-primary)"
          >
            What this investor looks for
          </h2>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            From their public profile and their published GateQ criteria only.
          </p>
        </div>
        {criteria.length === 0 && profile.length === 0 ? (
          <p className="cq-body text-(--cq-text-secondary)" data-state="empty">
            {investorName} hasn&apos;t published criteria on Capital Q yet.
            Their profile above is all they share.
          </p>
        ) : (
          <>
            {criteria.length === 0 ? null : (
              <>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {gate?.title ?? "Their gate"}: {standingTally(criteria)}.
                </p>
                <Rows rows={criteria} />
              </>
            )}
            {profile.length === 0 ? null : (
              <>
                <h3 className="cq-title-sm pt-2 text-(--cq-text-primary)">
                  Where their public profile matches you
                </h3>
                <Rows rows={profile} />
              </>
            )}
          </>
        )}
        <p className="cq-body-sm text-(--cq-text-tertiary)">
          This is their published bar, not their private thesis. Meeting it is
          not a promise of interest.
        </p>
      </section>
      {href === null ? null : (
        <section
          aria-labelledby="investor-draft"
          className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="investor-draft"
              className="cq-title-md text-(--cq-text-primary)"
            >
              Draft my application
            </h2>
            <span className="cq-body-sm text-(--cq-text-tertiary)">
              Q prepares · you approve · nothing is sent until you press Send
            </span>
          </div>
          {prefill === null ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Q starts the form from your company profile.
            </p>
          ) : (
            <dl className="cq-body-sm grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
              <dt className="text-(--cq-text-tertiary)">Company</dt>
              <dd className="text-(--cq-text-primary)">
                {prefill.companyName}
              </dd>
              <dt className="text-(--cq-text-tertiary)">One line</dt>
              <dd className="text-(--cq-text-primary)">
                {prefill.oneLiner ?? "Not on your profile yet"}
              </dd>
              <dt className="text-(--cq-text-tertiary)">Stage</dt>
              <dd className="text-(--cq-text-primary)">
                {stageLabel(prefill.stageCode) ?? "Not on your profile yet"}
              </dd>
              <dt className="text-(--cq-text-tertiary)">Country</dt>
              <dd className="text-(--cq-text-primary)">
                {countryLabel(prefill.country) ?? "Not on your profile yet"}
              </dd>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={href} className={buttonClassName("primary")}>
              Review and send
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
