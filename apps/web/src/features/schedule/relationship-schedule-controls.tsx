"use client";

import { useState, useTransition } from "react";

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

function when(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function newKey(): string {
  return `web-${crypto.randomUUID()}`;
}

export function RelationshipScheduleControls({
  relationshipId,
  counterpart,
  connected,
  initialMeetings,
  initialReminders,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly connected: boolean;
  readonly initialMeetings: readonly MeetingDto[];
  readonly initialReminders: readonly ReminderDto[];
}) {
  const [meetings, setMeetings] = useState(initialMeetings);
  const [reminders, setReminders] = useState(initialReminders);
  const [slots, setSlots] = useState<readonly MeetingSlot[] | null>(null);
  const [chosen, setChosen] = useState<MeetingSlot | null>(null);
  const [purpose, setPurpose] = useState(`Call with ${counterpart}`);
  const [bookKey, setBookKey] = useState(newKey);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [byEmail, setByEmail] = useState(true);
  const [reminderKey, setReminderKey] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upcoming = meetings.filter(
    (meeting) =>
      meeting.status === "SCHEDULED" &&
      Date.parse(meeting.endsAt) > Date.now() - 3_600_000,
  );

  const findTimes = () =>
    startTransition(async () => {
      setMessage(null);
      const found = await findSlotsAction(relationshipId, 30, localZone());
      if (!found.ok) {
        setMessage(found.message);
        return;
      }
      setSlots(found.value.slots);
      if (found.value.slots.length === 0) {
        setMessage("No free time in the next week. Try again later.");
      }
    });

  const book = () =>
    startTransition(async () => {
      if (chosen === null) return;
      const booked = await bookMeetingAction({
        relationshipId,
        purpose,
        startsAt: chosen.startsAt,
        durationMinutes: Math.round(
          (Date.parse(chosen.endsAt) - Date.parse(chosen.startsAt)) / 60_000,
        ),
        timeZone: localZone(),
        idempotencyKey: bookKey,
      });
      if (!booked.ok) {
        setMessage(booked.message);
        return;
      }
      setMeetings((current) => [
        booked.value,
        ...current.filter((meeting) => meeting.id !== booked.value.id),
      ]);
      setSlots(null);
      setChosen(null);
      setBookKey(newKey());
      setMessage(`Invite sent to ${counterpart}.`);
    });

  const cancel = (meetingId: string) =>
    startTransition(async () => {
      const cancelled = await cancelMeetingAction(meetingId);
      if (!cancelled.ok) {
        setMessage(cancelled.message);
        return;
      }
      setMeetings((current) =>
        current.map((meeting) =>
          meeting.id === meetingId
            ? { ...meeting, status: "CANCELLED" }
            : meeting,
        ),
      );
      setMessage("Cancelled. Everyone invited has been told.");
    });

  const remind = () =>
    startTransition(async () => {
      const due = new Date(reminderAt);
      if (reminderTitle.trim() === "" || Number.isNaN(due.getTime())) {
        setMessage("Say what to remind you of, and when.");
        return;
      }
      const created = await createReminderAction({
        title: reminderTitle,
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
      <h2
        id="relationship-schedule"
        className="cq-title-sm text-(--cq-text-primary)"
      >
        Calls and reminders
      </h2>

      <div className="flex flex-col gap-3">
        {upcoming.length === 0 ? (
          <p className="cq-body text-(--cq-text-secondary)">
            No calls booked with {counterpart}.
          </p>
        ) : (
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
                  {meeting.meetLink === null ? null : (
                    <a
                      href={meeting.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClassName("secondary", "compact")}
                    >
                      Join Google Meet
                    </a>
                  )}
                  {meeting.organisedByYou ? (
                    <Button
                      variant="quiet"
                      size="compact"
                      disabled={pending}
                      onClick={() => cancel(meeting.id)}
                    >
                      Cancel call
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!connected ? (
          <p className="cq-caption text-(--cq-text-secondary)">
            Calls open once you&apos;re connected with {counterpart}.
          </p>
        ) : slots === null ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={findTimes}
            className="self-start"
          >
            Find a time
          </Button>
        ) : (
          <fieldset className="flex flex-col gap-3" data-slots>
            <legend className="cq-label text-(--cq-text-secondary)">
              Free in your calendar (30 minutes)
            </legend>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <Button
                  key={slot.startsAt}
                  variant={
                    chosen?.startsAt === slot.startsAt ? "primary" : "secondary"
                  }
                  size="compact"
                  aria-pressed={chosen?.startsAt === slot.startsAt}
                  onClick={() => setChosen(slot)}
                >
                  <span suppressHydrationWarning>{when(slot.startsAt)}</span>
                </Button>
              ))}
            </div>
            {chosen === null ? null : (
              <>
                <Input
                  id="meeting-purpose"
                  label="What the call is for"
                  value={purpose}
                  maxLength={500}
                  onChange={(event) => setPurpose(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={pending || purpose.trim() === ""}
                    onClick={book}
                  >
                    Send invite
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setSlots(null);
                      setChosen(null);
                    }}
                  >
                    Not now
                  </Button>
                </div>
                <p className="cq-caption text-(--cq-text-secondary)">
                  A Google Calendar invite with a Meet link goes from your
                  calendar to {counterpart}&apos;s people.
                </p>
              </>
            )}
          </fieldset>
        )}
      </div>

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
                  Done
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2" data-remind-form>
          <Input
            id="reminder-title"
            label="Remind me to"
            placeholder="Follow up"
            value={reminderTitle}
            maxLength={200}
            onChange={(event) => setReminderTitle(event.target.value)}
          />
          <Input
            id="reminder-at"
            label="When"
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
            Email me too
          </label>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={remind}
            className="self-start"
          >
            Set reminder
          </Button>
        </div>
      </div>

      {message === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </section>
  );
}
