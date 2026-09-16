import Link from "next/link";

import type {
  DiscoveredCompanyDto,
  DiscoveredInvestorDto,
  DiscoveryNoteDto,
  DiscoveryReasonDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { Building2, Globe, ICON_SIZE, Landmark } from "@capital-q/ui/icons";
import { EmptyState, InlineNotice } from "@capital-q/ui/states";

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
  GEOGRAPHY_MATCH: "Where",
  BUSINESS_MODEL_MATCH: "Model",
  CUSTOMER_TYPE_MATCH: "Customers",
  DECLARED_DEPLOYING: "Deploying",
  PROFILE_COMPLETE: "Profile",
};

const NOTE_TEXT: Readonly<Record<DiscoveryNoteDto, string>> = {
  NO_ACTIVE_MANDATE:
    "You have no active mandate yet, so nothing below is matched to you. Finish your mandate and Q will match on what you declared.",
  MANDATE_HAS_NO_PREFERENCES:
    "Your mandate does not name a stage, sector or geography yet. Adding them is what turns this list into a shortlist.",
  NO_DISCOVERABLE_COUNTERPARTS:
    "Nobody has made themselves discoverable yet. This fills as people choose to be found.",
  RANKED_ON_DECLARED_PROFILE_ONLY:
    "Ordered by what each investor has declared publicly. An investor's mandate is theirs and is never read to rank this list.",
};

function Reasons({
  reasons,
}: {
  readonly reasons: readonly DiscoveryReasonDto[];
}) {
  if (reasons.length === 0) {
    return (
      <p className="cq-caption text-(--cq-text-tertiary)">
        Discoverable, with nothing declared in common yet.
      </p>
    );
  }
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1">
      {reasons.map((reason) => (
        <div key={`${reason.kind}-${reason.detail}`} className="flex gap-1.5">
          <dt className="cq-caption text-(--cq-text-tertiary)">
            {REASON_LABELS[reason.kind]}
          </dt>
          <dd className="cq-caption text-(--cq-text-secondary)">
            {reason.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Notes({ notes }: { readonly notes: readonly DiscoveryNoteDto[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {notes.map((note) => (
        <InlineNotice key={note} tone="info" title="How this list was built">
          {NOTE_TEXT[note]}
        </InlineNotice>
      ))}
    </div>
  );
}

export function DiscoverCompanies({
  items,
  notes,
}: {
  readonly items: readonly DiscoveredCompanyDto[];
  readonly notes: readonly DiscoveryNoteDto[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Notes notes={notes} />
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
}: {
  readonly items: readonly DiscoveredInvestorDto[];
  readonly notes: readonly DiscoveryNoteDto[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Notes notes={notes} />
      {items.length === 0 ? (
        <EmptyState
          title="No investors are discoverable yet."
          description="An investor appears here when they choose to be found. Nothing about their mandate is shown, now or later, unless they publish it."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Ask Q
            </Link>
          }
        />
      ) : (
        <ul className="cq-discover-list flex flex-col">
          {items.map((item) => (
            <li
              key={item.investorOrganisationId}
              className="flex flex-col gap-2 py-5"
            >
              <div className="flex items-center gap-2">
                <Landmark size={ICON_SIZE.regular} aria-hidden="true" />
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  {item.displayName}
                </h3>
              </div>
              {item.publicDescription === null ? null : (
                <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
                  {item.publicDescription}
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
