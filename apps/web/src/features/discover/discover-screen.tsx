import Link from "next/link";

import { closestMatches } from "@/features/q-pitch/founder/matches";
import "@/features/q-pitch/founder/founder-tour.css";
import { countryLabel } from "@/features/company/declared-labels";
import {
  InvestorDirectory,
  type DirectoryEntry,
} from "@/features/investors/investor-directory";
import {
  deploymentLabel,
  investorTypeLabel,
} from "@/features/investors/investor-labels";
import {
  dimensionMatches,
  focusLine,
  gateHref,
  looksForSentence,
  publishedMandate,
  reachOf,
} from "@/features/investors/published-focus";

import type {
  DiscoveredCompanyDto,
  DiscoveredInvestorDto,
  DiscoveryNoteDto,
  DiscoveryReasonDto,
  InvestorGateFitDto,
  PublicCardDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { Building2, Globe, ICON_SIZE, Info } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

/**
 * Discover (doc 19 §44-§45; doc 17 §71).
 *
 * A list, not a feed: every entry says why it is here, in the person's own
 * declared vocabulary, and nothing says how strongly. There is no score on
 * this screen and no badge claiming a match quality, because the ranking
 * is a deterministic sum of declared signals and presenting it as a number
 * would be presenting arithmetic as judgement.
 *
 * What is absent is deliberate: no "hot", no "trending", no view count, no
 * recency-of-activity, nothing that rewards volume. Doc 19 forbids ranking
 * by popularity and there is nowhere here to show it.
 */

const REASON_LABELS: Readonly<Record<DiscoveryReasonDto["kind"], string>> = {
  STAGE_IN_RANGE: "Stage",
  SECTOR_MATCH: "Sector",
  GEOGRAPHY_MATCH: "Location",
  BUSINESS_MODEL_MATCH: "Model",
  CUSTOMER_TYPE_MATCH: "Customers",
  DECLARED_DEPLOYING: "Status",
  PROFILE_COMPLETE: "Profile",
};

const NOTE_TEXT: Readonly<Record<DiscoveryNoteDto, string>> = {
  NO_ACTIVE_MANDATE:
    "You have no active mandate yet, so nothing below is matched to you. Finish your mandate and Q will match on what you told it.",
  MANDATE_HAS_NO_PREFERENCES:
    "Your mandate does not name a stage, sector or geography yet. Adding them is what turns this list into a shortlist.",
  NO_DISCOVERABLE_COUNTERPARTS:
    "Nobody has made themselves discoverable yet. This fills as people choose to be found.",
  RANKED_ON_DECLARED_PROFILE_ONLY:
    "Based on what investors publish: their public profile and, where they have one, their gate, checked against your company. Their private mandates never shape this list, and Q never guesses them.",
  RECOMMENDATIONS_REFRESHING:
    "Your recommendations are being prepared. Check back in a moment.",
  SLATE_RESTARTED:
    "Your recommendations were refreshed while you were browsing, so this list starts again from the top.",
  NONE_PASS_HARD_RULES:
    "Companies are discoverable, but your hard rules exclude every one of them.",
  NONE_MATCH_MANDATE:
    "Companies are discoverable, but none matches your mandate yet.",
  NONE_WITH_PLAYABLE_PITCH:
    "Companies pass your hard rules, but none has a pitch video yet. Search and Explore still show them.",
  NONE_MATCH_FILTERS: "No companies match these filters.",
};

function Reasons({
  reasons,
  t = (english: string) => english,
}: {
  readonly reasons: readonly DiscoveryReasonDto[];
  /** The reader's language (a server component: handed in, not a hook). */
  readonly t?: ((english: string) => string) | undefined;
}) {
  if (reasons.length === 0) {
    return (
      <p className="cq-caption text-(--cq-text-tertiary)">
        {t("Nothing in common with your company yet.")}
      </p>
    );
  }
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1">
      {reasons.map((reason) => (
        <div key={`${reason.kind}-${reason.detail}`} className="flex gap-1.5">
          <dt className="cq-caption text-(--cq-text-tertiary)">
            {t(REASON_LABELS[reason.kind])}
          </dt>
          <dd className="cq-caption text-(--cq-text-secondary)">
            {t(reason.detail)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Notes({
  notes,
  t = (english: string) => english,
}: {
  readonly notes: readonly DiscoveryNoteDto[];
  /** The reader's language (a server component: handed in, not a hook). */
  readonly t?: ((english: string) => string) | undefined;
}) {
  if (notes.length === 0) return null;
  // How the list was built, said once and quietly: it is context, not news.
  return (
    <div className="flex flex-col gap-1" aria-label="How this list was built">
      {notes.map((note) => (
        <p
          key={note}
          className="cq-caption flex items-start gap-1.5 text-(--cq-text-tertiary)"
        >
          <Info
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          {t(NOTE_TEXT[note])}
        </p>
      ))}
    </div>
  );
}

export function DiscoverCompanies({
  items,
  notes,
  translate,
}: {
  /** The reader's language, from the page. */
  readonly translate?: ((english: string) => string) | undefined;
  readonly items: readonly DiscoveredCompanyDto[];
  readonly notes: readonly DiscoveryNoteDto[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Notes notes={notes} t={translate} />
      {items.length === 0 ? (
        <EmptyState
          title="No companies are discoverable yet."
          description="A company appears here when its founder chooses to be found. Q can tell you about any of them once they do."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Ask Q
            </Link>
          }
        />
      ) : (
        <ul className="cq-discover-list flex flex-col">
          {items.map((item) => (
            <li key={item.companyId} className="flex flex-col gap-2 py-5">
              <div className="flex items-center gap-2">
                <Building2 size={ICON_SIZE.regular} aria-hidden="true" />
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  {item.canonicalName}
                </h3>
              </div>
              {item.shortDescription === null ? null : (
                <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
                  {item.shortDescription}
                </p>
              )}
              <Reasons reasons={item.reasons} />
              {item.websiteUrl === null ? null : (
                <p className="flex items-center gap-1.5">
                  <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                  <span className="cq-caption break-all text-(--cq-text-tertiary)">
                    {item.websiteUrl}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DiscoverInvestors({
  items,
  notes,
  gates = new Map(),
  cards = new Map(),
  translate,
}: {
  /** The reader's language, from the page. */
  readonly translate?: ((english: string) => string) | undefined;
  readonly items: readonly DiscoveredInvestorDto[];
  readonly notes: readonly DiscoveryNoteDto[];
  /** Q.05: published gates checked for the founder's own company. */
  readonly gates?: ReadonlyMap<string, InvestorGateFitDto>;
  /** Each investor's Q Card as a participant reads it (what they publish). */
  readonly cards?: ReadonlyMap<string, PublicCardDto | null>;
}) {
  const entries = directoryEntries(items, gates, cards);
  return (
    <div className="flex flex-col gap-4" data-qp-anchor="fdr.03.discover.list">
      <p className="cq-body text-(--cq-text-secondary)">
        {(translate ?? ((english: string) => english))(
          "Investors who chose to be discoverable. Open one to see what they look for and how to reach them.",
        )}
      </p>
      <Notes notes={notes} t={translate} />
      <InvestorDirectory entries={entries} />
    </div>
  );
}

/**
 * The directory's cards from what each investor publishes, in the
 * server's order. Exported so the design review (/dev/discovery-review)
 * builds its cards exactly as Discover does.
 */
export function directoryEntries(
  items: readonly DiscoveredInvestorDto[],
  gates: ReadonlyMap<string, InvestorGateFitDto>,
  cards: ReadonlyMap<string, PublicCardDto | null>,
): DirectoryEntry[] {
  // Q Pitch v6 (founder track): the three closest matches on what each
  // investor publishes, marked so the tour can light them in turn.
  const matches = closestMatches(
    items.map((item) => item.investorOrganisationId),
    gates,
  );
  // ADR 0023: each card opens a sheet with what they look for and the one
  // way to reach them. Order is the server's; nothing here ranks.
  return items.map((item) => {
    const gate = gates.get(item.investorOrganisationId) ?? null;
    const mandate = publishedMandate(
      cards.get(item.investorOrganisationId) ?? null,
    );
    const where =
      mandate.geographies.length > 0
        ? mandate.geographies.join(", ")
        : countryLabel(item.hqCountry);
    return {
      investorOrganisationId: item.investorOrganisationId,
      name: item.displayName,
      photoUrl: item.photoUrl ?? null,
      type: investorTypeLabel(item.investorType),
      deployment: deploymentLabel(item.deploymentState),
      focus: focusLine(mandate),
      looksFor: looksForSentence(mandate),
      cheque: mandate.cheque,
      matches: dimensionMatches(gate, item.reasons, item.publishedFit),
      reach: reachOf(item.inboundPreference, gate),
      gateHref: gateHref(gate),
      where,
      anchor: matches.get(item.investorOrganisationId),
    };
  });
}
