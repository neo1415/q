import Link from "next/link";
import type { ReactNode } from "react";

import {
  isMatchedRelationshipState,
  type ChatThreadDto,
  type DiligenceDto,
  type MeetingDto,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  FileText,
  Globe,
  ICON_SIZE,
  MapPin,
  MessageSquare,
  Upload,
} from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipMail } from "@/features/integrations/relationship-mail";
import { DockAvoidZone } from "@/features/q-dock";
import { EntityAvatar, EntityCover } from "@/features/entity/entity-avatar";
import { JoinCallForm } from "@/features/schedule/join-call-form";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";

import { ScheduleDialog } from "./schedule-dialog";
import { callToRecord } from "./call-to-record";

import { AskQAboutRelationship } from "./relationship-actions";
import type { CounterpartProfile } from "./relationship-page-data";
import { RelationshipCommitment } from "./relationship-commitment";
import { RelationshipErrands } from "./relationship-errands";
import { RelationshipOutcome } from "./relationship-outcome";
import { nextStepFor, type NextStep } from "./relationships-view";
import { RelationshipTimeline } from "./relationship-timeline";
import { JOURNEY, journeyStep } from "./journey";
import {
  NEXT_STEP_WORDS,
  type RelationshipSide,
  STATE_WORDS,
} from "./relationship-words";

/** States whose next step is the outcome itself, shown above More. */
export const OUTCOME_FIRST: ReadonlySet<string> = new Set([
  "MEETING_HELD",
  "PAUSED",
  "PASSED",
]);

/** States whose primary action is the way back (Resume, Reconsider). */
export const WAY_BACK: ReadonlySet<string> = new Set(["PAUSED", "PASSED"]);

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

/**
 * One relationship, for one side (CQ-WEB-030; doc 25 §121: "where are we,
 * what happened, what is next"; founder design 2026-09-28, Relationship
 * overview).
 *
 * A hero with who the counterpart is and where things stand; tabs to the
 * conversation, calls and reminders; then where things stand, about them,
 * what happened, the latest messages, and calls and reminders. The right
 * column holds the next action (the same server-confirmed controls as
 * before, plus links to what exists: messages, calls, reminders), their
 * context, and Q. Every state and date is the server's per-party fold.
 * No celebration, no score, no badge.
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
  diligence = null,
}: {
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
  /** The diligence area once diligence started (its own tab). */
  readonly diligence?: DiligenceDto | null | undefined;
}) {
  // The match outlives CONNECTED (relationship-state.v2).
  const connected =
    relationship !== null && isMatchedRelationshipState(relationship.state);
  const messageCount = thread?.messages.length ?? 0;
  const call =
    relationship === null
      ? null
      : callToRecord(relationship.state, meetings, readAt);
  return (
    <PageContainer className="flex flex-col gap-6">
      <BackToRelationships />
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
        note={relationship === null ? absentSentence : undefined}
        step={heroStep({
          side,
          relationship,
          diligence,
          meetings,
          readAt,
          basePath,
        })}
      />

      <RelationshipTabs
        basePath={basePath}
        current="OVERVIEW"
        messageCount={connected ? messageCount : null}
        diligence={diligence}
        calls={connected}
      />

      {relationship !== null &&
      (OUTCOME_FIRST.has(relationship.state) || call !== null) ? (
        // Right after a meeting, "How did it go?" comes before Next (lead
        // decision, design-48); when paused or not proceeding, the way
        // back does (break-it 2026-10-03: Zino could not find Resume).
        <section
          aria-labelledby="relationship-outcome"
          className="flex max-w-(--cq-layout-reading) flex-col gap-3"
          data-outcome-first
        >
          <h2
            id="relationship-outcome"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            {WAY_BACK.has(relationship.state)
              ? "Where this stands"
              : "How did it go?"}
          </h2>
          <DockAvoidZone className="flex flex-col items-stretch gap-2">
            <RelationshipOutcome
              relationshipId={relationship.relationshipId}
              state={relationship.state}
              side={side}
              counterpart={counterpart}
              call={call}
            />
          </DockAvoidZone>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {media === null || media === undefined ? null : (
            <Card title="Pitch" id="pitch">
              {media}
            </Card>
          )}

          {relationship === null || !connected ? null : (
            <Card title="Commitment" id="commitment">
              <RelationshipCommitment
                relationshipId={relationship.relationshipId}
                counterpart={counterpart}
              />
            </Card>
          )}

          {relationship === null ||
          !relationship.milestones.some(
            (milestone) => milestone.state === "IN_DILIGENCE",
          ) ? null : (
            <Card title="Diligence" id="diligence">
              <Link
                href={`${basePath}/diligence`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3 hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                data-diligence-summary
              >
                <span className="cq-body text-(--cq-text-primary)">
                  {diligenceLine(side, diligence)}
                </span>
                <ArrowUpRight
                  size={ICON_SIZE.compact}
                  aria-hidden="true"
                  className="shrink-0 text-(--cq-text-tertiary)"
                />
              </Link>
            </Card>
          )}

          {relationship === null ||
          relationship.milestones.length === 0 ? null : (
            <Card
              title="What happened"
              id="history"
              collapsible
              count={relationship.milestones.length}
            >
              <RelationshipTimeline
                milestones={relationship.milestones}
                meetings={meetings}
                now={readAt}
                side={side}
                counterpart={counterpart}
              />
            </Card>
          )}

          {relationship === null ? null : (
            <RelationshipMail
              relationshipId={relationship.relationshipId}
              counterpart={counterpart}
            />
          )}
        </div>

        {/*
          On a phone the aside's parts join the page's grid so the next
          step can come straight after the hero, before the history
          (re-capture 2026-10-03: Book a call sat below the whole timeline);
          context and Ask Q follow the page.
        */}
        <aside
          className="flex min-w-0 flex-col gap-6 max-lg:contents lg:sticky lg:top-6 lg:self-start"
          aria-label="Next"
        >
          <Card title="Next" id="next" className="max-lg:order-first">
            <DockAvoidZone className="flex flex-col items-stretch gap-2">
              {actions}
              {connected && relationship !== null ? (
                <ScheduleDialog
                  kind="call"
                  primary={
                    actions === null && !WAY_BACK.has(relationship.state)
                  }
                >
                  <RelationshipSchedule
                    relationshipId={relationship.relationshipId}
                    counterpart={counterpart}
                    connected={connected}
                    focus="call"
                  />
                </ScheduleDialog>
              ) : null}
              {connected ? (
                <Link
                  href={`${basePath}/messages`}
                  className={buttonClassName("secondary")}
                >
                  <MessageSquare size={ICON_SIZE.regular} aria-hidden="true" />
                  Send a message
                </Link>
              ) : null}
              {relationship !== null &&
              nothingLeads(
                actions !== null && actions !== undefined,
                connected,
                relationship.state,
                call !== null,
              ) ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Nothing needs you right now.
                </p>
              ) : null}
              {relationship === null ? null : (
                <>
                  {/*
                    One primary step above; everything else one tap away
                    (demo audit 2026-10-03: six equal actions under Next).
                  */}
                  <details className="group" data-next-more>
                    <summary className="cq-body-sm flex min-h-11 cursor-pointer list-none items-center justify-center rounded-md text-(--cq-text-secondary) hover:text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
                      More
                    </summary>
                    <div className="flex flex-col items-stretch gap-2 pt-2">
                      <RelationshipErrands
                        relationshipId={relationship.relationshipId}
                        counterpart={counterpart}
                        connected={connected}
                      />
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
                      {OUTCOME_FIRST.has(relationship.state) ||
                      call !== null ? null : (
                        <RelationshipOutcome
                          relationshipId={relationship.relationshipId}
                          state={relationship.state}
                          side={side}
                          counterpart={counterpart}
                        />
                      )}
                    </div>
                  </details>
                </>
              )}
            </DockAvoidZone>
          </Card>

          <Card
            className="max-lg:order-last"
            title={side === "INVESTOR" ? "Company context" : "Investor context"}
            id="context"
          >
            <div className="flex flex-col gap-3">
              {profile.about === null ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {counterpart} hasn&apos;t shared a description you can see.
                </p>
              ) : (
                <p className="cq-body-sm line-clamp-6 text-(--cq-text-secondary)">
                  {profile.about}
                </p>
              )}
              <ProfileChips profile={profile} />
              {profile.profileHref === null ? null : (
                <Link
                  href={profile.profileHref}
                  className={buttonClassName(
                    "secondary",
                    "compact",
                    "self-start",
                  )}
                >
                  View profile
                  <ArrowUpRight size={ICON_SIZE.compact} aria-hidden="true" />
                </Link>
              )}
            </div>
          </Card>

          {askQ ? (
            <section
              aria-label="Ask Q"
              className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5 max-lg:order-last"
            >
              <AskQAboutRelationship counterpart={counterpart} />
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}

/**
 * A relationship's other tabs (Diligence, Calls): the same back link, hero
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
  children,
}: {
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto;
  readonly profile: CounterpartProfile;
  readonly basePath: string;
  readonly current: "DILIGENCE" | "CALLS";
  readonly messageCount: number;
  readonly diligence: DiligenceDto | null;
  readonly meetings: readonly MeetingDto[];
  readonly readAt: number;
  readonly children: ReactNode;
}) {
  const connected = isMatchedRelationshipState(relationship.state);
  return (
    <PageContainer className="flex flex-col gap-6">
      <BackToRelationships />
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
        step={heroStep({
          side,
          relationship,
          diligence,
          meetings,
          readAt,
          basePath,
        })}
      />
      <RelationshipTabs
        basePath={basePath}
        current={current}
        messageCount={connected ? messageCount : null}
        diligence={diligence}
        calls={connected}
      />
      {children}
    </PageContainer>
  );
}

/**
 * The top of both relationship pages: who, where, and where it stands
 * (design-48). No card around it: the name, then the state in words with
 * the step it reached, the bar repeating what the words say.
 */
export function RelationshipHero({
  counterpart,
  relationship,
  profile,
  note,
  step: next = null,
}: {
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  readonly profile: CounterpartProfile;
  /** Said under the name when nothing is on record. */
  readonly note?: string | undefined;
  /** The one next step (the list row's own), as the hero's button. */
  readonly step?: NextStep | null | undefined;
}) {
  const step = relationship === null ? null : journeyStep(relationship);
  const action =
    next === null || next.label === null || next.href === null ? null : next;
  const ActionIcon =
    action?.icon === "upload"
      ? Upload
      : action?.icon === "file"
        ? FileText
        : action?.icon === "reply"
          ? MessageSquare
          : action?.icon === "calendar"
            ? CalendarDays
            : null;
  return (
    <section
      aria-label={`${counterpart} at a glance`}
      className="grid gap-4 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-xs) sm:p-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center lg:gap-x-8"
      data-relationship-hero
    >
      <div className="flex min-w-0 flex-col gap-4">
        {typeof profile.coverUrl === "string" ? (
          <EntityCover src={profile.coverUrl} className="rounded-xl" />
        ) : null}
        <div className="flex items-center gap-4">
          <EntityAvatar
            kind={profile.companyId === undefined ? "investor" : "company"}
            name={counterpart}
            src={profile.photoUrl}
            companyId={profile.companyId}
            size="lg"
            decorative
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="cq-title-lg text-(--cq-text-primary)">
              {counterpart}
            </h1>
            <div className="max-sm:hidden">
              <ProfileChips profile={profile} />
            </div>
            {note === undefined ? null : (
              <p className="cq-body-sm text-(--cq-text-secondary)">{note}</p>
            )}
          </div>
        </div>
        {relationship === null ? null : (
          <div className="flex max-w-(--cq-layout-reading) flex-col gap-2">
            {step === null ? null : (
              <ol
                className="grid grid-cols-5 gap-1"
                aria-label="Progress"
                data-journey-step={step}
              >
                {JOURNEY.map((entry, index) => (
                  <li
                    key={entry.label}
                    className="flex flex-col gap-1"
                    aria-current={index + 1 === step ? "step" : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1 rounded-full ${
                        index + 1 < step
                          ? "bg-(--cq-text-secondary)"
                          : index + 1 === step
                            ? "bg-(--cq-accent)"
                            : "bg-(--cq-surface-strong)"
                      }`}
                    />
                    <span
                      className={`cq-caption max-sm:sr-only ${
                        index + 1 === step
                          ? "font-medium text-(--cq-text-primary)"
                          : "text-(--cq-text-tertiary)"
                      }`}
                    >
                      {entry.label}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p
              className="cq-body-sm text-(--cq-text-secondary)"
              data-relationship-state
            >
              <span className="font-medium text-(--cq-text-primary)">
                {STATE_WORDS[relationship.state]}
              </span>
              {step === null ? null : (
                <span className="cq-numeric">
                  {` · ${String(step)} of ${String(JOURNEY.length)}`}
                </span>
              )}
              {action === null ? (
                <span className="max-sm:sr-only">
                  {` · Next: ${NEXT_STEP_WORDS[relationship.nextStep]}`}
                </span>
              ) : null}
            </p>
          </div>
        )}
      </div>
      {action === null ? null : (
        <div className="flex flex-col gap-1.5" data-hero-action>
          <Link
            href={action.href ?? "#"}
            className={buttonClassName(
              action.urgent ? "primary" : "secondary",
              "regular",
              "w-full",
            )}
          >
            {ActionIcon === null ? null : (
              <ActionIcon size={ICON_SIZE.regular} aria-hidden="true" />
            )}
            {action.label}
          </Link>
          {action.why === "" ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {action.why}
            </p>
          )}
        </div>
      )}
    </section>
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

/** The relationship's tabs: real pages and real sections, nothing else. */
export function RelationshipTabs({
  basePath,
  current,
  messageCount,
  diligence = null,
  calls = false,
}: {
  readonly basePath: string;
  readonly current: "OVERVIEW" | "DILIGENCE" | "MESSAGES" | "CALLS";
  /** Null when the chat isn't open: the tab is then not offered. */
  readonly messageCount: number | null;
  /** Offered once diligence started; its count is what waits on this side. */
  readonly diligence?: DiligenceDto | null | undefined;
  /** Offered once connected. */
  readonly calls?: boolean | undefined;
}) {
  const waiting =
    diligence === null
      ? 0
      : diligence.side === "COMPANY"
        ? diligence.requests.filter((r) => r.status === "OPEN").length
        : diligence.shares.filter((share) => share.viewedAt === null).length;
  const tab = (active: boolean) =>
    `cq-body-sm inline-flex min-h-11 items-center gap-2 border-b-2 px-1 ${
      active
        ? "border-(--cq-text-primary) text-(--cq-text-primary)"
        : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
    }`;
  return (
    <nav
      aria-label="Relationship"
      className="flex gap-5 overflow-x-auto border-b border-(--cq-border-subtle)"
    >
      <Link
        href={basePath}
        aria-current={current === "OVERVIEW" ? "page" : undefined}
        className={tab(current === "OVERVIEW")}
      >
        Overview
      </Link>
      {diligence === null ? null : (
        <Link
          href={`${basePath}/diligence`}
          aria-current={current === "DILIGENCE" ? "page" : undefined}
          className={tab(current === "DILIGENCE")}
        >
          Diligence
          {waiting > 0 ? (
            <span className="cq-caption cq-numeric rounded-full bg-(--cq-accent) px-2 text-(--cq-text-inverse)">
              {waiting}
            </span>
          ) : null}
        </Link>
      )}
      {messageCount === null ? null : (
        <Link
          href={`${basePath}/messages`}
          aria-current={current === "MESSAGES" ? "page" : undefined}
          className={tab(current === "MESSAGES")}
        >
          Messages
          {messageCount > 0 ? (
            <span className="cq-caption cq-numeric rounded-full bg-(--cq-surface-subtle) px-2">
              {messageCount}
            </span>
          ) : null}
        </Link>
      )}
      {calls ? (
        <Link
          href={`${basePath}/calls`}
          aria-current={current === "CALLS" ? "page" : undefined}
          className={tab(current === "CALLS")}
        >
          Calls
        </Link>
      ) : null}
    </nav>
  );
}

function ProfileChips({ profile }: { readonly profile: CounterpartProfile }) {
  if (
    profile.location === null &&
    profile.websiteUrl === null &&
    profile.chips.length === 0
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {profile.location === null ? null : (
        <span className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)">
          <MapPin size={ICON_SIZE.compact} aria-hidden="true" />
          {profile.location}
        </span>
      )}
      {profile.websiteUrl === null ? null : (
        <a
          href={profile.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="cq-caption inline-flex min-h-8 items-center gap-1 text-(--cq-text-secondary) underline-offset-4 hover:underline"
        >
          <Globe size={ICON_SIZE.compact} aria-hidden="true" />
          {profile.websiteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
        </a>
      )}
      {profile.chips.map((chip) => (
        <span
          key={chip}
          className="cq-caption rounded-full bg-(--cq-surface-subtle) px-2.5 py-0.5 text-(--cq-text-secondary)"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function Card({
  title,
  id,
  action,
  className,
  collapsible = false,
  count,
  children,
}: {
  readonly title: string;
  readonly id: string;
  readonly action?: ReactNode;
  readonly className?: string | undefined;
  /**
   * Folded on a phone, open on a large screen (design-48 v2: fewer sections
   * above the fold). The large-screen rule shows a closed <details>'s
   * content through ::details-content; a browser without it shows the
   * section folded, one tap from open.
   */
  readonly collapsible?: boolean;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}) {
  const heading = (
    <h2
      id={`relationship-${id}`}
      className="cq-title-sm text-(--cq-text-primary)"
    >
      {title}
      {count === undefined ? null : (
        <span className="cq-numeric font-normal text-(--cq-text-secondary) lg:hidden">
          {` · ${String(count)}`}
        </span>
      )}
    </h2>
  );
  if (collapsible) {
    return (
      <details
        aria-labelledby={`relationship-${id}`}
        className={`group scroll-mt-24 border-t border-(--cq-border-subtle) pt-2 lg:pt-5 lg:[&::details-content]:[content-visibility:visible] ${className ?? ""}`}
        data-collapsible={id}
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 lg:pointer-events-none lg:min-h-0 [&::-webkit-details-marker]:hidden">
          {heading}
          <ChevronDown
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="text-(--cq-text-tertiary) transition-transform group-open:rotate-180 lg:hidden"
          />
        </summary>
        {/* The id is inside the fold so a link to #diligence opens it. */}
        <div id={id} className="flex scroll-mt-24 flex-col gap-4 pt-3 lg:pt-4">
          {children}
        </div>
      </details>
    );
  }
  return (
    <section
      aria-labelledby={`relationship-${id}`}
      className={`flex scroll-mt-24 flex-col gap-4 border-t border-(--cq-border-subtle) pt-5 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        {heading}
        {action}
      </div>
      {children}
    </section>
  );
}

export function BackToRelationships({
  href = "/relationships",
  label = "All relationships",
}: {
  readonly href?: string;
  readonly label?: string;
}) {
  return (
    <Link
      href={href}
      className={buttonClassName("quiet", "regular", "-ml-4 self-start")}
    >
      <ArrowLeft size={ICON_SIZE.regular} aria-hidden="true" />
      {label}
    </Link>
  );
}

/** A page that cannot answer for this person: one calm sentence. */
export function RelationshipUnavailable({
  sentence,
}: {
  readonly sentence: string;
}) {
  return (
    <PageContainer className="flex flex-col gap-6">
      <BackToRelationships />
      <h1 className="cq-title-xl text-(--cq-text-primary)">Relationship</h1>
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {sentence}
      </p>
    </PageContainer>
  );
}
