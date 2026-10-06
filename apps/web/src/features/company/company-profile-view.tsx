import Link from "next/link";
import type { ReactNode } from "react";

import type {
  CompanyDeckView,
  CompanyProfileDto,
  DataRoomView,
  CompanyProfileTeamMember,
  InterestDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  ICON_SIZE,
  ShieldCheck,
} from "@capital-q/ui/icons";

import { formatLongDay } from "@/components/date-format";

import { ExpressInterest } from "../network/express-interest";

import { EntityAvatar, EntityCover } from "../entity/entity-avatar";

import { CompanyAvatar } from "./company-avatar";
import { CompanyDeeperView } from "./company-deeper-view";
import {
  CompanyVideos,
  DeckDownload,
  ProfilePass,
} from "./company-profile-parts";
import { countryLabel, stageLabel } from "./declared-labels";
import { moneyText } from "./money-text";
import { ReadMore } from "./read-more";
import { InvestorDataRoom, OwnerDataRoom } from "./material/data-room";
import { DeckCoach, DeckForReaders } from "./material/deck";
import { FitPanelSlot } from "./material/fit-panel-slot";
import { TeamTab } from "./material/team";

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

export type ProfileTab = "overview" | "elevator" | "dataroom" | "deck" | "team";

/** `?tab=` as the URL says it; "videos" is the old name of Elevator. */
export function profileTabOf(requested: string | undefined): ProfileTab | null {
  switch (requested) {
    case "overview":
    case "elevator":
    case "dataroom":
    case "deck":
    case "team":
      return requested;
    case "videos":
      return "elevator";
    default:
      return null;
  }
}

/** What the company shared with this reader in diligence, by title. */
export type DiligenceShared = {
  readonly href: string;
  readonly titles: readonly string[];
};

const RELATIONSHIP_LABELS: Readonly<
  Record<CompanyProfileTeamMember["relationshipType"], string>
> = {
  team_member: "Team",
  advisor: "Advisor",
  board_member: "Board",
  contractor: "Contractor",
  other: "Other",
};

/** "Founder · CEO", "Advisor": declared words, never a badge. */
export function teamRoleLine(member: CompanyProfileTeamMember): string {
  return [
    member.isFounder ? "Founder" : RELATIONSHIP_LABELS[member.relationshipType],
    member.businessTitle,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/**
 * The team, as an investor who can find the company sees it (ADR 0041):
 * names, declared roles and short bios, as a plain list.
 */
function TeamList({
  team,
}: {
  readonly team: readonly CompanyProfileTeamMember[];
}) {
  if (team.length === 0) return null;
  return (
    <section
      className="flex max-w-(--cq-layout-narrow) flex-col gap-2"
      aria-labelledby="company-team"
      data-profile-team
    >
      <h2 id="company-team" className="cq-title-sm text-(--cq-text-primary)">
        Team
      </h2>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
        {team.map((member, index) => (
          <li
            key={`${member.name}-${String(index)}`}
            className="flex items-start gap-3 py-3"
          >
            {/* A person's photo is theirs alone today: initials here. */}
            <EntityAvatar kind="person" name={member.name} decorative />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="cq-body font-medium text-(--cq-text-primary)">
                {member.name}
              </p>
              <p className="cq-caption text-(--cq-text-secondary)">
                {teamRoleLine(member)}
              </p>
              {member.shortBio === null ? null : (
                <p className="cq-body-sm text-(--cq-text-primary)">
                  {member.shortBio}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export { moneyText };

/** A hairline definition list: words, never badges. */
function ProfileRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, React.ReactNode])[];
}) {
  return (
    <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
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
  );
}

/** In diligence, "not shared" is a next step, not a dead end. */
function NotSharedYet({ href }: { readonly href: string }) {
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-2">
      <span>Not shared with you yet</span>
      <Link href={href} className="cq-body-sm underline underline-offset-4">
        Ask in diligence
      </Link>
    </span>
  );
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
  relationshipState = null,
  diligence = null,
  dataRoom = null,
  deck = null,
  previewAsInvestor = false,
}: {
  readonly profile: CompanyProfileDto;
  readonly tab: ProfileTab;
  readonly interest: InterestDto | null;
  readonly connected: boolean;
  readonly relationshipState?: RelationshipStateV2 | null;
  readonly sectorLabels: readonly string[];
  /**
   * Present only while this reader's relationship is in diligence: what
   * the diligence area (its own authorisation) says the company shared.
   */
  readonly diligence?: DiligenceShared | null;
  /** The Data room tab's read (the API decides the reader); null: not available. */
  readonly dataRoom?: DataRoomView | null;
  /** The Pitch deck tab's read; null: not available. */
  readonly deck?: CompanyDeckView | null;
  /** The owner looking at their own deck as investors see it. */
  readonly previewAsInvestor?: boolean;
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

  const visibleDocuments =
    dataRoom === null ? null : dataRoom.documents.length;
  const tabs: readonly (readonly [ProfileTab, string, number | null])[] =
    overview === null
      ? [["elevator", "Elevator", profile.videos.length]]
      : [
          ["overview", "Overview", null],
          ["elevator", "Elevator", profile.videos.length],
          ["dataroom", "Data room", visibleDocuments],
          ["deck", "Pitch deck", null],
          ["team", "Team", overview.team.length === 0 ? null : overview.team.length],
        ];

  return (
    <article
      className="grid grid-cols-1 gap-6 [grid-template-areas:'head'_'fit'_'tabs'_'body'] lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-10 lg:[grid-template-areas:'head_fit'_'tabs_fit'_'body_fit']"
      aria-labelledby="company-name"
      data-company-profile={profile.viewer}
    >
      <div className="flex min-w-0 flex-col gap-6 [grid-area:head]">
      {typeof profile.coverUrl === "string" ? (
        // Only a cover the card's own scope shows this reader.
        <EntityCover src={profile.coverUrl} className="rounded-xl" />
      ) : null}
      <header className="flex items-start gap-4">
        <CompanyAvatar
          companyId={profile.companyId}
          photoUrl={profile.photoUrl}
          size={72}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            id="company-name"
            className="cq-title-lg text-(--cq-text-primary)"
          >
            {profile.canonicalName}
          </h1>
          {profile.shortDescription === null ? null : (
            <p className="cq-body line-clamp-3 text-(--cq-text-primary) sm:line-clamp-none">
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
        <div className="flex flex-wrap items-start gap-3" data-profile-actions>
          <ExpressInterest
            companyId={profile.companyId}
            companyName={profile.canonicalName}
            surface="COMPANY_PROFILE"
            initialInterest={interest}
            relationshipState={relationshipState}
          />
          <ProfilePass
            companyId={profile.companyId}
            companyName={profile.canonicalName}
          />
          <Link
            href={`/relationships/company/${encodeURIComponent(profile.companyId)}`}
            className="cq-body-sm inline-flex min-h-11 items-center gap-1 text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          >
            Your relationship
            <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      </div>

      {investor ? (
        <div className="[grid-area:fit] lg:sticky lg:top-6">
          <FitPanelSlot companyId={profile.companyId} companyName={profile.canonicalName} />
        </div>
      ) : null}

      <nav
        aria-label={`${profile.canonicalName} profile`}
        className="flex gap-5 overflow-x-auto border-b border-(--cq-border-subtle) [grid-area:tabs] sm:gap-6"
      >
        {tabs.map(([value, label, count]) => (
          <Link
            key={value}
            href={value === "overview" ? base : `${base}?tab=${value}`}
            aria-current={tab === value ? "page" : undefined}
            className={`${tabClass(tab === value)} shrink-0`}
            data-profile-tab={value}
          >
            {label}
            {count === null ? null : (
              <span className="cq-caption ml-1.5 text-(--cq-text-tertiary)">{count}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 [grid-area:body]">
      {tab === "elevator" || overview === null ? (
        <section className="flex flex-col gap-4" aria-label="Elevator" data-profile-elevator>
          {profile.videos.length === 0 ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {profile.videos.length === 1 ? "1 video" : `${String(profile.videos.length)} videos`} and pitches from the founders.
            </p>
          )}
          <CompanyVideos company={company} videos={profile.videos} />
        </section>
      ) : tab === "dataroom" ? (
        dataRoom === null ? (
          <p className="cq-body py-6 text-(--cq-text-secondary)">The data room isn&rsquo;t available to you.</p>
        ) : dataRoom.viewer === "OWNER" ? (
          <OwnerDataRoom companyId={profile.companyId} view={dataRoom} />
        ) : (
          <InvestorDataRoom companyId={profile.companyId} companyName={profile.canonicalName} view={dataRoom} />
        )
      ) : tab === "deck" ? (
        deck === null ? (
          <p className="cq-body py-6 text-(--cq-text-secondary)">The deck isn&rsquo;t available to you.</p>
        ) : deck.viewer === "OWNER" && deck.coaching !== null && !previewAsInvestor ? (
          <DeckCoach companyId={profile.companyId} view={deck} coaching={deck.coaching} />
        ) : (
          <DeckForReaders companyId={profile.companyId} companyName={profile.canonicalName} view={deck} />
        )
      ) : tab === "team" ? (
        <TeamTab
          companyId={profile.companyId}
          team={overview.team}
          fromDeck={deck?.extraction?.sections.find((section) => section.section === "TEAM")?.facts ?? []}
        />
      ) : (
        <div className="flex flex-col gap-8" data-profile-overview>
          {/*
            Key facts first: declared values only, one hairline strip -- not
            a metric-card grid, no score. Unknown stays a word, never a zero.
          */}
          <dl
            className="flex flex-wrap gap-x-8 gap-y-3 border-y border-(--cq-border-subtle) py-4"
            data-profile-key-facts
          >
            {(
              [
                [
                  "Stage",
                  stageLabel(profile.currentStageCode) ?? "Not declared",
                ],
                [
                  "Raising",
                  overview.raise !== null
                    ? moneyText(overview.raise)
                    : diligence === null
                      ? "Not shared"
                      : "Not shared yet",
                ],
                [
                  "Founded",
                  // A declared ISO date; the strip shows its year only.
                  /^\d{4}/.exec(overview.foundedDate ?? "")?.[0] ??
                    "Not declared",
                ],
                ["Where", place === "" ? "Not declared" : place],
                ...(overview.team.length === 0
                  ? []
                  : ([
                      ["Team", `${String(overview.team.length)} named`],
                    ] as const)),
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex min-w-0 flex-col gap-0.5">
                <dt className="cq-caption text-(--cq-text-secondary)">
                  {term}
                </dt>
                <dd className="cq-title-sm cq-numeric text-(--cq-text-primary)">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {overview.primaryDescription === null ? null : (
            <section
              className="flex flex-col gap-2"
              aria-labelledby="company-words"
            >
              <h2
                id="company-words"
                className="cq-title-sm text-(--cq-text-primary)"
              >
                In their words
              </h2>
              <ReadMore text={overview.primaryDescription} />
            </section>
          )}

          <TeamList team={overview.team} />

          <section
            className="flex max-w-(--cq-layout-narrow) flex-col gap-1"
            aria-labelledby="company-raise"
          >
            <h2
              id="company-raise"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              The raise
            </h2>
            <ProfileRows
              rows={[
                // The raise is founder-private until shared with this
                // reader; "not shared" never says whether one exists.
                [
                  "Raising",
                  overview.raise !== null ? (
                    moneyText(overview.raise)
                  ) : diligence === null ? (
                    "Not shared with you"
                  ) : (
                    <NotSharedYet href={diligence.href} />
                  ),
                ],
                // A deck is named only where it was shared with them.
                ...(investor && overview.deck === null
                  ? ([
                      [
                        "Pitch deck",
                        diligence === null ? (
                          "Not shared with you"
                        ) : (
                          <NotSharedYet href={diligence.href} />
                        ),
                      ],
                    ] as const)
                  : overview.deck === null
                    ? []
                    : ([["Pitch deck", overview.deck.title]] as const)),
                ...(diligence !== null && diligence.titles.length > 0
                  ? ([
                      [
                        "Shared in diligence",
                        <Link
                          key="shared"
                          href={diligence.href}
                          className="underline underline-offset-4"
                        >
                          {diligence.titles.join(", ")}
                        </Link>,
                      ],
                    ] as const)
                  : []),
              ]}
            />
            {/* The deck is downloaded where it is named (design-48 v2: the
                decision row keeps Interest and Pass only). */}
            {!investor || overview.deck === null ? null : (
              <div className="pt-2">
                <DeckDownload
                  companyId={profile.companyId}
                  title={overview.deck.title}
                  scanned={overview.deck.scanned}
                />
              </div>
            )}
          </section>

          <PhoneFold id="company-details" title="Company details">
            <ProfileRows
              rows={[
                [
                  "Sector",
                  sectorLabels.length === 0
                    ? "Not declared"
                    : sectorLabels.join(", "),
                ],
                [
                  "Founded",
                  overview.foundedDate === null
                    ? "Not declared"
                    : formatLongDay(overview.foundedDate),
                ],
                ["Legal name", overview.legalName ?? "Not declared"],
                [
                  "Verification",
                  overview.organisationVerified
                    ? "Organisation verified by Capital Q"
                    : "Not verified by Capital Q yet",
                ],
                ...(overview.websiteUrl === null
                  ? []
                  : ([
                      [
                        "Website",
                        <span
                          key="web"
                          className="flex items-center gap-1.5 break-all"
                        >
                          <Globe size={ICON_SIZE.compact} aria-hidden="true" />
                          {overview.websiteUrl}
                        </span>,
                      ],
                    ] as const)),
              ]}
            />
          </PhoneFold>

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
      </div>
    </article>
  );
}

/**
 * A section folded behind its heading on a phone and open on a large
 * screen (design-48 v2), through ::details-content; folded, one tap away,
 * where that is unsupported.
 */
function PhoneFold({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <details
      className="group flex max-w-(--cq-layout-narrow) flex-col border-t border-(--cq-border-subtle) lg:border-t-0 lg:[&::details-content]:[content-visibility:visible]"
      data-phone-fold={id}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 lg:pointer-events-none lg:min-h-0 [&::-webkit-details-marker]:hidden">
        <h2 id={id} className="cq-title-sm text-(--cq-text-primary)">
          {title}
        </h2>
        <ChevronDown
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="text-(--cq-text-tertiary) transition-transform group-open:rotate-180 lg:hidden"
        />
      </summary>
      <div className="flex flex-col gap-1 pt-1">{children}</div>
    </details>
  );
}
