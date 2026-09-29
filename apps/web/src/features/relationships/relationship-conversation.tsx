import "server-only";

import Link from "next/link";

import { listReminders } from "@capital-q/api-client";
import type {
  ChatThreadDto,
  RelationshipStatusDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ICON_SIZE,
} from "@capital-q/ui/icons";

import { RelationshipChat } from "@/features/chat/relationship-chat";
import { apiSession } from "@/features/q/context";

import { InfoDialog } from "./info-dialog";
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

  // The chat page is a chat (founder direction 2026-09-29: "whatsapp for
  // that page"): one full-height column, the header carrying who and the
  // few actions, everything else one tap away in the info sheet.
  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] w-full max-w-3xl flex-col lg:h-[calc(100dvh-1rem)]">
      <RelationshipChat
        relationshipId={relationship.relationshipId}
        counterpart={counterpart}
        initial={thread}
        tall
        headerStart={
          <>
            <Link
              href={basePath}
              aria-label={`Back to ${counterpart}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
            >
              <ArrowLeft size={ICON_SIZE.regular} aria-hidden="true" />
            </Link>
            <ChatAvatar name={counterpart} photoUrl={profile.photoUrl} />
            <span className="flex min-w-0 flex-col">
              <span className="cq-body truncate font-semibold text-(--cq-text-primary)">
                {counterpart}
              </span>
              <span className="cq-caption truncate text-(--cq-text-secondary)">
                {STATE_WORDS[relationship.state]}
              </span>
            </span>
          </>
        }
        headerEnd={
          <>
            {connected ? (
              <Link
                href={`${basePath}#calls`}
                aria-label="Book a call"
                className="flex size-11 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
              >
                <CalendarDays size={ICON_SIZE.regular} aria-hidden="true" />
              </Link>
            ) : null}
            <InfoDialog title={`About ${counterpart}`}>
              <div className="flex flex-col gap-5">
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
                  {nextReminder === undefined ? null : (
                    <RailFact
                      label="Reminder"
                      value={`${formatRelationshipDate(nextReminder.dueAt)} · ${nextReminder.title}`}
                    />
                  )}
                </dl>
                <div className="flex flex-wrap gap-2">
                  {profile.profileHref === null ? null : (
                    <Link
                      href={profile.profileHref}
                      className={buttonClassName("secondary", "compact")}
                    >
                      Profile
                      <ArrowUpRight
                        size={ICON_SIZE.compact}
                        aria-hidden="true"
                      />
                    </Link>
                  )}
                  <Link
                    href={`${basePath}#reminders`}
                    className={buttonClassName("secondary", "compact")}
                  >
                    <Bell size={ICON_SIZE.compact} aria-hidden="true" />
                    Reminder
                  </Link>
                </div>
                {relationship.milestones.length === 0 ? null : (
                  <RelationshipTimeline
                    milestones={relationship.milestones}
                    side={side}
                    counterpart={counterpart}
                  />
                )}
              </div>
            </InfoDialog>
          </>
        }
      />
    </div>
  );
}

/** The counterpart's picture or initial, chat-sized. */
function ChatAvatar({
  name,
  photoUrl,
}: {
  readonly name: string;
  readonly photoUrl: string | null;
}) {
  return photoUrl === null ? (
    <span
      aria-hidden="true"
      className="cq-label inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  ) : (
    // A short-lived signed URL; next/image would cache it past expiry.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt=""
      width={40}
      height={40}
      className="size-10 shrink-0 rounded-full object-cover"
    />
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
