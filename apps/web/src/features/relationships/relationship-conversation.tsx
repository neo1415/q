import "server-only";

import Link from "next/link";

import { listReminders } from "@capital-q/api-client";
import type {
  ChatThreadDto,
  RelationshipStatusDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  ICON_SIZE,
} from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipChat } from "@/features/chat/relationship-chat";
import { apiSession } from "@/features/q/context";

import { AskQRelationshipPanel } from "./ask-q-relationship";
import {
  BackToRelationships,
  RelationshipHero,
  RelationshipTabs,
} from "./relationship-detail";
import type { CounterpartProfile } from "./relationship-page-data";
import { RelationshipTimeline } from "./relationship-timeline";
import {
  formatRelationshipDate,
  NEXT_STEP_WORDS,
  type RelationshipSide,
  STATE_WORDS,
} from "./relationship-words";

/**
 * The conversation with a counterpart (founder design 2026-09-28,
 * Relationship conversation): the chat (R34) at full size, with the
 * relationship beside it -- where it stands, what happened, the next
 * reminder, and Q with a few starting questions. Only what is built:
 * the header offers their profile and booking a call; the chat keeps its
 * own attach, voice-note, Ask Q and safety controls.
 */
export async function RelationshipConversation({
  side,
  counterpart,
  relationship,
  profile,
  thread,
  basePath,
}: {
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto;
  readonly profile: CounterpartProfile;
  readonly thread: ChatThreadDto | null;
  readonly basePath: string;
}) {
  const connected = relationship.state === "CONNECTED";
  const session = await apiSession();
  const nextReminder =
    session === null
      ? undefined
      : (await listReminders(session).catch(() => ({ items: [] }))).items
          .filter(
            (reminder) =>
              reminder.relationshipId === relationship.relationshipId &&
              reminder.status === "PENDING",
          )
          .toSorted((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
          .at(0);

  return (
    <PageContainer>
      <BackToRelationships href={basePath} label={counterpart} />
      <RelationshipHero
        counterpart={counterpart}
        relationship={relationship}
        profile={profile}
      />
      <div className="flex flex-wrap gap-2">
        {profile.profileHref === null ? null : (
          <Link
            href={profile.profileHref}
            className={buttonClassName("secondary", "compact")}
          >
            Open profile
            <ArrowUpRight size={ICON_SIZE.compact} aria-hidden="true" />
          </Link>
        )}
        {connected ? (
          <Link
            href={`${basePath}#calls`}
            className={buttonClassName("secondary", "compact")}
          >
            <CalendarDays size={ICON_SIZE.compact} aria-hidden="true" />
            Book a call
          </Link>
        ) : null}
      </div>
      <RelationshipTabs
        basePath={basePath}
        current="MESSAGES"
        messageCount={connected ? (thread?.messages.length ?? 0) : null}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <RelationshipChat
            relationshipId={relationship.relationshipId}
            counterpart={counterpart}
            initial={thread}
          />
        </div>

        <aside
          className="flex min-w-0 flex-col gap-6"
          aria-label="About this relationship"
        >
          <RailCard title="About this relationship">
            <dl className="flex flex-col gap-3">
              <RailFact
                label="Status"
                value={STATE_WORDS[relationship.state]}
              />
              <RailFact
                label="Since"
                value={formatRelationshipDate(relationship.stateSince)}
              />
              <RailFact
                label="Next step"
                value={NEXT_STEP_WORDS[relationship.nextStep]}
              />
            </dl>
          </RailCard>

          {relationship.milestones.length === 0 ? null : (
            <RailCard title="Relationship timeline">
              <RelationshipTimeline
                milestones={relationship.milestones}
                side={side}
                counterpart={counterpart}
              />
            </RailCard>
          )}

          <RailCard title="Next reminder">
            {nextReminder === undefined ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                No reminder set.
              </p>
            ) : (
              <p className="cq-body-sm text-(--cq-text-primary)">
                <time
                  dateTime={nextReminder.dueAt}
                  className="cq-numeric text-(--cq-text-tertiary)"
                >
                  {formatRelationshipDate(nextReminder.dueAt)}
                </time>{" "}
                · {nextReminder.title}
              </p>
            )}
            <Link
              href={`${basePath}#reminders`}
              className={buttonClassName(
                "quiet",
                "compact",
                "-ml-2 self-start",
              )}
            >
              <Bell size={ICON_SIZE.compact} aria-hidden="true" />
              {nextReminder === undefined
                ? "Set a reminder"
                : "Manage reminders"}
            </Link>
          </RailCard>

          <AskQRelationshipPanel counterpart={counterpart} />
        </aside>
      </div>
    </PageContainer>
  );
}

function RailCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
    >
      <h2 className="cq-body font-semibold text-(--cq-text-primary)">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RailFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="cq-caption text-(--cq-text-tertiary)">{label}</dt>
      <dd className="cq-body-sm text-right text-(--cq-text-primary)">
        {value}
      </dd>
    </div>
  );
}
