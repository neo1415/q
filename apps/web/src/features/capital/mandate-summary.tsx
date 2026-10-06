import Link from "next/link";

import {
  getInvestorMandate,
  listInvestorMandates,
  listTaxonomyNodes,
} from "@capital-q/api-client";
import type { InvestorMandateDto } from "@capital-q/contracts";
import { STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { apiSession } from "@/features/q/context";

/**
 * The investor's side of Capital (demo audit 2026-10-03): the page was
 * headed "Your raise" and showed no mandate at all. Now it is "Your
 * mandate", in a few declared lines: stage, cheque, sectors, geography and
 * what is never shown. Declared only -- nothing inferred from browsing
 * (doc 19), unknown said as "Not stated", never as zero.
 */

const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);

/** "enterprise_software" → "Enterprise software", when no label loads. */
function readable(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stageLine(mandate: InvestorMandateDto): string {
  const name = (code: string | null) =>
    code === null ? null : (STAGE_LABELS.get(code) ?? readable(code));
  const min = name(mandate.minStageCode);
  const max = name(mandate.maxStageCode);
  if (min === null && max === null) return "Not stated";
  if (min === null || max === null || min === max) return min ?? max ?? "";
  return `${min} to ${max}`;
}

export function chequeLine(mandate: InvestorMandateDto): string {
  const range = mandate.chequeRange;
  if (range === null) return "Not stated";
  const money = (amount: string | undefined) =>
    amount === undefined ? null : formatAmountForDisplay(amount);
  const min = money(range.min);
  const max = money(range.max);
  const typical = money(range.typical);
  const span =
    min !== null && max !== null
      ? `${min} to ${max}`
      : (min ?? max ?? typical ?? null);
  if (span === null) return "Not stated";
  return `${range.currency} ${span}${
    typical !== null && span !== typical ? `, typically ${typical}` : ""
  }`;
}

async function activeMandate(
  investorOrganisationId: string,
): Promise<InvestorMandateDto | null | undefined> {
  const session = await apiSession();
  if (session === null) return undefined;
  try {
    const page = await listInvestorMandates(session, investorOrganisationId, {
      status: "ACTIVE",
      limit: 1,
    });
    const first = page.items[0];
    if (first === undefined) return null;
    return await getInvestorMandate(session, investorOrganisationId, first.id);
  } catch {
    return undefined;
  }
}

async function labelsFor(
  mandate: InvestorMandateDto,
): Promise<ReadonlyMap<string, string>> {
  const session = await apiSession();
  if (session === null) return new Map();
  const vocabularies = [
    ...new Set(mandate.taxonomyPreferences.map((p) => p.vocabularyCode)),
  ];
  const pages = await Promise.all(
    vocabularies.map((vocabulary) =>
      listTaxonomyNodes(session, vocabulary, { status: "ACTIVE", limit: 100 })
        .then((page) => page.items)
        .catch(() => []),
    ),
  );
  return new Map(pages.flat().map((node) => [node.id, node.displayName]));
}

export async function MandateSummary({
  investorOrganisationId,
}: {
  readonly investorOrganisationId: string;
}) {
  const mandate = await activeMandate(investorOrganisationId);
  if (mandate === undefined) {
    return (
      <p className="cq-body text-(--cq-text-secondary)">
        Your mandate couldn&apos;t load. Try again in a moment.
      </p>
    );
  }
  if (mandate === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="cq-body text-(--cq-text-secondary)">
          No active mandate yet. Tell Q what you invest in and Discover orders
          companies against it.
        </p>
        <Link
          href="/onboarding/investor"
          className={buttonClassName("primary")}
        >
          Set your mandate
        </Link>
      </div>
    );
  }
  const labels = await labelsFor(mandate);
  const named = (vocabulary: "industry" | "geography", exclusion: boolean) =>
    mandate.taxonomyPreferences
      .filter(
        (p) =>
          (vocabulary === "industry"
            ? p.vocabularyCode !== "geography"
            : p.vocabularyCode === "geography") && p.isExclusion === exclusion,
      )
      .map((p) => labels.get(p.nodeId) ?? readable(p.canonicalCode));
  const sectors = named("industry", false);
  const places = named("geography", false);
  const neverShown = [...named("industry", true), ...named("geography", true)];
  const hardRules = mandate.constraints.filter((c) => c.isHardExclusion).length;

  const rows: readonly (readonly [string, string])[] = [
    ["Stage", stageLine(mandate)],
    ["Cheque", chequeLine(mandate)],
    ["Sectors", sectors.length === 0 ? "Not stated" : sectors.join(", ")],
    ["Geography", places.length === 0 ? "Not stated" : places.join(", ")],
    [
      "Never shown",
      neverShown.length === 0 && hardRules === 0
        ? "No exclusions set"
        : [
            ...neverShown,
            ...(hardRules === 0
              ? []
              : [
                  `${String(hardRules)} declared rule${hardRules === 1 ? "" : "s"}`,
                ]),
          ].join(", "),
    ],
  ];

  return (
    <div className="flex flex-col gap-4" data-mandate-summary>
      <dl className="flex max-w-(--cq-layout-narrow) flex-col divide-y divide-(--cq-border-subtle)">
        {rows.map(([term, value]) => (
          <div
            key={term}
            className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
          >
            <dt className="cq-label text-(--cq-text-secondary)">{term}</dt>
            <dd className="cq-body text-right text-(--cq-text-primary)">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/onboarding/investor?review=1"
          className={buttonClassName("primary")}
        >
          Review my mandate
        </Link>
        {/* One primary; the rest are quiet ways out, not equal choices. */}
        <Link href="/discover/saved" className={buttonClassName("quiet")}>
          Saved companies
        </Link>
        <Link href="/gateway" className={buttonClassName("quiet")}>
          Your gateway
        </Link>
      </div>
    </div>
  );
}
