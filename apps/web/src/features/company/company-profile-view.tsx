import Link from "next/link";

import type { CompanyProfileDto, InterestDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ChevronRight,
  Globe,
  ICON_SIZE,
  ShieldCheck,
} from "@capital-q/ui/icons";

import { formatLongDay } from "@/components/date-format";

import { ExpressInterest } from "../network/express-interest";

import { CompanyAvatar } from "./company-avatar";
import { CompanyDeeperView } from "./company-deeper-view";
import {
  CompanyVideos,
  DeckDownload,
  ProfilePass,
} from "./company-profile-parts";
import { countryLabel, stageLabel } from "./declared-labels";

/**
 * A company's profile (founder request 2026-10-02): an identity header,
 * the decisions an investor can take, and two tabs, Overview and Videos.
 *
 * It renders exactly what the server's profile carries for this reader and
 * decides nothing about access. An investor's profile has an overview and
 * gets the decisions; a founder's view of another company has neither
 * (the API sends no overview and refuses the actions anyway), so the page
 * shows its identity and its videos only.
 *
 * Restraint is the design (ADR 0017; doc 18): one column, a definition
 * list rather than cards, words rather than badges, and no score of any
 * kind. "Not declared" and "Not shared with you" are honest answers,
 * never zeros.
 */

export type ProfileTab = "overview" | "videos";

/** "USD 1,500,000" from a decimal string, without ever becoming a float. */
export function moneyText(money: {
  readonly amount: string;
  readonly currency: string;
}): string {
  const [whole = "0", fraction = ""] = money.amount.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = /^0*$/.test(fraction) ? "" : `.${fraction}`;
  return `${money.currency} ${negative ? "-" : ""}${grouped}${cents}`;
}

function tabClass(active: boolean): string {
  return `cq-body-sm inline-flex min-h-11 items-center border-b-2 px-1 ${
    active
      ? "border-(--cq-text-primary) text-(--cq-text-primary)"
      : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
  }`;
}

export function CompanyProfileView({
  profile,
  tab,
  interest,
  connected,
  sectorLabels,
}: {
  readonly profile: CompanyProfileDto;
  readonly tab: ProfileTab;
  readonly interest: InterestDto | null;
  readonly connected: boolean;
  readonly sectorLabels: readonly string[];
}) {
  const { overview } = profile;
  const investor = profile.viewer === "INVESTOR";
  const place = [
    profile.headquartersCity,
    countryLabel(profile.headquartersCountry),
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const line = [stageLabel(profile.currentStageCode), place]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  const base = `/company/${encodeURIComponent(profile.companyId)}`;
  const company = {
    companyId: profile.companyId,
    canonicalName: profile.canonicalName,
    shortDescription: profile.shortDescription,
    currentStageCode: profile.currentStageCode,
    headquartersCountry: profile.headquartersCountry,
  };

  return (
    <article
      className="flex flex-col gap-6"
      aria-labelledby="company-name"
      data-company-profile={profile.viewer}
    >
      <header className="flex items-start gap-4">
        <CompanyAvatar
          companyId={profile.companyId}
          photoUrl={profile.photoUrl}
          size={72}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="company-name" className="cq-title-lg text-(--cq-text-primary)">
            {profile.canonicalName}
          </h1>
          {profile.shortDescription === null ? null : (
            <p className="cq-body text-(--cq-text-primary)">
              {profile.shortDescription}
            </p>
          )}
          {line === "" ? null : (
            <p className="cq-caption text-(--cq-text-secondary)">{line}</p>
          )}
          {overview?.organisationVerified === true ? (
            <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-secondary)">
              <ShieldCheck size={ICON_SIZE.compact} aria-hidden="true" />
              Organisation verified by Capital Q
            </p>
          ) : null}
        </div>
      </header>

      {investor ? (
        /*
          The decisions, apart from each other on purpose: Interest is
          server-confirmed (CQ-NET-010), Pass is optimistic and undoable,
          and Interest ≠ Save ≠ Pass.
        */
        <div
          className="flex flex-wrap items-start gap-3"
          data-profile-actions
        >
          <ExpressInterest
            companyId={profile.companyId}
            companyName={profile.canonicalName}
            surface="COMPANY_PROFILE"
            initialInterest={interest}
          />
          <ProfilePass
            companyId={profile.companyId}
            companyName={profile.canonicalName}
          />
          {overview?.deck == null ? null : (
            <DeckDownload
              companyId={profile.companyId}
              title={overview.deck.title}
            />
          )}
          <Link
            href={`/relationships/company/${encodeURIComponent(profile.companyId)}`}
            className={buttonClassName("quiet")}
          >
            Your relationship
            <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      <nav
        aria-label={`${profile.canonicalName} profile`}
        className="flex gap-6 border-b border-(--cq-border-subtle)"
      >
        {overview === null ? null : (
          <Link
            href={base}
            aria-current={tab === "overview" ? "page" : undefined}
            className={tabClass(tab === "overview")}
            data-profile-tab="overview"
          >
            Overview
          </Link>
        )}
        <Link
          href={`${base}?tab=videos`}
          aria-current={tab === "videos" ? "page" : undefined}
          className={tabClass(tab === "videos")}
          data-profile-tab="videos"
        >
          Videos
          <span className="cq-caption ml-1.5 text-(--cq-text-tertiary)">
            {profile.videos.length}
          </span>
        </Link>
      </nav>

      {tab === "videos" || overview === null ? (
        <CompanyVideos company={company} videos={profile.videos} />
      ) : (
        <div className="flex flex-col gap-6" data-profile-overview>
          {overview.primaryDescription === null ? null : (
            <p className="cq-prose max-w-(--cq-layout-narrow) text-(--cq-text-primary)">
              {overview.primaryDescription}
            </p>
          )}

          <dl className="flex max-w-(--cq-layout-narrow) flex-col divide-y divide-(--cq-border-subtle)">
            {(
              [
                [
                  "Sector",
                  sectorLabels.length === 0
                    ? "Not declared"
                    : sectorLabels.join(", "),
                ],
                [
                  "Stage",
                  stageLabel(profile.currentStageCode) ?? "Not declared",
                ],
                ["Where", place === "" ? "Not declared" : place],
                [
                  "Founded",
                  overview.foundedDate === null
                    ? "Not declared"
                    : formatLongDay(overview.foundedDate),
                ],
                ["Legal name", overview.legalName ?? "Not declared"],
                // The raise is founder-private until shared with this
                // reader; "not shared" never says whether one exists.
                [
                  "Raising",
                  overview.raise === null
                    ? "Not shared with you"
                    : moneyText(overview.raise),
                ],
                [
                  "Verification",
                  overview.organisationVerified
                    ? "Organisation verified by Capital Q"
                    : "Not verified by Capital Q yet",
                ],
                // A deck is named only where it was shared with them.
                ...(investor && overview.deck === null
                  ? ([["Pitch deck", "Not shared with you"]] as const)
                  : []),
              ] as const
            ).map(([term, value]) => (
              <div
                key={term}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
              >
                <dt className="cq-label text-(--cq-text-secondary)">{term}</dt>
                <dd className="cq-body text-(--cq-text-primary)">{value}</dd>
              </div>
            ))}
          </dl>

          {overview.websiteUrl === null ? null : (
            <p className="flex items-center gap-1.5">
              <Globe size={ICON_SIZE.compact} aria-hidden="true" />
              <span className="cq-caption break-all text-(--cq-text-secondary)">
                {overview.websiteUrl}
              </span>
            </p>
          )}

          {/*
            What is known on the three evidence axes, and why it is in the
            reader's feed (CQ-WEB-024): from the same projection as above.
          */}
          <CompanyDeeperView
            companyId={profile.companyId}
            companyName={profile.canonicalName}
            facts={overview.facts}
            connected={connected}
          />
        </div>
      )}
    </article>
  );
}
