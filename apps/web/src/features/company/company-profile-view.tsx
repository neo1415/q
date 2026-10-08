import Link from "next/link";
import { Suspense, use, type ReactNode } from "react";

import type {
  CompanyDeckView,
  CompanyProfileDto,
  DataRoomView,
  CompanyProfileTeamMember,
  InterestDto,
  PitchClaimDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import {
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
import { compactMoneyText, moneyText } from "./money-text";
import {
  elevatorHref,
  Fold,
  OwnerPitchNotice,
  PitchClaimList,
  PitchQuote,
  pitchMoment,
  pitchRaiseText,
  ProfileRows,
} from "./overview-sections";
import { ReadMore } from "./read-more";
import { InvestorDataRoom, OwnerDataRoom } from "./material/data-room";
import { DeckCoach, DeckForReaders } from "./material/deck";
import {
  FitPanelSlot,
  FitStripCell,
  ProfileFitProvider,
} from "./material/fit-panel-slot";
import { TeamTab } from "./material/team";
import type { ProfileTab } from "./profile-tab";
import {
  ProfilePanelSkeleton,
  ProfileTabLink,
  ProfileTabPanel,
} from "./profile-tabs";

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

export { profileTabOf, type ProfileTab } from "./profile-tab";

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
  // "Founder · Co-founder & CEO" said it twice: the title wins when it
  // already names the founder.
  const titled =
    member.businessTitle !== null && /founder/i.test(member.businessTitle);
  return [
    titled
      ? null
      : member.isFounder
        ? "Founder"
        : RELATIONSHIP_LABELS[member.relationshipType],
    member.businessTitle,
    // F9: named by public sources on a company nobody has joined yet;
    // a claim, never a verified fact (ADR-001 truth class USER_CLAIM).
    member.source === "PUBLIC_SOURCE"
      ? "From public sources, unconfirmed"
      : null,
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

// Plain strings: the tab link is a client component, and a function prop
// cannot cross from the server.
const TAB_CLASS =
  "cq-body-sm inline-flex min-h-11 shrink-0 items-center border-b-2 px-1";
const TAB_ACTIVE = "border-(--cq-text-primary) text-(--cq-text-primary)";
const TAB_IDLE =
  "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)";

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
  overviewExtra = null,
  overviewExtraSummary,
  overviewStreamed = null,
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
  /**
   * The Pitch deck tab's read; null: not available. A promise streams into
   * the Pitch deck and Team panels behind their own skeleton, so the page
   * and its other tabs never wait for it.
   */
  readonly deck?: Eventually<CompanyDeckView | null>;
  /** The owner looking at their own deck as investors see it. */
  readonly previewAsInvestor?: boolean;
  /** Rendered in the overview after the key facts (Q.07 assumptions). */
  readonly overviewExtra?: ReactNode;
  /** The one line its fold says while closed. */
  readonly overviewExtraSummary?: string | undefined;
  /**
   * Rendered in the same place, as given: a read the page streams in
   * (its own fold, behind its own placeholder).
   */
  readonly overviewStreamed?: ReactNode;
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

  // What the pitches this reader may play say (the server decided which).
  const claims = overview?.pitchClaims ?? [];
  const claimsOf = (kind: PitchClaimDto["kind"]) =>
    claims.filter((claim) => claim.kind === kind);
  const sayRaise = overview?.raiseFromPitch ?? claimsOf("RAISE")[0] ?? null;
  const traction = claimsOf("TRACTION");
  const raiseSummary = [
    overview?.raise
      ? compactMoneyText(overview.raise)
      : overview?.raiseFromPitch
        ? `${pitchRaiseText(overview.raiseFromPitch)}, said in their pitch`
        : "Not shared with you",
    investor
      ? overview?.deck
        ? "deck shared with you"
        : "deck not shared yet"
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const firstMember = overview?.team[0];
  const teamSummary =
    firstMember === undefined
      ? "No one named yet"
      : [
          `${String(overview?.team.length ?? 0)} named`,
          [firstMember.name, firstMember.businessTitle]
            .filter((part) => part !== null && part !== "")
            .join(", "),
          firstMember.source === "PUBLIC_SOURCE" ? "from public sources" : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  const foundedYear = /^\d{4}/.exec(overview?.foundedDate ?? "")?.[0] ?? null;
  const unknowns =
    overview === null
      ? []
      : [
          profile.currentStageCode === null ? "stage" : null,
          overview.raise === null && overview.raiseFromPitch === null
            ? "the raise"
            : null,
          traction.length === 0 ? "traction" : null,
          sectorLabels.length === 0 ? "sector" : null,
          overview.team.length === 0 ? "team" : null,
          overview.foundedDate === null ? "founded date" : null,
          overview.legalName === null ? "legal name" : null,
        ].filter((item) => item !== null);

  const visibleDocuments = dataRoom === null ? null : dataRoom.documents.length;
  const tabs: readonly (readonly [ProfileTab, string, number | null])[] =
    overview === null
      ? [["elevator", "Elevator", profile.videos.length]]
      : [
          ["overview", "Overview", null],
          ["elevator", "Elevator", profile.videos.length],
          ["dataroom", "Data room", visibleDocuments],
          ["deck", "Pitch deck", null],
          [
            "team",
            "Team",
            overview.team.length === 0 ? null : overview.team.length,
          ],
        ];

  const page = (
    <article
      className={
        investor
          ? "grid grid-cols-1 gap-6 [grid-template-areas:'head'_'fit'_'tabs'_'body'] lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-10 lg:[grid-template-areas:'head_fit'_'tabs_fit'_'body_fit']"
          : "grid grid-cols-1 gap-6 [grid-template-areas:'head'_'tabs'_'body']"
      }
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
          <div
            className="flex flex-wrap items-start gap-3"
            data-profile-actions
          >
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
          <FitPanelSlot
            companyId={profile.companyId}
            companyName={profile.canonicalName}
          />
        </div>
      ) : null}

      <nav
        aria-label={`${profile.canonicalName} profile`}
        className="flex gap-5 overflow-x-auto border-b border-(--cq-border-subtle) [grid-area:tabs] sm:gap-6"
      >
        {tabs.map(([value, label, count]) => (
          <ProfileTabLink
            key={value}
            tab={value}
            fallbackHref={value === "overview" ? base : `${base}?tab=${value}`}
            current={tab === value}
            className={TAB_CLASS}
            activeClassName={TAB_ACTIVE}
            idleClassName={TAB_IDLE}
            data-profile-tab={value}
          >
            {label}
            {count === null ? null : (
              <span className="cq-caption ml-1.5 text-(--cq-text-tertiary)">
                {count}
              </span>
            )}
          </ProfileTabLink>
        ))}
      </nav>
      <div className="min-w-0 [grid-area:body]">
        <ProfileTabPanel tab="elevator" serverTab={tab}>
          <section
            className="flex flex-col gap-4"
            aria-label="Elevator"
            data-profile-elevator
          >
            {profile.videos.length === 0 ? null : (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {profile.videos.length === 1
                  ? "1 video"
                  : `${String(profile.videos.length)} videos`}{" "}
                and pitches from the founders.
              </p>
            )}
            <CompanyVideos company={company} videos={profile.videos} />
          </section>
        </ProfileTabPanel>
        {overview === null ? null : (
          <>
            <ProfileTabPanel tab="overview" serverTab={tab}>
              <div className="flex flex-col" data-profile-overview>
                {/* The owner is told when their pitch and their raise disagree. */}
                {overview.pitchRaiseNotice === null ? null : (
                  <div className="pb-6">
                    <OwnerPitchNotice notice={overview.pitchRaiseNotice} />
                  </div>
                )}

                {/*
                The summary strip: four facts in words, one hairline -- not a
                metric-card grid, no score. The raise names where it came from.
              */}
                <dl
                  className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-(--cq-border-subtle) pb-5 sm:grid-cols-4"
                  data-profile-key-facts
                >
                  <StripCell term="Stage">
                    {stageLabel(profile.currentStageCode) ?? "Not declared"}
                  </StripCell>
                  <StripCell term="Raising">
                    {overview.raise !== null ? (
                      compactMoneyText(overview.raise)
                    ) : overview.raiseFromPitch !== null ? (
                      <>
                        {pitchRaiseText(overview.raiseFromPitch)}
                        <ProfileTabLink
                          tab="elevator"
                          fallbackHref={elevatorHref(profile.companyId)}
                          className="cq-caption block font-normal text-(--cq-text-secondary) underline underline-offset-4"
                          data-raise-source="PITCH_VIDEO"
                        >
                          Said in their pitch,{" "}
                          {pitchMoment(overview.raiseFromPitch.atSeconds)}
                        </ProfileTabLink>
                      </>
                    ) : diligence === null ? (
                      "Not shared"
                    ) : (
                      "Not shared yet"
                    )}
                  </StripCell>
                  <StripCell term="Location">
                    {profile.headquartersCity ??
                      countryLabel(profile.headquartersCountry) ??
                      "Not declared"}
                  </StripCell>
                  {investor ? <FitStripCell /> : null}
                </dl>

                {overviewExtra === null ||
                overviewExtra === undefined ? null : (
                  <Fold
                    id="company-assumptions"
                    title="Assumptions to test"
                    summary={
                      overviewExtraSummary ?? "What to ask before a call"
                    }
                  >
                    {overviewExtra}
                  </Fold>
                )}

                {overviewStreamed}

                <Fold
                  id="company-raise"
                  title="The raise"
                  summary={raiseSummary}
                >
                  {sayRaise === null ? null : (
                    <PitchQuote
                      claim={sayRaise}
                      companyId={profile.companyId}
                    />
                  )}
                  <ProfileRows
                    rows={[
                      // The raise is founder-private until shared with this
                      // reader; "not shared" never says whether one exists.
                      [
                        overview.raise === null && sayRaise !== null
                          ? "Raise on Capital Q"
                          : "Raising",
                        overview.raise !== null ? (
                          moneyText(overview.raise)
                        ) : diligence === null ? (
                          "Not shared with you"
                        ) : (
                          <NotSharedYet href={diligence.href} />
                        ),
                      ],
                      ...claimsOf("INSTRUMENT")
                        .slice(0, 1)
                        .map(
                          (claim) =>
                            [
                              "Instrument",
                              `${claim.instrument ?? claim.statement} (said at ${pitchMoment(claim.atSeconds)})`,
                            ] as const,
                        ),
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
                  {claimsOf("USE_OF_FUNDS").map((claim) => (
                    <PitchQuote
                      key={`${claim.pitchId}-${String(claim.atSeconds)}`}
                      claim={claim}
                      companyId={profile.companyId}
                    />
                  ))}
                  {/* The deck is downloaded where it is named (design-48 v2). */}
                  {!investor || overview.deck === null ? null : (
                    <div className="pt-1">
                      <DeckDownload
                        companyId={profile.companyId}
                        title={overview.deck.title}
                        scanned={overview.deck.scanned}
                      />
                    </div>
                  )}
                </Fold>

                <Fold
                  id="company-traction"
                  title="Traction"
                  summary={
                    traction.length === 0
                      ? "Nothing stated in their pitch yet"
                      : `${String(traction.length)} ${traction.length === 1 ? "figure" : "figures"}, said in their pitch`
                  }
                >
                  {traction.length === 0 ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      No traction figure is stated in the pitch videos you can
                      watch. That is not known yet, not zero.
                    </p>
                  ) : (
                    <>
                      <PitchClaimList claims={traction} />
                      <p className="cq-caption text-(--cq-text-secondary)">
                        The company&rsquo;s own claims, from its pitch video.
                        Not verified.
                      </p>
                    </>
                  )}
                </Fold>

                <Fold id="company-team" title="Team" summary={teamSummary}>
                  {overview.team.length === 0 ? (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      No one is named for you yet.
                    </p>
                  ) : (
                    <TeamList team={overview.team} />
                  )}
                </Fold>

                <Fold
                  id="company-market"
                  title="Market"
                  summary={
                    sectorLabels.length === 0
                      ? "Sector not declared"
                      : sectorLabels.join(", ")
                  }
                >
                  <ProfileRows
                    rows={[
                      [
                        "Sector",
                        sectorLabels.length === 0
                          ? "Not declared"
                          : sectorLabels.join(", "),
                      ],
                    ]}
                  />
                  {overview.primaryDescription === null ? null : (
                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="company-words"
                    >
                      <h3
                        id="company-words"
                        className="cq-label text-(--cq-text-secondary)"
                      >
                        In their words
                      </h3>
                      <ReadMore text={overview.primaryDescription} />
                    </section>
                  )}
                </Fold>

                <Fold
                  id="company-unknowns"
                  title="Risks and unknowns"
                  summary={
                    unknowns.length === 0
                      ? "Every key fact is declared; see what rests on what"
                      : `Not known yet: ${unknowns.slice(0, 3).join(", ")}${unknowns.length > 3 ? ` and ${String(unknowns.length - 3)} more` : ""}`
                  }
                >
                  {unknowns.length === 0 ? null : (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      Not known yet: {unknowns.join(", ")}. Unknown is not
                      negative; it is a question to ask.
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
                </Fold>

                <Fold
                  id="company-details"
                  title="Company details"
                  summary={[
                    foundedYear === null
                      ? "Founded date not declared"
                      : `Founded ${foundedYear}`,
                    overview.organisationVerified
                      ? "Verified by Capital Q"
                      : "Not verified by Capital Q yet",
                  ].join(" · ")}
                >
                  <ProfileRows
                    rows={[
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
                                <Globe
                                  size={ICON_SIZE.compact}
                                  aria-hidden="true"
                                />
                                {overview.websiteUrl}
                              </span>,
                            ],
                          ] as const)),
                    ]}
                  />
                </Fold>
              </div>
            </ProfileTabPanel>
            <ProfileTabPanel tab="dataroom" serverTab={tab}>
              {dataRoom === null ? (
                <p className="cq-body py-6 text-(--cq-text-secondary)">
                  The data room isn&rsquo;t available to you.
                </p>
              ) : dataRoom.viewer === "OWNER" ? (
                <OwnerDataRoom companyId={profile.companyId} view={dataRoom} />
              ) : (
                <InvestorDataRoom
                  companyId={profile.companyId}
                  companyName={profile.canonicalName}
                  view={dataRoom}
                />
              )}
            </ProfileTabPanel>
            <ProfileTabPanel tab="deck" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <DeckPanel
                  deck={deck}
                  companyId={profile.companyId}
                  companyName={profile.canonicalName}
                  previewAsInvestor={previewAsInvestor}
                />
              </Suspense>
            </ProfileTabPanel>
            <ProfileTabPanel tab="team" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <TeamPanel
                  deck={deck}
                  companyId={profile.companyId}
                  team={overview.team}
                />
              </Suspense>
            </ProfileTabPanel>
          </>
        )}
      </div>
    </article>
  );
  // One fit read per profile, shown in the strip and the panel (investors).
  return investor ? (
    <ProfileFitProvider companyId={profile.companyId}>
      {page}
    </ProfileFitProvider>
  ) : (
    page
  );
}

type Eventually<T> = T | Promise<T>;

function useSettled<T>(value: Eventually<T>): T {
  return value instanceof Promise ? use(value) : value;
}

function DeckPanel({
  deck: eventually,
  companyId,
  companyName,
  previewAsInvestor,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly companyId: string;
  readonly companyName: string;
  readonly previewAsInvestor: boolean;
}) {
  const deck = useSettled(eventually);
  if (deck === null) {
    return (
      <p className="cq-body py-6 text-(--cq-text-secondary)">
        The deck isn&rsquo;t available to you.
      </p>
    );
  }
  return deck.viewer === "OWNER" &&
    deck.coaching !== null &&
    !previewAsInvestor ? (
    <DeckCoach companyId={companyId} view={deck} coaching={deck.coaching} />
  ) : (
    <DeckForReaders
      companyId={companyId}
      companyName={companyName}
      view={deck}
    />
  );
}

function TeamPanel({
  deck: eventually,
  companyId,
  team,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly companyId: string;
  readonly team: readonly CompanyProfileTeamMember[];
}) {
  const deck = useSettled(eventually);
  return (
    <TeamTab
      companyId={companyId}
      team={team}
      fromDeck={
        deck?.extraction?.sections.find((section) => section.section === "TEAM")
          ?.facts ?? []
      }
    />
  );
}

/** One fact of the summary strip: a caption and a word, never a badge. */
function StripCell({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="cq-caption text-(--cq-text-secondary)">{term}</dt>
      <dd className="cq-title-sm cq-numeric text-(--cq-text-primary)">
        {children}
      </dd>
    </div>
  );
}
