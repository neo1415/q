"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { useDirty } from "@/features/workspace/workspace-screen";

import type {
  MeetingDto,
  MeetingSlot,
  ReminderDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

import {
  bookMeetingAction,
  cancelMeetingAction,
  createReminderAction,
  dismissReminderAction,
  findSlotsAction,
} from "./schedule-actions";
import { JOINED_MESSAGE, JoinCallForm } from "./join-call-form";
import { MeetingQ } from "./meeting-q";
import { QSwarm } from "@/features/q-swarm/q-swarm";
import { useT } from "@/features/i18n/language";
import type { ApprovalPayload } from "@/features/q/control/approval";
import { useQControl } from "@/features/q/control/q-control";

/**
 * The relationship page's calls and reminders (BIZ-008). The same things Q
 * does when asked ("set up a call with them next week", "remind me Friday
 * to follow up"), done by hand: three free times from the person's own
 * calendar, one chosen and confirmed, then a Google Calendar invite with a
 * Meet link to the other side; reminders that arrive in Needs you and by
 * email. Confirming the exact time and purpose shown is the approval.
 */

function localZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * A meeting or reminder time in the reader's zone, in en-GB like the rest
 * of the app; the year is named when it is not this year (break-it sweep
 * 2026-10-03: "Wed, 1 Jan" for 2025).
 */
export function when(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** A local "YYYY-MM-DDTHH:mm" for the datetime input. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function atNine(from: number, days: number): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return localInput(date);
}

/** One tap for the usual "when" (founder live 2026-09-29: flow, not forms). */
const QUICK_WHEN: readonly {
  readonly label: string;
  readonly at: (from: number) => string;
}[] = [
  { label: "In an hour", at: (from) => localInput(new Date(from + 3_600_000)) },
  { label: "Tomorrow 9:00", at: (from) => atNine(from, 1) },
  { label: "In 3 days", at: (from) => atNine(from, 3) },
  { label: "Next week", at: (from) => atNine(from, 7) },
];

function newKey(): string {
  return `web-${crypto.randomUUID()}`;
}

export function RelationshipScheduleControls({
  relationshipId,
  counterpart,
  connected,
  initialMeetings,
  initialReminders,
  focus = "all",
}: {
  /** Which job the surface opened for (founder live 2026-09-29: one flow each). */
  readonly focus?: "call" | "reminder" | "all" | undefined;
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly connected: boolean;
  readonly initialMeetings: readonly MeetingDto[];
  readonly initialReminders: readonly ReminderDto[];
}) {
  const t = useT();
  const [meetings, setMeetings] = useState(initialMeetings);
  const [reminders, setReminders] = useState(initialReminders);
  const [slots, setSlots] = useState<readonly MeetingSlot[] | null>(null);
  const [chosen, setChosen] = useState<MeetingSlot | null>(null);
  const [purpose, setPurpose] = useState(`Call with ${counterpart}`);
  const [bookKey, setBookKey] = useState(newKey);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [byEmail, setByEmail] = useState(true);
  // W5.4: a reminder being written is unsaved work.
  useDirty(reminderTitle.trim() !== "");
  const [reminderKey, setReminderKey] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [pending, startTransition] = useTransition();
  // When the page was opened: whether a call is over is read once, not
  // on every render.
  const [openedAt] = useState(() => Date.now());

  const upcoming = meetings.filter((meeting) => meeting.status === "SCHEDULED");

  const findTimes = () =>
    startTransition(async () => {
      setMessage(null);
      // Opening the dialog runs this by itself: a dropped request shows a
      // message, never the page's error screen (v5 look, 15 Oct).
      const found = await findSlotsAction(
        relationshipId,
        30,
        localZone(),
      ).catch(() => ({
        ok: false as const,
        message: "Couldn't find times. Try again.",
      }));
      if (!found.ok) {
        setMessage(found.message);
        return;
      }
      setSlots(found.value.slots);
      if (found.value.slots.length === 0) {
        setMessage("No free time in the next week. Try again later.");
      }
    });

  // "Book a call" opens on your free times, not on a button to find them.
  const autoFound = useRef(false);
  const findTimesRef = useRef(findTimes);
  useEffect(() => {
    findTimesRef.current = findTimes;
  });
  useEffect(() => {
    if (focus !== "call" || !connected || autoFound.current) return;
    autoFound.current = true;
    findTimesRef.current();
  }, [focus, connected]);

  const bookSlot = async (
    slot: MeetingSlot,
    topic: string,
    key: string,
  ): Promise<boolean> => {
    const booked = await bookMeetingAction({
      relationshipId,
      purpose: topic,
      startsAt: slot.startsAt,
      durationMinutes: Math.round(
        (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000,
      ),
      timeZone: localZone(),
      idempotencyKey: key,
    });
    if (!booked.ok) {
      setMessage(booked.message);
      return false;
    }
    setMeetings((current) => [
      booked.value,
      ...current.filter((meeting) => meeting.id !== booked.value.id),
    ]);
    setSlots(null);
    setChosen(null);
    setBookKey(newKey());
    setMessage(`Invite sent to ${counterpart}.`);
    return true;
  };
  const book = () =>
    startTransition(async () => {
      if (chosen === null) return;
      await bookSlot(chosen, purpose, bookKey);
    });

  const cancelCall = async (meetingId: string): Promise<boolean> => {
    const cancelled = await cancelMeetingAction(meetingId);
    if (!cancelled.ok) {
      setMessage(cancelled.message);
      return false;
    }
    setMeetings((current) =>
      current.map((meeting) =>
        meeting.id === meetingId
          ? { ...meeting, status: "CANCELLED" }
          : meeting,
      ),
    );
    setMessage("Cancelled. Everyone invited has been told.");
    return true;
  };
  const cancel = (meetingId: string) =>
    startTransition(async () => {
      await cancelCall(meetingId);
    });

  // W5.1b (plan §5): scheduling, as Q may operate it. Finding free times
  // only reads the person's own calendar (NONE). Sending an invite or
  // cancelling a call reaches the other side (APPROVAL, on the exact time
  // and topic). A reminder is the person's own, reversible (CONFIRM).
  const findRef = useRef<HTMLSpanElement>(null);
  const bookRef = useRef<HTMLSpanElement>(null);
  const cancelRef = useRef<HTMLSpanElement>(null);
  const remindRef = useRef<HTMLSpanElement>(null);
  // The slot Q would book: the person's choice, else the first free one
  // (shown in full for their approval, so the time is theirs to accept).
  const slotForQ = chosen ?? slots?.[0] ?? null;
  // The call Q would cancel: the next one the person organised, not over.
  const cancellable =
    upcoming.find(
      (meeting) =>
        meeting.organisedByYou && Date.parse(meeting.endsAt) >= openedAt,
    ) ?? null;
  useQControl({
    id: "button.schedule-find",
    kind: "BUTTON",
    ref: findRef,
    approval: "NONE",
  });
  useQControl({
    id: "button.meeting-book",
    kind: "BUTTON",
    ref: bookRef,
    approval: "APPROVAL",
    action: {
      id: "button.meeting-book",
      summary: (payload) =>
        `Send ${counterpart} an invite for ${String(payload["when"])}`,
      prepare: (): ApprovalPayload | null =>
        slotForQ === null || purpose.trim() === ""
          ? null
          : {
              with: counterpart,
              when: when(slotForQ.startsAt),
              startsAt: slotForQ.startsAt,
              topic: purpose.trim(),
            },
      execute: async (payload, key) =>
        slotForQ !== null &&
        slotForQ.startsAt === payload["startsAt"] &&
        (await bookSlot(slotForQ, String(payload["topic"]), key))
          ? "DONE"
          : "FAILED",
    },
  });
  useQControl({
    id: "button.meeting-cancel",
    kind: "BUTTON",
    ref: cancelRef,
    approval: "APPROVAL",
    action: {
      id: "button.meeting-cancel",
      summary: (payload) =>
        `Cancel the call with ${counterpart} on ${String(payload["when"])}: everyone invited is told`,
      prepare: (): ApprovalPayload | null =>
        cancellable === null
          ? null
          : {
              with: counterpart,
              when: when(cancellable.startsAt),
              call: cancellable.purpose,
              meeting: cancellable.id,
            },
      execute: async (payload) =>
        cancellable !== null &&
        cancellable.id === payload["meeting"] &&
        (await cancelCall(cancellable.id))
          ? "DONE"
          : "FAILED",
    },
  });
  useQControl({
    id: "button.reminder-set",
    kind: "BUTTON",
    ref: remindRef,
    approval: "CONFIRM",
    confirmSummary: () =>
      `Set a reminder: ${reminderTitle.trim() === "" ? `Follow up with ${counterpart}` : reminderTitle.trim()}`,
  });

  const remind = () =>
    startTransition(async () => {
      const due = new Date(reminderAt);
      if (Number.isNaN(due.getTime())) {
        setMessage("Pick when.");
        return;
      }
      const created = await createReminderAction({
        title:
          reminderTitle.trim() === ""
            ? `Follow up with ${counterpart}`
            : reminderTitle,
        dueAt: due.toISOString(),
        relationshipId,
        byEmail,
        idempotencyKey: reminderKey,
      });
      if (!created.ok) {
        setMessage(created.message);
        return;
      }
      setReminders((current) => [
        ...current.filter((reminder) => reminder.id !== created.value.id),
        created.value,
      ]);
      setReminderTitle("");
      setReminderAt("");
      setReminderKey(newKey());
      setMessage("Reminder set.");
    });

  const dismiss = (reminderId: string) =>
    startTransition(async () => {
      const done = await dismissReminderAction(reminderId);
      if (!done.ok) {
        setMessage(done.message);
        return;
      }
      setReminders((current) => current.filter((r) => r.id !== reminderId));
    });

  return (
    <section
      aria-labelledby="relationship-schedule"
      className="flex max-w-(--cq-layout-reading) flex-col gap-6"
      data-relationship-schedule
    >
      <h2 id="relationship-schedule" className="sr-only">
        {t("Calls and reminders")}
      </h2>

      {focus === "reminder" ? null : (
        <div className="flex flex-col gap-3">
          {upcoming.length === 0 ? null : (
            <ul className="flex flex-col gap-3" data-meetings>
              {upcoming.map((meeting) => (
                <li key={meeting.id} className="flex flex-col gap-1">
                  <time
                    dateTime={meeting.startsAt}
                    className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                    suppressHydrationWarning
                  >
                    {when(meeting.startsAt)}
                  </time>
                  <span className="cq-body text-(--cq-text-primary)">
                    {meeting.purpose}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {meeting.organisedByYou
                      ? `You invited ${meeting.attendees.join(", ") || counterpart}`
                      : `${meeting.organiserName} invited you`}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {meeting.meetLink === null ||
                    Date.parse(meeting.endsAt) < openedAt ? null : (
                      <a
                        href={meeting.meetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClassName("secondary", "compact")}
                      >
                        {t("Join Google Meet")}
                      </a>
                    )}
                    {meeting.organisedByYou &&
                    Date.parse(meeting.endsAt) >= openedAt ? (
                      <span
                        ref={
                          meeting.id === cancellable?.id ? cancelRef : undefined
                        }
                        className="contents"
                      >
                        <Button
                          variant="quiet"
                          size="compact"
                          disabled={pending}
                          onClick={() => cancel(meeting.id)}
                        >
                          {t("Cancel call")}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  {meeting.meetLink !== null ? (
                    <MeetingQ
                      meetingId={meeting.id}
                      ended={Date.parse(meeting.endsAt) < openedAt}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {!connected ? null : joining ? (
            <JoinCallForm
              relationshipId={relationshipId}
              counterpart={counterpart}
              onCancel={() => setJoining(false)}
              onJoined={(joined) => {
                setMeetings((current) => [
                  joined,
                  ...current.filter((meeting) => meeting.id !== joined.id),
                ]);
                setJoining(false);
                setMessage(JOINED_MESSAGE);
              }}
            />
          ) : (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => setJoining(true)}
              className="self-start"
            >
              {t("Have Q join a call")}
            </Button>
          )}

          {!connected ? (
            <p className="cq-caption text-(--cq-text-secondary)">
              Calls open once you&apos;re connected with {counterpart}.
            </p>
          ) : slots === null ? (
            pending ? (
              <div className="flex items-center gap-3" role="status">
                <QSwarm state="WORKING" pixels={40} />
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {t("Looking at your calendar…")}
                </span>
              </div>
            ) : (
              <span ref={findRef} className="contents">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={findTimes}
                  className="self-start"
                >
                  {t("Find a time")}
                </Button>
              </span>
            )
          ) : (
            <span ref={bookRef} className="contents">
              <fieldset className="flex flex-col gap-3" data-slots>
                <legend className="cq-label text-(--cq-text-secondary)">
                  Free in your calendar (30 minutes)
                </legend>
                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <Button
                      key={slot.startsAt}
                      variant={
                        chosen?.startsAt === slot.startsAt
                          ? "primary"
                          : "secondary"
                      }
                      size="compact"
                      aria-pressed={chosen?.startsAt === slot.startsAt}
                      onClick={() => setChosen(slot)}
                    >
                      <span suppressHydrationWarning>
                        {when(slot.startsAt)}
                      </span>
                    </Button>
                  ))}
                </div>
                {chosen === null ? null : (
                  <div className="flex flex-col items-start gap-2">
                    <Button
                      variant="primary"
                      disabled={pending || purpose.trim() === ""}
                      onClick={book}
                    >
                      <span suppressHydrationWarning>
                        Send invite · {when(chosen.startsAt)}
                      </span>
                    </Button>
                    <details className="cq-caption text-(--cq-text-secondary)">
                      <summary className="cursor-pointer">
                        Topic: {purpose}
                      </summary>
                      <div className="pt-2">
                        <Input
                          id="meeting-purpose"
                          label={t("What the call is for")}
                          value={purpose}
                          maxLength={500}
                          onChange={(event) => setPurpose(event.target.value)}
                        />
                      </div>
                    </details>
                  </div>
                )}
              </fieldset>
            </span>
          )}
        </div>
      )}

      {focus === "call" ? null : (
        <div className="flex flex-col gap-3">
          {reminders.length === 0 ? null : (
            <ul className="flex flex-col gap-2" data-reminders>
              {reminders.map((reminder) => (
                <li
                  key={reminder.id}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <span className="cq-body text-(--cq-text-primary)">
                    {reminder.title}{" "}
                    <time
                      dateTime={reminder.dueAt}
                      className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                      suppressHydrationWarning
                    >
                      {when(reminder.dueAt)}
                    </time>
                  </span>
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={pending}
                    onClick={() => dismiss(reminder.id)}
                  >
                    {t("Done")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2" data-remind-form>
            <Input
              id="reminder-title"
              label={t("Remind me to")}
              placeholder={`Follow up with ${counterpart}`}
              value={reminderTitle}
              maxLength={200}
              onChange={(event) => setReminderTitle(event.target.value)}
            />
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("When")}
            >
              {QUICK_WHEN.map((quick) => (
                <Button
                  key={quick.label}
                  variant={
                    reminderAt === quick.at(openedAt) ? "primary" : "secondary"
                  }
                  size="compact"
                  onClick={() => setReminderAt(quick.at(openedAt))}
                >
                  {quick.label}
                </Button>
              ))}
            </div>
            <Input
              id="reminder-at"
              label={t("Or pick a time")}
              type="datetime-local"
              value={reminderAt}
              onChange={(event) => setReminderAt(event.target.value)}
            />
            <label className="cq-body flex min-h-11 items-center gap-2 text-(--cq-text-primary)">
              <input
                type="checkbox"
                checked={byEmail}
                onChange={(event) => setByEmail(event.target.checked)}
              />
              {t("Email me too")}
            </label>
            <span ref={remindRef} className="contents">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={remind}
                className="self-start"
              >
                {t("Set reminder")}
              </Button>
            </span>
          </div>
        </div>
      )}

      {message === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </section>
  );
}
