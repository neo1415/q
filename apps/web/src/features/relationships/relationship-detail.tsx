import Link from "next/link";
import type { ReactNode } from "react";

import {
  isMatchedRelationshipState,
  type ChatThreadDto,
  type DealViewDto,
  type DiligenceDto,
  type MeetingDto,
  type RelationshipBrief,
  type RelationshipCommitmentsDto,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Globe,
  ICON_SIZE,
  Lock,
  MessageSquare,
} from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipMail } from "@/features/integrations/relationship-mail";
import { DockAvoidZone } from "@/features/q-dock/dock-avoid-zone";
import { EntityAvatar } from "@/features/entity/entity-avatar";
import { JoinCallForm } from "@/features/schedule/join-call-form";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";

import { briefLines } from "./brief-lines";
import { ScheduleDialog } from "./schedule-dialog";
import { callToRecord } from "./call-to-record";

import { AskQAboutRelationship } from "./relationship-actions";
import type { CounterpartProfile } from "./relationship-page-data";
import { RelationshipCommitment } from "./relationship-commitment";
import { DealSummary } from "./relationship-deal";
import { DecisionChoice } from "./decision-choice";
import { RelationshipErrands } from "./relationship-errands";
import { RelationshipOutcome } from "./relationship-outcome";
import { nextStepFor, since, type NextStep } from "./relationships-view";
import { StageDurations } from "./stage-durations";
import { RelationshipTimeline } from "./relationship-timeline";
import { JOURNEY, journeyStep } from "./journey";
import { CallBriefButton, CallWhen } from "./record-client";
import { QCircle, RecCard, TabCount, TILE } from "./record-parts";
import {
  NEXT_STEP_WORDS,
  type RelationshipSide,
  STATE_WORDS,
} from "./relationship-words";
import { QControl } from "@/features/q/control/q-control";
import { QSection } from "@/features/q/q-section";
import { serverTNow } from "@/features/i18n/server-now";

/** States whose next step is the outcome itself, shown above More. */
export const OUTCOME_FIRST: ReadonlySet<string> = new Set([
  "MEETING_HELD",
  "PAUSED",
  "PASSED",
]);

/** States whose primary action is the way back (Resume, Reconsider). */
export const WAY_BACK: ReadonlySet<string> = new Set(["PAUSED", "PASSED"]);

/** Where the investor still decides: keep going, pause, or not proceed. */
const DECIDING: ReadonlySet<string> = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
]);

/**
 * Whether the Next card has no step of its own to lead with (interest sent,
 * waiting for the answer). It then says so, rather than showing a lone
 * "More" (demo-44 phone pass).
 */
export function nothingLeads(
  hasActions: boolean,
  connected: boolean,
  state: string,
  hasCallToRecord: boolean,
): boolean {
  return (
    !hasActions && !connected && !OUTCOME_FIRST.has(state) && !hasCallToRecord
  );
}

/** The next booked call still ahead, if any. */
export function upcomingCall(
  meetings: readonly MeetingDto[],
  now: number,
): MeetingDto | null {
  return (
    meetings
      .filter(
        (meeting) =>
          meeting.status === "SCHEDULED" && Date.parse(meeting.endsAt) > now,
      )
      .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .at(0) ?? null
  );
}

/**
 * One relationship, for one side (CQ-WEB-030; doc 25 §121: "where are we,
 * what happened, what is next"). The CRM prototype's record, option 3
 * (owner 2026-10-20, "Next-step rail", warm charcoal): the evidence fills
 * the left as cards -- the journey, fit and interest apart, the deal, the
 * pitch and commitment, what happened, GateQ and Q's work -- while Next,
 * Decision and Private notes stay pinned in a rail on the right. On a
 * phone Next comes first and Decision and notes follow the evidence.
 * Every state and date is the server's per-party fold; no score of the
 * relationship, no celebration.
 */
export function RelationshipDetail({
  side,
  counterpart,
  relationship,
  actions,
  absentSentence,
  askQ = true,
  profile,
  thread = null,
  meetings = [],
  readAt,
  basePath,
  media = null,
  pitchClaim = null,
  diligence = null,
  brief = null,
  fitAndInterest = null,
  work = null,
  gateq = null,
  notes = null,
  decision = null,
  review,
}: {
  /**
   * Design review only (/dev/crm): the deal and the commitment, given, so
   * their cards render without reading. Absent in the product.
   */
  readonly review?:
    | {
        readonly deal: DealViewDto;
        readonly commitments: RelationshipCommitmentsDto;
      }
    | undefined;
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  /** The server-confirmed action for this side and state, if any. */
  readonly actions: ReactNode;
  /** Said when nothing is on record that this side can see. */
  readonly absentSentence: string;
  /** Whether Q can be asked about it: false when nothing is on record to ask about. */
  readonly askQ?: boolean | undefined;
  readonly profile: CounterpartProfile;
  /** The first page of messages, when the chat is open. */
  readonly thread?: ChatThreadDto | null | undefined;
  /** The relationship's calls, shown in What happened. */
  readonly meetings?: readonly MeetingDto[] | undefined;
  /** When the page was read, for past vs booked calls. */
  readonly readAt: number;
  /** This relationship's own page, e.g. /relationships/company/{id}. */
  readonly basePath: string;
  /** The counterpart's pitch, when this side may play it. */
  readonly media?: ReactNode;
  /** What the pitch states about the round, labelled as their claim. */
  readonly pitchClaim?: ReactNode;
  /** The diligence area once diligence started (its own tab). */
  readonly diligence?: DiligenceDto | null | undefined;
  /** The Relationship Brief (R1): the same read Q answers from. */
  readonly brief?: RelationshipBrief | null | undefined;
  /** An investor's fit and interest, kept apart (CRM record workspace). */
  readonly fitAndInterest?: ReactNode;
  /** Q's work with this counterpart; null when there is none to show. */
  readonly work?: ReactNode;
  /** GateQ applications on this relationship; null when there are none. */
  readonly gateq?: ReactNode;
  /** This side's private notes (CRM S3); null when there is no record. */
  readonly notes?: ReactNode;
  /** The latest decision with why and how much (CRM S5); null: none. */
  readonly decision?: ReactNode;
}) {
  const t = serverTNow();

  // The match outlives CONNECTED (relationship-state.v2).
  const connected =
    relationship !== null && isMatchedRelationshipState(relationship.state);
  // The brief counts the whole history; the thread is only its first page.
  const messageCount = brief?.messages.count ?? thread?.messages.length ?? 0;
  const standing = brief === null ? [] : briefLines(brief, counterpart);
  const call =
    relationship === null
      ? null
      : callToRecord(relationship.state, meetings, readAt);
  const step = heroStep({
    side,
    relationship,
    diligence,
    meetings,
    readAt,
    basePath,
  });
  const inDiligence =
    relationship !== null &&
    relationship.milestones.some((m) => m.state === "IN_DILIGENCE");
  const hasPitch =
    (media !== null && media !== undefined) ||
    (pitchClaim !== null && pitchClaim !== undefined);
  const hasCommitment = relationship !== null && connected;

  return (
    <PageContainer className="cq-charcoal flex flex-col gap-5">
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
        readAt={readAt}
        note={relationship === null ? t(absentSentence) : undefined}
        action={
          askQ ? (
            <AskQAboutRelationship counterpart={counterpart} compact />
          ) : null
        }
      />

      <RelationshipTabs
        basePath={basePath}
        current="OVERVIEW"
        messageCount={connected ? messageCount : null}
        diligence={diligence}
        calls={connected}
        callCount={meetings.filter((m) => m.status !== "CANCELLED").length}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* The evidence, as cards. */}
        <div className="grid min-w-0 grid-cols-1 gap-3.5 md:grid-cols-2">
          {relationship === null ? null : (
            <div className="md:col-span-2">
              <RelationshipJourney relationship={relationship} />
            </div>
          )}

          {fitAndInterest === null || fitAndInterest === undefined ? null : (
            <div id="fit" className="scroll-mt-24 md:col-span-2">
              {fitAndInterest}
            </div>
          )}

          {relationship === null || !connected ? null : (
            // Deal close (2026-10-08): the stage strip both sides see; the
            // terms, signing and close open on the deal page.
            <RecCard
              title={t("Deal")}
              id="deal"
              className="md:col-span-2"
              data-qp-anchor={QP_CARD_ANCHORS.deal}
            >
              <DealSummary
                relationshipId={relationship.relationshipId}
                href={`${basePath}/deal`}
                initial={review?.deal}
              />
            </RecCard>
          )}

          {hasPitch ? (
            <RecCard
              title={t("Pitch")}
              id="pitch"
              className={hasCommitment ? undefined : "md:col-span-2"}
            >
              {pitchClaim}
              {media}
            </RecCard>
          ) : null}

          {hasCommitment ? (
            <RecCard
              title={t("Commitment")}
              id="commitment"
              className={hasPitch ? undefined : "md:col-span-2"}
            >
              <RelationshipCommitment
                relationshipId={relationship.relationshipId}
                counterpart={counterpart}
                initial={review?.commitments}
              />
            </RecCard>
          ) : null}

          {relationship === null || !inDiligence ? null : (
            <RecCard
              title={t("Diligence")}
              id="diligence"
              className="md:col-span-2"
            >
              <Link
                href={`${basePath}/diligence`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5 transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                data-diligence-summary
              >
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {t(diligenceLine(side, diligence))}
                </span>
                <ArrowUpRight
                  size={ICON_SIZE.compact}
                  aria-hidden="true"
                  className="shrink-0 text-(--cq-text-tertiary)"
                />
              </Link>
            </RecCard>
          )}

          {relationship === null ||
          relationship.milestones.length === 0 ? null : (
            // Q's SCROLL_TO (premiere v5): the dated history, on screen.
            <div className="md:col-span-2">
              <QControl id="section.relationship-history" kind="SECTION">
                <History
                  count={relationship.milestones.length}
                  title={t("What happened")}
                >
                  <RelationshipTimeline
                    milestones={relationship.milestones}
                    meetings={meetings}
                    now={readAt}
                    side={side}
                    counterpart={counterpart}
                    newestFirst
                  />
                  <StageDurations
                    milestones={relationship.milestones}
                    now={readAt}
                  />
                </History>
              </QControl>
            </div>
          )}

          {gateq === null || gateq === undefined ? null : (
            <RecCard title="GateQ" id="gateq" className="md:col-span-2">
              {gateq}
            </RecCard>
          )}

          {work === null || work === undefined ? null : (
            <RecCard
              title="Q Work"
              icon={<QCircle className="text-(--cq-text-secondary)" />}
              id="q-work"
              className="md:col-span-2"
            >
              {work}
              <span className="cq-caption text-(--cq-text-tertiary)">
                {t("Q's inference, labelled as Q's. The decision stays yours.")}
              </span>
            </RecCard>
          )}

          {relationship === null ? null : (
            <div className="md:col-span-2">
              <RelationshipMail
                relationshipId={relationship.relationshipId}
                counterpart={counterpart}
              />
            </div>
          )}

          <RecCard
            title={
              side === "INVESTOR"
                ? t("About the company")
                : t("About the investor")
            }
            id="context"
            className="md:col-span-2"
          >
            {profile.about === null ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {t(`${counterpart} hasn't shared a description you can see.`)}
              </p>
            ) : (
              <p className="cq-body-sm line-clamp-6 text-(--cq-text-secondary)">
                {t(profile.about)}
              </p>
            )}
            {profile.profileHref === null ? null : (
              <Link
                href={profile.profileHref}
                className={buttonClassName(
                  "secondary",
                  "compact",
                  "self-start",
                )}
              >
                {t("View profile")}
                <ArrowUpRight size={ICON_SIZE.compact} aria-hidden="true" />
              </Link>
            )}
          </RecCard>
        </div>

        {/*
          The rail: Next, Decision and Private notes never scroll away on a
          large screen. On a phone its parts join the page's grid: Next
          straight after the header, Decision and notes after the evidence.
        */}
        <aside
          className="flex min-w-0 flex-col gap-3.5 max-lg:contents lg:sticky lg:top-4 lg:self-start"
          aria-label={t("Next")}
        >
          <NextCard
            side={side}
            counterpart={counterpart}
            relationship={relationship}
            actions={actions}
            connected={connected}
            call={call}
            step={step}
            standing={standing}
            meetings={meetings}
            readAt={readAt}
            basePath={basePath}
          />

          {relationship !== null &&
          side === "INVESTOR" &&
          DECIDING.has(relationship.state) ? (
            <RecCard
              title={t("Decision")}
              id="decision"
              className="max-lg:order-last"
            >
              <DecisionChoice
                relationshipId={relationship.relationshipId}
                state={relationship.state}
                counterpart={counterpart}
              />
              {decision}
            </RecCard>
          ) : decision === null || decision === undefined ? null : (
            <RecCard
              title={t("Decision")}
              id="decision"
              className="max-lg:order-last"
            >
              {decision}
            </RecCard>
          )}

          {notes === null || notes === undefined ? null : (
            <RecCard
              title={t("Private notes")}
              icon={<Lock size={ICON_SIZE.compact} aria-hidden="true" />}
              id="notes"
              className="max-lg:order-last"
              data-qp-anchor={QP_CARD_ANCHORS.notes}
            >
              {notes}
            </RecCard>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}

/**
 * The one next step, pinned (record option 3): what it is in a line, why
 * in one more, then one primary button and one quiet one. Everything else
 * this side can do is one tap away under More.
 */
function NextCard({
  side,
  counterpart,
  relationship,
  actions,
  connected,
  call,
  step,
  standing,
  meetings,
  readAt,
  basePath,
}: {
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  readonly actions: ReactNode;
  readonly connected: boolean;
  readonly call: ReturnType<typeof callToRecord>;
  readonly step: NextStep | null;
  readonly standing: readonly string[];
  readonly meetings: readonly MeetingDto[];
  readonly readAt: number;
  readonly basePath: string;
}) {
  const t = serverTNow();
  const hasActions = actions !== null && actions !== undefined;
  const next = upcomingCall(meetings, readAt);
  const outcomeFirst =
    relationship !== null &&
    (OUTCOME_FIRST.has(relationship.state) || call !== null);
  const wayBack = relationship !== null && WAY_BACK.has(relationship.state);
  const stepLink =
    step === null || step.label === null || step.href === null ? null : step;
  // The calendar's own dialog when the step is booking a call.
  const stepBooks = stepLink?.href?.endsWith("#calls") === true;
  const bookLeads =
    connected &&
    !hasActions &&
    !outcomeFirst &&
    next === null &&
    (stepLink === null || stepBooks);

  const title = outcomeFirst
    ? wayBack
      ? t("Where this stands")
      : t("How did the call go?")
    : next !== null
      ? null
      : stepLink !== null
        ? t(stepLink.label ?? "")
        : relationship === null
          ? t("Nothing on record yet")
          : t(NEXT_STEP_WORDS[relationship.nextStep]);
  const why = outcomeFirst
    ? wayBack && relationship !== null
      ? t(STATE_WORDS[relationship.state])
      : null
    : next !== null
      ? next.hasBrief
        ? t("Q prepared a brief for this call from what both sides shared.")
        : next.purpose
      : stepLink !== null && stepLink.why !== ""
        ? t(stepLink.why)
        : null;

  return (
    <RecCard
      title={t("Next")}
      icon={<QCircle />}
      id="next"
      accent
      className="max-lg:order-first"
      data-qp-anchor={QP_CARD_ANCHORS.next}
    >
      {/*
        The whole next-step block is kept clear of the Q dock (16 Oct run:
        "Voice paused" sat over the brief just above Book a call).
      */}
      <DockAvoidZone className="flex flex-col gap-3">
        <div className="flex flex-col gap-1" data-next-title>
          {title === null && next !== null ? (
            <b className="text-[17px] leading-snug font-semibold text-(--cq-text-primary)">
              {t("Your call is")} <CallWhen iso={next.startsAt} />
            </b>
          ) : (
            <b className="text-[17px] leading-snug font-semibold text-(--cq-text-primary)">
              {title}
            </b>
          )}
          {why === null ? null : (
            <span className="cq-body-sm text-(--cq-text-secondary)">{why}</span>
          )}
        </div>

        {standing.length === 0 || outcomeFirst ? null : (
          <ul
            className="cq-caption flex flex-col gap-0.5 text-(--cq-text-secondary)"
            aria-label={t("Where this stands")}
            data-relationship-brief
          >
            {standing.map((line) => (
              <li key={line}>{t(line)}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col items-stretch gap-2 [&_a]:w-full [&_button]:w-full">
          {outcomeFirst && relationship !== null ? (
            <div data-outcome-first>
              <RelationshipOutcome
                relationshipId={relationship.relationshipId}
                state={relationship.state}
                side={side}
                counterpart={counterpart}
                call={call}
                only={side === "INVESTOR" && !wayBack ? "meeting" : undefined}
              />
            </div>
          ) : null}
          {actions}
          {!outcomeFirst && next !== null ? (
            <>
              {next.hasBrief ? (
                <CallBriefButton
                  meetingId={next.id}
                  counterpart={counterpart}
                  charcoal
                />
              ) : next.meetLink === null ? null : (
                <a
                  href={next.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClassName("primary")}
                >
                  {t("Join Google Meet")}
                </a>
              )}
              <Link
                href={`${basePath}/calls`}
                className={buttonClassName("secondary")}
              >
                {t("Reschedule")}
              </Link>
            </>
          ) : null}
          {!outcomeFirst && next === null && stepLink !== null && !stepBooks ? (
            <Link
              href={stepLink.href ?? "#"}
              className={buttonClassName(
                stepLink.urgent && !hasActions ? "primary" : "secondary",
              )}
              data-hero-action
            >
              {t(stepLink.label ?? "")}
            </Link>
          ) : null}
          {connected && relationship !== null && bookLeads ? (
            <ScheduleDialog kind="call" primary>
              <RelationshipSchedule
                relationshipId={relationship.relationshipId}
                counterpart={counterpart}
                connected={connected}
                focus="call"
              />
            </ScheduleDialog>
          ) : null}
          {connected && next === null && !outcomeFirst ? (
            <Link
              href={`${basePath}/messages`}
              className={buttonClassName("secondary")}
            >
              <MessageSquare size={ICON_SIZE.regular} aria-hidden="true" />
              {t("Send a message")}
            </Link>
          ) : null}
          {relationship !== null &&
          nothingLeads(
            hasActions,
            connected,
            relationship.state,
            call !== null,
          ) ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t("Nothing needs you right now.")}
            </p>
          ) : null}
        </div>

        {relationship === null ? null : (
          // One primary step above; everything else one tap away (demo
          // audit 2026-10-03: six equal actions under Next).
          <details className="group" data-next-more>
            <summary className="cq-body-sm flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-(--cq-radius-md) text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) [&::-webkit-details-marker]:hidden">
              {t("More")}
              <ChevronDown
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className="transition-transform duration-(--cq-motion-fast) group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="flex flex-col items-stretch gap-2 pt-2">
              <RelationshipErrands
                relationshipId={relationship.relationshipId}
                counterpart={counterpart}
                connected={connected}
              />
              {connected && !bookLeads ? (
                <ScheduleDialog kind="call">
                  <RelationshipSchedule
                    relationshipId={relationship.relationshipId}
                    counterpart={counterpart}
                    connected={connected}
                    focus="call"
                  />
                </ScheduleDialog>
              ) : null}
              {connected ? (
                <ScheduleDialog kind="join">
                  <JoinCallForm
                    relationshipId={relationship.relationshipId}
                    counterpart={counterpart}
                  />
                </ScheduleDialog>
              ) : null}
              <ScheduleDialog kind="reminder">
                <RelationshipSchedule
                  relationshipId={relationship.relationshipId}
                  counterpart={counterpart}
                  connected={connected}
                  focus="reminder"
                />
              </ScheduleDialog>
              {side === "COMPANY" && !outcomeFirst ? (
                <RelationshipOutcome
                  relationshipId={relationship.relationshipId}
                  state={relationship.state}
                  side={side}
                  counterpart={counterpart}
                />
              ) : null}
            </div>
          </details>
        )}
      </DockAvoidZone>
    </RecCard>
  );
}

/**
 * What happened: folded on a phone, open on a large screen (design-48 v2).
 * The large-screen rule shows a closed <details>'s content through
 * ::details-content; a browser without it shows it folded, one tap away.
 */
function History({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const t = serverTNow();
  return (
    <details
      aria-labelledby="relationship-history"
      className="group scroll-mt-24 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px] lg:[&::details-content]:[content-visibility:visible]"
      data-collapsible="history"
      data-qp-anchor={QP_CARD_ANCHORS.history}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 lg:pointer-events-none lg:min-h-0 [&::-webkit-details-marker]:hidden">
        <h3
          id="relationship-history"
          className="cq-body-sm font-medium text-(--cq-text-secondary)"
        >
          {title}
          <span className="cq-numeric font-normal lg:hidden">
            {t(` · ${String(count)}`)}
          </span>
        </h3>
        <ChevronDown
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="text-(--cq-text-tertiary) transition-transform group-open:rotate-180 lg:hidden"
        />
      </summary>
      {/* The id is inside the fold so a link to #history opens it. */}
      <div id="history" className="flex scroll-mt-24 flex-col gap-4 pt-3">
        {children}
      </div>
    </details>
  );
}

/**
 * Where the relationship is on its way (design-48; record prototype): five
 * steps, each dated when reached, the current one in the accent with
 * "since". The words carry it; the bars repeat it.
 */
export function RelationshipJourney({
  relationship,
}: {
  readonly relationship: RelationshipStatusDto;
}) {
  const t = serverTNow();
  const step = journeyStep(relationship);
  if (step === null) return null;
  const reachedAt = (states: readonly string[]): string | null =>
    relationship.milestones
      .filter((m) => states.includes(m.state))
      .map((m) => m.at)
      .toSorted((a, b) => Date.parse(a) - Date.parse(b))
      .at(0) ?? null;
  return (
    <div className="flex flex-col gap-1">
      <ol
        className="grid grid-cols-5 gap-1.5"
        aria-label={t("Progress")}
        data-journey-step={step}
      >
        {JOURNEY.map((entry, index) => {
          const at = reachedAt(entry.states);
          const status =
            index + 1 < step ? "done" : index + 1 === step ? "now" : "ahead";
          return (
            <li
              key={entry.label}
              className="flex min-w-0 flex-col gap-1.5"
              aria-current={status === "now" ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "h-1.5 rounded-full",
                  status === "done"
                    ? "bg-(--cq-positive)"
                    : status === "now"
                      ? "bg-(--cq-accent)"
                      : "bg-(--cq-surface-strong)",
                )}
              />
              <span
                className={cx(
                  "cq-caption truncate max-sm:whitespace-normal max-sm:text-[11px] max-sm:leading-tight",
                  status === "now"
                    ? "font-semibold text-(--cq-text-primary)"
                    : "text-(--cq-text-tertiary)",
                )}
              >
                {status === "done" ? (
                  <span aria-hidden="true" className="text-(--cq-positive)">
                    {"✓ "}
                  </span>
                ) : null}
                {t(entry.label)}
                {at === null ? null : (
                  <small className="font-normal text-(--cq-text-tertiary)">
                    {" "}
                    {status === "now"
                      ? t(`since ${shortDay(at)}`)
                      : t(shortDay(at))}
                  </small>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" data-relationship-state>
        {t(STATE_WORDS[relationship.state])}
        {t(` · ${String(step)} of ${String(JOURNEY.length)}`)}
      </p>
    </div>
  );
}

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "6 Oct": a milestone's day, the same on both sides. */
function shortDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : SHORT_DAY.format(at);
}

/**
 * A relationship's other tabs (Diligence, Calls, Deal): the same header
 * and tabs as the overview, then the tab's own content.
 */
export function RelationshipSection({
  side,
  counterpart,
  relationship,
  profile,
  basePath,
  current,
  messageCount,
  diligence,
  meetings,
  readAt,
  action,
  charcoal = false,
  children,
}: {
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto;
  readonly profile: CounterpartProfile;
  readonly basePath: string;
  readonly current: "DILIGENCE" | "CALLS" | "DEAL";
  readonly messageCount: number;
  readonly diligence: DiligenceDto | null;
  readonly meetings: readonly MeetingDto[];
  readonly readAt: number;
  /** The tab's own header action; Ask Q when none. */
  readonly action?: ReactNode;
  /** The warm-charcoal option (Calls; the deal under Overview). */
  readonly charcoal?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const t = serverTNow();

  const connected = isMatchedRelationshipState(relationship.state);
  return (
    <PageContainer
      className={cx(
        "flex flex-col gap-5",
        charcoal ? "cq-charcoal" : undefined,
      )}
    >
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
        readAt={readAt}
        action={
          action ?? <AskQAboutRelationship counterpart={counterpart} compact />
        }
      />
      <RelationshipTabs
        basePath={basePath}
        current={current === "DEAL" ? "OVERVIEW" : current}
        messageCount={connected ? messageCount : null}
        diligence={diligence}
        calls={connected}
        callCount={meetings.filter((m) => m.status !== "CANCELLED").length}
      />
      {current === "DEAL" ? (
        // The deal reads as the Overview's (the record prototype keeps it
        // there); Q knows it through the relationship subject.
        children
      ) : (
        /* Lane W: the tab on screen, by the counterpart's record. */
        <QSection
          id={current === "CALLS" ? "calls" : "diligence"}
          kind={current === "CALLS" ? "SCHEDULE" : "DILIGENCE"}
          refs={[
            side === "INVESTOR"
              ? { kind: "COMPANY", id: relationship.companyId }
              : {
                  kind: "INVESTOR_ORGANISATION",
                  id: relationship.investorOrganisationId,
                },
            ...(current === "CALLS"
              ? meetings.slice(0, 11).map((meeting) => ({
                  kind: "MEETING" as const,
                  id: meeting.id,
                }))
              : []),
          ]}
          total={current === "CALLS" ? meetings.length : 1}
          label={t(
            `${current === "CALLS" ? "calls" : "diligence"} with ${counterpart}`,
          )}
        >
          {children}
        </QSection>
      )}
    </PageContainer>
  );
}

/** "last activity 3 h ago", from the newest dated thing on record. */
function activityWords(
  relationship: RelationshipStatusDto,
  now: number,
): string {
  const latest =
    [relationship.stateSince, ...relationship.milestones.map((m) => m.at)]
      .filter((at) => !Number.isNaN(Date.parse(at)))
      .toSorted((a, b) => Date.parse(b) - Date.parse(a))
      .at(0) ?? relationship.stateSince;
  const ago = since(latest, now);
  if (ago === "") return "";
  if (ago === "now") return "last activity just now";
  return /^\d+[mhd]$/.test(ago)
    ? `last activity ${ago.replace(/([mhd])$/, " $1")} ago`
    : `last activity ${ago}`;
}

/**
 * The top of every record tab (record prototype): back to the CRM; the
 * counterpart's tile, name and one line; where it stands as a pill and the
 * tab's one action; then a quiet line of facts. No card around it.
 */
export function RelationshipHero({
  counterpart,
  relationship,
  profile,
  note,
  readAt,
  action = null,
}: {
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  readonly profile: CounterpartProfile;
  /** Said under the name when nothing is on record. */
  readonly note?: string | undefined;
  /** When the page was read, for "last activity". */
  readonly readAt?: number | undefined;
  /** The tab's one header action (Ask Q, Ask for a document). */
  readonly action?: ReactNode;
}) {
  const t = serverTNow();

  const facts = [
    ...profile.chips,
    ...(profile.location === null ? [] : [profile.location]),
  ]
    .map((part) => t(part))
    .join(", ");
  const activity =
    relationship === null || readAt === undefined
      ? ""
      : activityWords(relationship, readAt);
  const meta = [facts, activity === "" ? "" : t(activity)]
    .filter((part) => part !== "")
    .join(", ");
  const avatar = (px: number) => (
    <EntityAvatar
      kind={profile.companyId === undefined ? "investor" : "company"}
      name={counterpart}
      // An investor without a signed picture: the gated photo route by
      // id (the name's scope). A company's null means "no photo".
      src={
        profile.investorOrganisationId
          ? (profile.photoUrl ?? undefined)
          : profile.photoUrl
      }
      companyId={profile.companyId}
      investorOrganisationId={profile.investorOrganisationId}
      size={px}
      decorative
      className={cx("rounded-(--cq-radius-lg)! border-0!", TILE)}
    />
  );
  const pill =
    relationship === null ? null : <StatePill state={relationship.state} />;
  return (
    <header
      aria-label={t(`${counterpart} at a glance`)}
      className="flex flex-col"
      data-relationship-hero
    >
      <BackToRelationships />
      <div className="mt-1 flex items-center gap-3.5">
        <span className="max-sm:hidden">{avatar(52)}</span>
        <span className="sm:hidden">{avatar(36)}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] break-words text-(--cq-text-primary) sm:text-[28px]">
            {counterpart}
          </h1>
          {profile.about === null ? null : (
            <p className="cq-body-sm mt-0.5 text-(--cq-text-secondary) sm:truncate">
              {t(profile.about)}
            </p>
          )}
          {note === undefined ? null : (
            <p className="cq-body-sm mt-0.5 text-(--cq-text-secondary)">
              {note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 max-sm:hidden">
          {pill}
          {action}
        </div>
      </div>
      <div className="mt-2.5 mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="sm:hidden">{pill}</span>
        {meta === "" ? null : (
          <span className="cq-caption text-(--cq-text-tertiary)">{meta}</span>
        )}
        {profile.websiteUrl === null ? null : (
          <a
            href={profile.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="cq-caption inline-flex min-h-8 items-center gap-1 text-(--cq-text-secondary) underline-offset-4 hover:underline"
          >
            <Globe size={ICON_SIZE.compact} aria-hidden="true" />
            {t(
              profile.websiteUrl
                .replace(/^https?:\/\//i, "")
                .replace(/\/$/, ""),
            )}
          </a>
        )}
      </div>
      {action === null ? null : (
        <div className="mb-3 sm:hidden [&_button]:w-full">{action}</div>
      )}
    </header>
  );
}

/** The state as a small pill: its words, the accent only repeating them. */
function StatePill({
  state,
}: {
  readonly state: RelationshipStatusDto["state"];
}) {
  const t = serverTNow();
  const tone =
    state === "INVESTED"
      ? "bg-(--cq-positive-soft) text-(--cq-positive)"
      : state === "IN_DILIGENCE" || state === "MEETING_HELD"
        ? "bg-(--cq-accent-soft) text-(--cq-accent)"
        : state === "CONNECTED"
          ? "bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
          : "border border-dashed border-(--cq-border) text-(--cq-text-tertiary)";
  return (
    <span
      className={cx(
        "cq-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium whitespace-nowrap",
        tone,
      )}
      data-state-pill={state}
    >
      {t(STATE_WORDS[state])}
    </span>
  );
}

/** The hero's step: the same words the list row says for it. */
export function heroStep(input: {
  readonly side: RelationshipSide;
  readonly relationship: RelationshipStatusDto | null;
  readonly diligence: DiligenceDto | null;
  readonly meetings: readonly MeetingDto[];
  readonly readAt: number;
  readonly basePath: string;
}): NextStep | null {
  const { relationship, diligence } = input;
  if (relationship === null) return null;
  const open = (diligence?.requests ?? []).filter(
    (request) => request.status === "OPEN",
  );
  const nextCall = input.meetings
    .filter(
      (meeting) =>
        meeting.status !== "CANCELLED" &&
        Date.parse(meeting.startsAt) > input.readAt,
    )
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .at(0);
  const step = nextStepFor(
    relationship,
    {
      unread: 0,
      followUpDue: false,
      nextCallAt: nextCall?.startsAt ?? null,
      lastMessageAt: null,
      diligence:
        diligence === null || !diligence.open
          ? null
          : {
              openRequests: open.length,
              firstOpenTitle: open[0]?.title ?? null,
              unopenedShares: diligence.shares.filter(
                (share) => share.viewedAt === null,
              ).length,
            },
    },
    input.side,
    input.readAt,
    input.basePath,
  );
  // Answering interest stays the Next card's own server-confirmed control.
  return step.icon === "answer" ? null : step;
}

/** The overview's one line about diligence, from the side reading it. */
export function diligenceLine(
  side: RelationshipSide,
  diligence: DiligenceDto | null,
): string {
  if (diligence === null) return "Open diligence";
  const open = diligence.requests.filter((r) => r.status === "OPEN").length;
  const shared = diligence.shares.length;
  const parts = [
    open === 0
      ? null
      : side === "COMPANY"
        ? `${String(open)} ${open === 1 ? "request" : "requests"} to answer`
        : `${String(open)} waiting on them`,
    shared === 0
      ? null
      : `${String(shared)} ${shared === 1 ? "document" : "documents"} shared`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "Nothing requested yet" : parts.join(" · ");
}

/** The relationship's tabs: real pages, each with its count. */
export function RelationshipTabs({
  basePath,
  current,
  messageCount,
  diligence = null,
  calls = false,
  callCount = 0,
}: {
  readonly basePath: string;
  readonly current: "OVERVIEW" | "DILIGENCE" | "MESSAGES" | "CALLS";
  /** Null when the chat isn't open: the tab is then not offered. */
  readonly messageCount: number | null;
  /** Offered once diligence started; its count is what waits on this side. */
  readonly diligence?: DiligenceDto | null | undefined;
  /** Offered once connected. */
  readonly calls?: boolean | undefined;
  /** The calls on record (booked and past). */
  readonly callCount?: number | undefined;
}) {
  const t = serverTNow();

  const waiting =
    diligence === null
      ? 0
      : diligence.side === "COMPANY"
        ? diligence.requests.filter((r) => r.status === "OPEN").length
        : diligence.shares.filter((share) => share.viewedAt === null).length;
  // The same tab treatment as the CRM's own tabs, one level down.
  const tab = (active: boolean) =>
    cx(
      "cq-body-sm -mb-px inline-flex min-h-11 flex-none items-center border-b-2 px-3 whitespace-nowrap transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
      active
        ? "border-(--cq-accent) font-semibold text-(--cq-text-primary)"
        : "border-transparent font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
    );
  return (
    <nav
      aria-label={t("Relationship")}
      className="relative -mx-4 -mt-3 flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <Link
        href={basePath}
        aria-current={current === "OVERVIEW" ? "page" : undefined}
        className={tab(current === "OVERVIEW")}
      >
        {t("Overview")}
      </Link>
      {diligence === null ? null : (
        <Link
          href={`${basePath}/diligence`}
          aria-current={current === "DILIGENCE" ? "page" : undefined}
          className={tab(current === "DILIGENCE")}
        >
          {t("Diligence")}
          {waiting > 0 ? <TabCount>{waiting}</TabCount> : null}
        </Link>
      )}
      {messageCount === null ? null : (
        <Link
          href={`${basePath}/messages`}
          aria-current={current === "MESSAGES" ? "page" : undefined}
          className={tab(current === "MESSAGES")}
        >
          {t("Messages")}
          {messageCount > 0 ? <TabCount>{messageCount}</TabCount> : null}
        </Link>
      )}
      {calls ? (
        <Link
          href={`${basePath}/calls`}
          aria-current={current === "CALLS" ? "page" : undefined}
          className={tab(current === "CALLS")}
        >
          {t("Calls")}
          {callCount > 0 ? <TabCount>{callCount}</TabCount> : null}
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Q Pitch v6: the record's sections a tour talks about, by card id. Inert
 * markers (`data-qp-anchor`, space-separated per track); the tour lights
 * the one Q is speaking about. fdr.11.*: the founder track's record step.
 */
const QP_CARD_ANCHORS = {
  deal: "fdr.11.relationship.deal",
  history: "fdr.11.relationship.history",
  notes: "fdr.11.relationship.notes",
  next: "fdr.11.relationship.next",
} as const;

export function BackToRelationships({
  href = "/relationships",
  label = "CRM",
}: {
  readonly href?: string;
  readonly label?: string;
}) {
  const t = serverTNow();

  return (
    <Link
      href={href}
      className="cq-body-sm -ms-1 inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
    >
      <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
      {t(label)}
    </Link>
  );
}

/** A page that cannot answer for this person: one calm sentence. */
export function RelationshipUnavailable({
  sentence,
}: {
  readonly sentence: string;
}) {
  const t = serverTNow();

  return (
    <PageContainer className="flex flex-col gap-6">
      <BackToRelationships />
      <h1 className="cq-title-lg text-(--cq-text-primary)">
        {t("Relationship")}
      </h1>
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {t(sentence)}
      </p>
    </PageContainer>
  );
}
