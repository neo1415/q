import Link from "next/link";

import type { DiscoveredInvestorDto } from "@capital-q/contracts";
import { ICON_SIZE, MapPin } from "@capital-q/ui/icons";

import { countryLabel } from "../company/declared-labels";
import { inboundLabel, initials, investorTypeLabel } from "./investor-labels";

/**
 * Investors a founder may look at (ADR 0023), as cards: cover, photo,
 * name, type, where they are, what they said publicly, and how they take
 * requests, in words. Each opens the investor's page. Order is the
 * server's; nothing here ranks, scores or counts.
 */
export function InvestorCards({
  items,
}: {
  readonly items: readonly DiscoveredInvestorDto[];
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      data-investor-cards
    >
      {items.map((item) => (
        <li key={item.investorOrganisationId}>
          <InvestorCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function InvestorCard({ item }: { readonly item: DiscoveredInvestorDto }) {
  const where = countryLabel(item.hqCountry);
  const photo = item.photoUrl ?? null;
  const cover = item.coverUrl ?? null;
  return (
    <Link
      href={`/investors/${item.investorOrganisationId}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) transition-colors duration-(--cq-motion-base) hover:border-(--cq-border-strong) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      data-investor-card={item.investorOrganisationId}
    >
      <div className="relative aspect-[4/1] w-full bg-(--cq-surface-strong)">
        {cover === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL fetched by the browser directly
          <img
            src={cover}
            alt=""
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
        <div className="relative -mt-7 size-14 overflow-hidden rounded-xl border-2 border-(--cq-surface) bg-(--cq-surface-subtle)">
          {photo === null ? (
            <span
              aria-hidden="true"
              className="cq-title-sm flex size-full items-center justify-center text-(--cq-text-secondary)"
            >
              {initials(item.displayName)}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
            <img
              src={photo}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="cq-title-sm text-(--cq-text-primary) group-hover:underline group-hover:underline-offset-4">
            {item.displayName}
          </h3>
          <p className="cq-caption flex flex-wrap items-center gap-x-1.5 text-(--cq-text-tertiary)">
            <span>{investorTypeLabel(item.investorType)}</span>
            {where === null ? null : (
              <span className="inline-flex items-center gap-1">
                <MapPin size={ICON_SIZE.compact} aria-hidden="true" />
                {where}
              </span>
            )}
          </p>
        </div>
        {item.publicDescription === null ? null : (
          <p className="cq-body-sm line-clamp-3 text-(--cq-text-secondary)">
            {item.publicDescription}
          </p>
        )}
        <p className="cq-caption mt-auto pt-1 text-(--cq-text-secondary)">
          {inboundLabel(item.inboundPreference)}
        </p>
      </div>
    </Link>
  );
}
