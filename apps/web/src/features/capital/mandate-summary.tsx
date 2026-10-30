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
import { serverT } from "@/features/i18n/server";

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
  // Every page (live recheck 2026-10-30: the geography list holds every
  // country, 270 entries; one page of 100 left most of them unnamed).
  const pages = await Promise.all(
    vocabularies.map(async (vocabulary) => {
      const items: { readonly id: string; readonly displayName: string }[] = [];
      let cursor: string | undefined;
      try {
        for (let page = 0; page < 6; page += 1) {
          const result = await listTaxonomyNodes(session, vocabulary, {
            status: "ACTIVE",
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          });
          items.push(...result.items);
          cursor = result.nextCursor;
          if (cursor === undefined) break;
        }
      } catch {
        // What was read is kept; an unread name shows as unnamed.
      }
      return items;
    }),
  );
  return new Map(pages.flat().map((node) => [node.id, node.displayName]));
}

export async function MandateSummary({
  investorOrganisationId,
  given,
}: {
  readonly investorOrganisationId: string;
  /** Design review only (/dev/crm): the mandate and its labels, given. */
  readonly given?:
    | {
        readonly mandate: InvestorMandateDto | null | undefined;
        readonly labels: ReadonlyMap<string, string>;
      }
    | undefined;
}) {
  const t = await serverT();
  const mandate =
    given === undefined
      ? await activeMandate(investorOrganisationId)
      : given.mandate;
  if (mandate === undefined) {
    return (
      <div
        className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
        data-mandate-summary
      >
        <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Your mandate")}
        </h3>
        <p className="text-sm text-(--cq-text-secondary)">
          {t("Your mandate couldn't load. Try again in a moment.")}
        </p>
      </div>
    );
  }
  if (mandate === null) {
    return (
      <div
        className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
        data-mandate-summary
      >
        <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Your mandate")}
        </h3>
        <p className="text-sm text-(--cq-text-secondary)">
          {t(
            "No active mandate yet. Tell Q what you invest in and Discover orders companies against it.",
          )}
        </p>
        <Link
          href="/onboarding/investor"
          className={buttonClassName("primary", "regular", "w-full")}
        >
          {t("Set your mandate")}
        </Link>
      </div>
    );
  }
  const labels = given?.labels ?? (await labelsFor(mandate));
  // F6 (2026-10-08): business models and customer types are business
  // attributes, not sectors.
  const kindOf = (code: string) =>
    code === "geography"
      ? "geography"
      : code === "business_model" || code === "customer_type"
        ? "attribute"
        : "industry";
  const named = (
    vocabulary: "industry" | "geography" | "attribute",
    exclusion: boolean,
  ) =>
    mandate.taxonomyPreferences
      .filter(
        (p) =>
          kindOf(String(p.vocabularyCode)) === vocabulary &&
          p.isExclusion === exclusion,
      )
      .map((p) => labels.get(p.nodeId) ?? readable(p.canonicalCode));
  const sectors = named("industry", false);
  const places = named("geography", false);
  const attributes = named("attribute", false);
  const neverShown = [
    ...named("industry", true),
    ...named("geography", true),
    ...named("attribute", true),
  ];
  const hardRules = mandate.constraints.filter((c) => c.isHardExclusion).length;

  // The design's order (2026-10-20): stage, sectors, geography, cheque.
  const rows: readonly (readonly [string, string])[] = [
    ["Stage", stageLine(mandate)],
    ["Sectors", sectors.length === 0 ? "Not stated" : sectors.join(", ")],
    ["Geography", places.length === 0 ? "Not stated" : places.join(", ")],
    ["Cheque", chequeLine(mandate)],
    [
      "Business models and customers",
      attributes.length === 0 ? "Not stated" : attributes.join(", "),
    ],
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
    [
      "Thesis",
      mandate.rawMandateText === null || mandate.rawMandateText.trim() === ""
        ? "Not stated"
        : mandate.rawMandateText.trim(),
    ],
  ];

  return (
    <div
      className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
      data-mandate-summary
    >
      <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
        {t("Your mandate")}
      </h3>
      {/* Declared only: what the organisation said, never what it did. */}
      <dl className="flex flex-col">
        {rows.map(([term, value]) => (
          <div
            key={term}
            className="flex justify-between gap-3 border-t border-(--cq-border-subtle) py-2.5 text-sm"
          >
            <dt className="text-(--cq-text-secondary)">{t(term)}</dt>
            <dd
              className={`line-clamp-3 text-end font-medium ${value === "Not stated" ? "text-(--cq-text-tertiary)" : "text-(--cq-text-primary)"}`}
            >
              {value === "Not stated" ? t(value) : value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href="/onboarding/investor?review=1"
        className={buttonClassName("secondary", "regular", "w-full")}
      >
        {t("Review my mandate")}
      </Link>
      <Link
        href="/gateq?tab=gate"
        className={buttonClassName("quiet", "compact", "self-start")}
      >
        {t("Your gateway")}
      </Link>
    </div>
  );
}
