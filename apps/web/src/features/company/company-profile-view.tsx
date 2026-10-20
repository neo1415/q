import Link from "next/link";
import { Suspense, use, type ReactNode } from "react";

import type {
  AssumptionBoardDto,
  CompanyDeckView,
  CompanyProfileDto,
  CompanyProfileTeamMember,
  DataRoomView,
  FitCompanyDto,
  FounderPersonDto,
  InterestDto,
  MeetingDto,
  PitchClaimKind,
  QViewDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import { deckAskTerms } from "@capital-q/contracts";

import type { QuestionsRoute } from "@/features/assumptions/assumptions-section";
import { capitalTabHref } from "@/features/capital/capital-tabs";

import { EntityCover } from "../entity/entity-avatar";

import { BriefProvider } from "./brief/brief-context";
import { DeckBrief } from "./brief/deck-tab";
import { DiligenceBrief } from "./brief/diligence";
import { diligenceLedger } from "./brief/diligence-model";
import { ElevatorBrief } from "./brief/elevator";
import { BriefHeader } from "./brief/header";
import { keyNumbers } from "./brief/model";
import { nextCallOf, NextStepRibbon } from "./brief/next-step";
import { OverviewBrief } from "./brief/overview";
import { BriefTabBar } from "./brief/tab-bar";
import { CompanyDeeperView } from "./company-deeper-view";
import { DeckDownload } from "./company-profile-parts";
import { compactMoneyText, moneyText } from "./money-text";
import { OwnerPitchNotice } from "./overview-sections";
import { raiseWords } from "./raise-words";
import { ReadMore } from "./read-more";
import { InvestorDataRoom, OwnerDataRoom } from "./material/data-room";
import { DeckCoach } from "./material/deck";
import { ProfileFitProvider } from "./material/fit-panel-slot";
import { TeamTab } from "./material/team";
import {
  pitchProfileSections,
  type PitchProfileSection,
} from "./pitch-profile";
import type { ProfileTab } from "./profile-tab";
import { ProfilePanelSkeleton, ProfileTabPanel } from "./profile-tabs";

/**
 * A company's profile as the decision brief, on every tab (profile option
 * 1, owner 2026-10-20; prototype proto2 profile.js + ptabs.js): the
 * company's header, the tabs with a sliding underline, one next step with
 * its reason (the bottom dock on a phone), then each tab as a reading and
 * a rail.
 *
 * It renders exactly what the server's profile carries for this reader and
 * decides nothing about access. An investor gets the overview, the next
 * step, the scores and the fit; a founder viewing another company gets its
 * identity and its videos only (the API sends no overview and refuses the
 * actions anyway); the owner reads their own company with their own gaps
 * to fill and none of the investor-only parts. "Not shared with you" and
 * "not known yet" are honest answers, never zeros.
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

export { moneyText };

type Eventually<T> = T | Promise<T>;

function useSettled<T>(value: Eventually<T>): T {
  return value instanceof Promise ? use(value) : value;
}

/**
 * The owner's own profile with no raise declared (founder 2026-10-08): for
 * the owner a missing raise is a step: add it in Capital, Raise & rounds.
 */
function AddYourRaise() {
  return (
    <Link
      href={capitalTabHref("raise")}
      className="cq-body-sm underline underline-offset-4"
      data-owner-raise="ADD"
    >
      Add your raise
    </Link>
  );
}

const PITCH_TOPICS: readonly (readonly [PitchClaimKind, string])[] = [
  ["RAISE", "The raise"],
  ["INSTRUMENT", "Instrument"],
  ["TRACTION", "Traction"],
  ["USE_OF_FUNDS", "Use of funds"],
];

export function CompanyProfileView({
  translate: t = (english: string) => english,
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
  overviewStreamed = null,
  scores = null,
  assumptions = null,
  questionsRoute = { kind: "NOT_CONNECTED" },
  meetings = null,
  met = false,
  founders = [],
  fit,
  qView,
}: {
  /** The reader's language (a server component: handed in, not a hook). */
  readonly translate?: ((english: string) => string) | undefined;
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
   * the panels that need it behind their own skeleton, so the page and its
   * other tabs never wait for it.
   */
  readonly deck?: Eventually<CompanyDeckView | null>;
  /** The owner looking at their own deck as investors see it. */
  readonly previewAsInvestor?: boolean;
  /** Older callers: rendered in Diligence before the ledger. */
  readonly overviewExtra?: ReactNode;
  readonly overviewExtraSummary?: string | undefined;
  readonly overviewStreamed?: ReactNode;
  /**
   * Lane iq's scores, placed at the top of the Overview's rail instead of
   * the brief's own scores card. This view computes no score. Null: the
   * brief's card, from the profile's fit read.
   */
  readonly scores?: ReactNode;
  /** Q.07's questions board for this investor (the API's); null: none. */
  readonly assumptions?: AssumptionBoardDto | null;
  /** Where the investor's questions go (diligence, chat, or not yet). */
  readonly questionsRoute?: QuestionsRoute;
  /** The reader's own meetings on this relationship; null: none read. */
  readonly meetings?: readonly MeetingDto[] | null;
  /** A call already took place on the relationship (its milestone). */
  readonly met?: boolean;
  /** The founders' own pages by position, where this reader may open them. */
  readonly founders?: Eventually<readonly (FounderPersonDto | null)[]>;
  /** Design review: a fit and a Q view in hand, so nothing is read. */
  readonly fit?: FitCompanyDto | null | undefined;
  readonly qView?: QViewDto | null | undefined;
}) {
  const { overview } = profile;
  // A verification that rests only on the synthetic-demo attestation is
  // not a real one: shown as not verified, never gold and never a demo
  // label (owner 2026-10-19).
  const demoOnly = overview?.organisationDemoAttested === true;
  const verified = overview?.organisationVerified === true && !demoOnly;
  const investor = profile.viewer === "INVESTOR";
  // The owner (and their team) reading their own company: nothing here is
  // "shared with you" -- it is theirs. Previewing as an investor keeps the
  // investor's words on purpose.
  const own = profile.viewer === "OWNER" && !previewAsInvestor;
  const base = `/company/${encodeURIComponent(profile.companyId)}`;
  const company = {
    companyId: profile.companyId,
    canonicalName: profile.canonicalName,
    shortDescription: profile.shortDescription,
    currentStageCode: profile.currentStageCode,
    headquartersCountry: profile.headquartersCountry,
  };
  const founder = overview?.team.find((member) => member.isFounder);

  const visibleDocuments = dataRoom === null ? null : dataRoom.documents.length;
  const tabs: readonly (readonly [ProfileTab, string, number | null])[] =
    overview === null
      ? [["elevator", t("Elevator"), profile.videos.length]]
      : [
          ["overview", t("Overview"), null],
          ["diligence", t("Diligence"), null],
          [
            "elevator",
            t("Elevator"),
            profile.videos.length === 0 ? null : profile.videos.length,
          ],
          ["dataroom", t("Data room"), visibleDocuments],
          ["deck", t("Pitch deck"), null],
          [
            "team",
            t("Team"),
            overview.team.length === 0 ? null : overview.team.length,
          ],
        ];
  const notSaid = [
    ...PITCH_TOPICS.filter(
      ([kind]) => !(overview?.pitchClaims ?? []).some((c) => c.kind === kind),
    ).map(([, words]) => words),
    ...(assumptions?.assumptions ?? [])
      .filter((a) => a.standing === "UNKNOWN")
      .map((a) => a.label),
  ].filter((words, index, all) => all.indexOf(words) === index);

  const page = (
    <article
      className="cq-brief"
      aria-labelledby="company-name"
      data-company-profile={profile.viewer}
    >
      {typeof profile.coverUrl === "string" ? (
        // Only a cover the card's own scope shows this reader.
        <div className="pb-4">
          <EntityCover src={profile.coverUrl} />
        </div>
      ) : null}
      <BriefHeader
        profile={profile}
        own={own}
        investor={investor}
        relationshipState={relationshipState}
        verified={verified}
        deck={overview === null ? null : deck}
      />
      <BriefTabBar
        label={`${profile.canonicalName} profile`}
        base={base}
        tabs={tabs}
        serverTab={tab}
      />
      {investor && overview !== null ? (
        <NextStepRibbon
          companyId={profile.companyId}
          companyName={profile.canonicalName}
          state={relationshipState}
          connected={connected}
          met={met}
          dataRoom={dataRoom}
          nextCall={nextCallOf(meetings)}
          interest={interest}
          serverTab={tab}
        />
      ) : null}
      <div className="min-w-0">
        <ProfileTabPanel tab="elevator" serverTab={tab}>
          <Suspense
            fallback={
              <ElevatorBrief
                company={company}
                videos={profile.videos}
                claims={overview?.pitchClaims ?? []}
                sections={overview?.pitchSections ?? []}
                deckRaise={null}
                notSaid={overview === null ? [] : notSaid}
              />
            }
          >
            <ElevatorPanel
              deck={overview === null ? null : deck}
              company={company}
              profile={profile}
              notSaid={overview === null ? [] : notSaid}
            />
          </Suspense>
        </ProfileTabPanel>
        {overview === null ? null : (
          <>
            <ProfileTabPanel tab="overview" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <OverviewPanel
                  deck={deck}
                  profile={profile}
                  own={own}
                  investor={investor}
                  sectorLabels={sectorLabels}
                  scores={scores}
                />
              </Suspense>
            </ProfileTabPanel>
            <ProfileTabPanel tab="diligence" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <DiligencePanel
                  deck={deck}
                  profile={profile}
                  own={own}
                  investor={investor}
                  sectorLabels={sectorLabels}
                  board={assumptions}
                  dataRoom={dataRoom}
                  meetings={meetings}
                  diligence={diligence}
                  verified={verified}
                  connected={connected}
                  legacy={
                    overviewExtra === null &&
                    overviewStreamed === null ? null : (
                      <>
                        {overviewExtra}
                        {overviewStreamed}
                      </>
                    )
                  }
                />
              </Suspense>
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
                  interest={interest}
                  relationshipState={relationshipState}
                />
              )}
            </ProfileTabPanel>
            <ProfileTabPanel tab="deck" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <DeckPanel
                  deck={deck}
                  profile={profile}
                  own={own}
                  investor={investor}
                  sectorLabels={sectorLabels}
                  previewAsInvestor={previewAsInvestor}
                />
              </Suspense>
            </ProfileTabPanel>
            <ProfileTabPanel tab="team" serverTab={tab}>
              <Suspense fallback={<ProfilePanelSkeleton />}>
                <TeamPanel
                  deck={deck}
                  companyId={profile.companyId}
                  companyName={profile.canonicalName}
                  team={overview.team}
                  founders={founders}
                  investor={investor}
                />
              </Suspense>
            </ProfileTabPanel>
          </>
        )}
      </div>
    </article>
  );
  // One fit read and one brief per profile, for an investor only.
  return investor ? (
    <ProfileFitProvider companyId={profile.companyId} initial={fit}>
      <BriefProvider
        companyId={profile.companyId}
        companyName={profile.canonicalName}
        who={founder?.name ?? profile.canonicalName}
        route={questionsRoute}
        board={assumptions}
        qView={qView}
      >
        {page}
      </BriefProvider>
    </ProfileFitProvider>
  ) : (
    page
  );
}

/** Where a founder's "tell Q" goes: Q's onboarding, at that section. */
export function tellQHref(section: { readonly key: string }): string {
  return `/onboarding/founder?talk=1&section=${encodeURIComponent(section.key)}`;
}

function sectionsFor(
  profile: CompanyProfileDto,
  deck: CompanyDeckView | null,
  own: boolean,
  sectorLabels: readonly string[],
): readonly PitchProfileSection[] {
  const overview = profile.overview;
  return pitchProfileSections({
    companyName: profile.canonicalName,
    own,
    deckSections: deck?.extraction?.sections ?? null,
    pitchClaims: overview?.pitchClaims ?? [],
    pitchSections: overview?.pitchSections ?? [],
    answers: {
      shortDescription: profile.shortDescription,
      sectorLabels,
      team: overview?.team ?? [],
      raise: overview?.raise ?? null,
    },
    tellQHref,
  });
}

/**
 * The slot at the top of the Overview's rail where lane iq places its
 * scores. A named wrapper so the layout (and tests) find one place.
 */
export function CompanyProfileScoresSlot({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-profile-scores>
      {children}
    </div>
  );
}

function OverviewPanel({
  deck: eventually,
  profile,
  own,
  investor,
  sectorLabels,
  scores,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly investor: boolean;
  readonly sectorLabels: readonly string[];
  readonly scores: ReactNode;
}) {
  const deck = useSettled(eventually);
  const overview = profile.overview;
  const pitchRaise =
    overview?.raise !== null && overview?.raise !== undefined
      ? compactMoneyText(overview.raise)
      : overview?.raiseFromPitch?.money !== null &&
          overview?.raiseFromPitch?.money !== undefined
        ? compactMoneyText(overview.raiseFromPitch.money)
        : null;
  return (
    <OverviewBrief
      companyId={profile.companyId}
      companyName={profile.canonicalName}
      sections={sectionsFor(profile, deck, own, sectorLabels)}
      numbers={keyNumbers({
        deck: deck?.extraction?.sections ?? null,
        raise: pitchRaise,
        raiseWords:
          overview?.raiseView === undefined
            ? null
            : raiseWords(overview.raiseView, own),
      })}
      own={own}
      investor={investor}
      scoresSlot={
        scores === null || scores === undefined ? null : (
          <CompanyProfileScoresSlot>{scores}</CompanyProfileScoresSlot>
        )
      }
    />
  );
}

function DiligencePanel({
  deck: eventually,
  profile,
  own,
  investor,
  sectorLabels,
  board,
  dataRoom,
  meetings,
  diligence,
  verified,
  connected,
  legacy,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly investor: boolean;
  readonly sectorLabels: readonly string[];
  readonly board: AssumptionBoardDto | null;
  readonly dataRoom: DataRoomView | null;
  readonly meetings: readonly MeetingDto[] | null;
  readonly diligence: DiligenceShared | null;
  readonly verified: boolean;
  readonly connected: boolean;
  readonly legacy: ReactNode;
}) {
  const deck = useSettled(eventually);
  const overview = profile.overview;
  if (overview === null) return null;
  const sections = sectionsFor(profile, deck, own, sectorLabels);
  const folds = diligenceLedger({
    profile,
    own,
    sectorLabels,
    deck: deck?.extraction?.sections ?? null,
    sections,
    board,
    sharedInDiligence: diligence?.titles ?? [],
    inDiligence: diligence !== null,
    verified,
  });
  const raiseMissing =
    own &&
    (overview.raiseView === undefined
      ? overview.raise === null
      : overview.raiseView.source === "NONE");
  return (
    <DiligenceBrief
      companyName={profile.canonicalName}
      folds={folds}
      board={board}
      dataRoom={dataRoom}
      nextCall={nextCallOf(meetings)}
      investor={investor}
      lead={
        overview.pitchRaiseNotice === null && legacy === null ? null : (
          <>
            {overview.pitchRaiseNotice === null ? null : (
              <OwnerPitchNotice notice={overview.pitchRaiseNotice} />
            )}
            {legacy}
          </>
        )
      }
      extras={{
        "company-raise": (
          <>
            {raiseMissing ? <AddYourRaise /> : null}
            {investor && overview.raise === null && diligence !== null ? (
              <Link
                href={diligence.href}
                className="cq-body-sm underline underline-offset-4"
              >
                Ask in diligence
              </Link>
            ) : null}
            {investor && overview.deck !== null ? (
              <DeckDownload
                companyId={profile.companyId}
                title={overview.deck.title}
                scanned={overview.deck.scanned}
              />
            ) : null}
          </>
        ),
        "company-market":
          overview.primaryDescription === null ? null : (
            <section
              className="flex flex-col gap-2"
              aria-labelledby="company-words"
            >
              <h4
                id="company-words"
                className="cq-label text-(--cq-text-secondary)"
              >
                In their words
              </h4>
              <ReadMore text={overview.primaryDescription} />
            </section>
          ),
        "company-unknowns": (
          // What is known on the three evidence axes, and why it is in the
          // reader's feed (CQ-WEB-024): from the same projection.
          <CompanyDeeperView
            companyId={profile.companyId}
            companyName={profile.canonicalName}
            facts={overview.facts}
            connected={connected}
          />
        ),
      }}
    />
  );
}

function ElevatorPanel({
  deck: eventually,
  company,
  profile,
  notSaid,
}: {
  readonly deck: Eventually<CompanyDeckView | null> | null;
  readonly company: Parameters<typeof ElevatorBrief>[0]["company"];
  readonly profile: CompanyProfileDto;
  readonly notSaid: readonly string[];
}) {
  const deck = useSettled(eventually);
  return (
    <ElevatorBrief
      company={company}
      videos={profile.videos}
      claims={profile.overview?.pitchClaims ?? []}
      sections={profile.overview?.pitchSections ?? []}
      deckRaise={deckAskTerms(deck?.extraction?.sections).amount ?? null}
      notSaid={notSaid}
    />
  );
}

function DeckPanel({
  deck: eventually,
  profile,
  own,
  investor,
  sectorLabels,
  previewAsInvestor,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly investor: boolean;
  readonly sectorLabels: readonly string[];
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
  if (deck.viewer === "OWNER" && deck.coaching !== null && !previewAsInvestor) {
    return (
      <DeckCoach
        companyId={profile.companyId}
        view={deck}
        coaching={deck.coaching}
      />
    );
  }
  return (
    <DeckBrief
      companyId={profile.companyId}
      companyName={profile.canonicalName}
      view={deck}
      sections={sectionsFor(profile, deck, own, sectorLabels)}
      investor={investor}
    />
  );
}

function TeamPanel({
  deck: eventually,
  companyId,
  companyName,
  team,
  founders: eventualFounders,
  investor,
}: {
  readonly deck: Eventually<CompanyDeckView | null>;
  readonly companyId: string;
  readonly companyName: string;
  readonly team: readonly CompanyProfileTeamMember[];
  readonly founders: Eventually<readonly (FounderPersonDto | null)[]>;
  readonly investor: boolean;
}) {
  const deck = useSettled(eventually);
  const founders = useSettled(eventualFounders);
  return (
    <TeamTab
      companyId={companyId}
      companyName={companyName}
      team={team}
      founders={founders}
      investor={investor}
      fromDeck={(deck?.extraction?.sections ?? [])
        .filter((section) => section.section === "TEAM")
        .flatMap((section) => section.facts)}
    />
  );
}
