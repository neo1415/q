import Link from "next/link";
import type { ReactNode } from "react";

import type {
  ChatThreadDto,
  RelationshipStatusDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowLeft,
  ArrowUpRight,
  Globe,
  ICON_SIZE,
  MapPin,
  MessageSquare,
} from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipMail } from "@/features/integrations/relationship-mail";
import { initials } from "@/features/investors/investor-labels";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";

import { ScheduleDialog } from "./schedule-dialog";

import { AskQAboutRelationship } from "./relationship-actions";
import type { CounterpartProfile } from "./relationship-page-data";
import { StatusPill } from "./status-pill";
import { RelationshipTimeline } from "./relationship-timeline";
import {
  NEXT_STEP_WORDS,
  type RelationshipSide,
  STATE_WORDS,
} from "./relationship-words";

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
  basePath,
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
  /** This relationship's own page, e.g. /relationships/company/{id}. */
  readonly basePath: string;
}) {
  const connected = relationship?.state === "CONNECTED";
  const messageCount = thread?.messages.length ?? 0;
  return (
    <PageContainer className="flex flex-col gap-6">
      <BackToRelationships />
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
        note={relationship === null ? absentSentence : undefined}
      />

      <RelationshipTabs
        basePath={basePath}
        current="OVERVIEW"
        messageCount={connected ? messageCount : null}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {relationship === null ||
          relationship.milestones.length === 0 ? null : (
            <Card title="What happened" id="history">
              <RelationshipTimeline
                milestones={relationship.milestones}
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

        <aside
          className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start"
          aria-label="Next"
        >
          <Card title="Next" id="next">
            <div className="flex flex-col items-stretch gap-2">
              {actions}
              {connected ? (
                <Link
                  href={`${basePath}/messages`}
                  className={buttonClassName(
                    actions === null ? "primary" : "secondary",
                  )}
                >
                  <MessageSquare size={ICON_SIZE.regular} aria-hidden="true" />
                  Send a message
                </Link>
              ) : null}
              {relationship === null ? null : (
                <>
                  {connected ? (
                    <ScheduleDialog kind="call">
                      <RelationshipSchedule
                        relationshipId={relationship.relationshipId}
                        counterpart={counterpart}
                        connected={connected}
                        focus="call"
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
                </>
              )}
            </div>
          </Card>

          <Card
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
              className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-4"
            >
              <AskQAboutRelationship counterpart={counterpart} />
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}

/** The top of both relationship pages: who, where, and where it stands. */
export function RelationshipHero({
  counterpart,
  relationship,
  profile,
  note,
}: {
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  readonly profile: CounterpartProfile;
  /** Said under the name when nothing is on record. */
  readonly note?: string | undefined;
}) {
  return (
    <section
      aria-label={`${counterpart} at a glance`}
      className="cq-glow-card flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:p-6"
      data-relationship-hero
    >
      <Avatar name={counterpart} photoUrl={profile.photoUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="cq-title-lg text-(--cq-text-primary)">{counterpart}</h1>
        <ProfileChips profile={profile} />
        {note === undefined ? null : (
          <p className="cq-body-sm text-(--cq-text-secondary)">{note}</p>
        )}
      </div>
      {relationship === null ? null : (
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <StatusPill
            tone={
              relationship.state === "CONNECTED"
                ? "positive"
                : relationship.state === "INTEREST_EXPRESSED"
                  ? "waiting"
                  : "neutral"
            }
          >
            {STATE_WORDS[relationship.state]}
          </StatusPill>
          <span className="cq-caption text-(--cq-text-tertiary)">
            Next: {NEXT_STEP_WORDS[relationship.nextStep]}
          </span>
        </div>
      )}
    </section>
  );
}

/** The relationship's tabs: real pages and real sections, nothing else. */
export function RelationshipTabs({
  basePath,
  current,
  messageCount,
}: {
  readonly basePath: string;
  readonly current: "OVERVIEW" | "MESSAGES";
  /** Null when the chat isn't open: the tab is then not offered. */
  readonly messageCount: number | null;
}) {
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
          {profile.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
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

function Avatar({
  name,
  photoUrl,
}: {
  readonly name: string;
  readonly photoUrl: string | null;
}) {
  return photoUrl === null ? (
    <span
      aria-hidden="true"
      className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) text-lg font-semibold text-(--cq-text-secondary)"
    >
      {initials(name)}
    </span>
  ) : (
    // A short-lived signed URL; next/image would cache it past expiry.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt=""
      width={56}
      height={56}
      className="size-14 shrink-0 rounded-xl object-cover"
    />
  );
}

function Card({
  title,
  id,
  action,
  children,
}: {
  readonly title: string;
  readonly id: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`relationship-${id}`}
      className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`relationship-${id}`}
          className="cq-title-sm text-(--cq-text-primary)"
        >
          {title}
        </h2>
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
