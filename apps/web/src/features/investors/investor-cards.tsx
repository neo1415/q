import Link from "next/link";
import type { ReactNode } from "react";

import type { DiscoveredInvestorDto } from "@capital-q/contracts";
import { ICON_SIZE, MapPin } from "@capital-q/ui/icons";

import { countryLabel } from "../company/declared-labels";
import { EntityAvatar } from "../entity/entity-avatar";

import { AskQAboutFit } from "./ask-q-about-fit";
import { inboundLabel, investorTypeLabel } from "./investor-labels";

/**
 * Investors a founder may look at (ADR 0023), as cards: cover (only when
 * they set one -- an empty grey band read as unfinished), photo, name,
 * type, where they are, what they said publicly, and how they take
 * requests, in words. Each opens the investor's page, and Q can be asked
 * about fit. Order is the server's; nothing here ranks, scores or counts.
 */
export function InvestorCards({
  items,
  footer,
}: {
  readonly items: readonly DiscoveredInvestorDto[];
  /** Under each card's text: Discover's "why shown" reasons. */
  readonly footer?: ((item: DiscoveredInvestorDto) => ReactNode) | undefined;
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      data-investor-cards
    >
      {items.map((item) => (
        <li key={item.investorOrganisationId}>
          <InvestorCard item={item} footer={footer?.(item)} />
        </li>
      ))}
    </ul>
  );
}

function InvestorCard({
  item,
  footer,
}: {
  readonly item: DiscoveredInvestorDto;
  readonly footer?: ReactNode;
}) {
  const where = countryLabel(item.hqCountry);
  const photo = item.photoUrl ?? null;
  const cover = item.coverUrl ?? null;
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) transition-colors duration-(--cq-motion-base) hover:border-(--cq-border-strong)"
      data-investor-card={item.investorOrganisationId}
    >
      <Link
        href={`/investors/${item.investorOrganisationId}`}
        className="group flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      >
        {cover === null ? null : (
          <div className="relative aspect-[4/1] w-full bg-(--cq-surface-strong)">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL fetched by the browser directly */}
            <img
              src={cover}
              alt=""
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}
        <div
          className={`flex flex-1 flex-col gap-2 px-4 pb-2 ${cover === null ? "pt-4" : ""}`}
        >
          <div
            className={`w-fit rounded-lg bg-(--cq-surface) p-0.5 ${cover === null ? "" : "-mt-7"}`}
          >
            <EntityAvatar
              kind="investor"
              name={item.displayName}
              src={photo}
              size="lg"
              decorative
            />
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
          {footer}
          {inboundLabel(item.inboundPreference) === null ? null : (
            <span className="cq-caption mt-auto self-start rounded-full border border-(--cq-border-subtle) px-2.5 py-0.5 text-(--cq-text-secondary)">
              {inboundLabel(item.inboundPreference)}
            </span>
          )}
        </div>
      </Link>
      <div className="px-2 pb-2">
        <AskQAboutFit name={item.displayName} />
      </div>
    </div>
  );
}
