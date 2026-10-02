import Link from "next/link";

import type {
  YourCompanyLabel,
  YourCompanyPitchItemDto,
} from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { CompanyPitch } from "./company-pitch";

/**
 * "Your companies" (founder decision 2026-10-02): pitches from companies
 * the investor is connected with, has expressed interest in, or saved. A
 * row beside the recommended feed, never part of it: the feed keeps
 * showing only new companies, the ranking is untouched, nothing is paid
 * for. The label says why a company is here, quietly, in words.
 */

export const YOUR_COMPANY_LABEL_WORDS: Readonly<
  Record<YourCompanyLabel, string>
> = {
  CONNECTED: "Connected",
  INTERESTED: "Interest expressed",
  SAVED: "Saved",
};

/**
 * The row on Discover: names and labels only, no media, so it never takes
 * from the feed's preload budget. Absent when there is nothing to show.
 */
export function YourCompaniesRow({
  items,
  className = "",
}: {
  readonly items: readonly YourCompanyPitchItemDto[];
  readonly className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Your companies"
      className={`flex flex-wrap items-center gap-2 ${className}`}
      data-your-companies-row
    >
      <Link
        href="/discover/yours"
        className="cq-body-sm inline-flex min-h-11 items-center gap-1 font-medium text-(--cq-stage-text)"
      >
        Your companies
        <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
      </Link>
      {items.slice(0, 4).map((item) => (
        <Link
          key={item.companyId}
          href={`/discover/yours#company-${item.companyId}`}
          className="cq-caption inline-flex min-h-11 items-center gap-1.5 rounded-(--cq-radius-sm) border border-(--cq-stage-border) px-2 text-(--cq-stage-text)"
          data-your-company={item.companyId}
        >
          {item.canonicalName}
          <span className="text-(--cq-stage-text-muted)">
            · {YOUR_COMPANY_LABEL_WORDS[item.label]}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The full list, newest pitch first. Each pitch plays through the same
 * signed playback as everywhere else (poster first, nothing fetched until
 * Play).
 */
export function YourCompaniesList({
  items,
}: {
  readonly items: readonly YourCompanyPitchItemDto[];
}) {
  return (
    <ul className="flex flex-col gap-8" data-your-companies-list>
      {items.map((item) => (
        <li
          key={item.companyId}
          id={`company-${item.companyId}`}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link
              href={`/company/${item.companyId}`}
              className="cq-title-sm text-(--cq-text-primary) underline-offset-4 hover:underline"
            >
              {item.canonicalName}
            </Link>
            <span
              className="cq-caption text-(--cq-text-secondary)"
              data-your-company-label={item.label}
            >
              {YOUR_COMPANY_LABEL_WORDS[item.label]}
            </span>
          </div>
          <CompanyPitch company={item} />
        </li>
      ))}
    </ul>
  );
}
