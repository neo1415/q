"use client";

import {
  useEffect,
  useId,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import type { MeetingDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ChevronLeft, ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { payloadFingerprint } from "@/features/relationships/relationship-deal";
import {
  QLine,
  RecordSheet,
  TILE,
} from "@/features/relationships/record-parts";
import { useT } from "@/features/i18n/language";

import { MeetingQ } from "./meeting-q";
import {
  bookMeetingAction,
  cancelMeetingAction,
  meetingBriefAction,
  weekAvailabilityAction,
} from "./schedule-actions";

/**
 * Calls on the person's week (CRM prototype, calls option 2, owner
 * 2026-10-20, warm charcoal). Monday to Friday, nine to five, from their
 * own calendar: a booked call with this relationship is a solid block,
 * busy time is hatched and only says "Busy" (never what it is), and a free
 * hour offers itself under the pointer. Proposing one opens the exact
 * invite -- when, how long, what for -- and nothing is sent until the
 * person presses Send invite, under a key made from exactly that invite,
 * so a retried press invites once. On a phone: one day at a time.
 */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
const DAYS = 5;

type Busy = { readonly start: number; readonly end: number };

function localZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Monday 00:00 of the week to show: this one, or next on a weekend. */
export function weekStart(now: Date, offset = 0): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (day.getDay() + 6) % 7; // Monday 0 … Sunday 6
  day.setDate(day.getDate() - weekday + (weekday >= 5 ? 7 : 0) + offset * 7);
  return day;
}

export type SlotKind = "booked" | "busy" | "past" | "free";

/** What one hour of the week is, from the calls and the busy times. */
export function slotKind(
  start: number,
  end: number,
  meetings: readonly MeetingDto[],
  busy: readonly Busy[] | null,
  now: number,
): { readonly kind: SlotKind; readonly meeting: MeetingDto | null } {
  const meeting =
    meetings.find(
      (m) =>
        m.status !== "CANCELLED" &&
        m.status !== "FAILED" &&
        Date.parse(m.startsAt) < end &&
        Date.parse(m.endsAt) > start,
    ) ?? null;
  if (meeting !== null) return { kind: "booked", meeting };
  if (end <= now || start < now) return { kind: "past", meeting: null };
  if (busy === null) return { kind: "past", meeting: null };
  return busy.some((b) => b.start < end && b.end > start)
    ? { kind: "busy", meeting: null }
    : { kind: "free", meeting: null };
}

const DAY_HEAD = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const minutes = (m: MeetingDto) =>
  Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000);

export function CallsWeek({
  relationshipId,
  counterpart,
  initialMeetings,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly initialMeetings: readonly MeetingDto[];
}) {
  const t = useT();
  const [meetings, setMeetings] = useState(initialMeetings);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState<readonly Busy[] | null>(null);
  const [calendar, setCalendar] = useState<
    "LOADING" | "READ" | { readonly message: string }
  >("LOADING");
  const [day, setDay] = useState(0);
  const [proposing, setProposing] = useState<number | null>(null);
  const [open, setOpen] = useState<MeetingDto | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // The week is the reader's own, in their own zone: decided in the browser.
  useEffect(() => {
    const at = Date.now();
    setNow(at);
    const today = (new Date(at).getDay() + 6) % 7;
    setDay(today < DAYS ? today : 0);
  }, []);

  const monday = now === null ? null : weekStart(new Date(now), offset);
  const from = monday?.getTime() ?? null;

  useEffect(() => {
    if (from === null) return;
    let live = true;
    setCalendar("LOADING");
    setBusy(null);
    const to = new Date(from);
    to.setDate(to.getDate() + DAYS);
    void weekAvailabilityAction(
      relationshipId,
      new Date(from).toISOString(),
      to.toISOString(),
      localZone(),
    )
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setBusy(
            result.value.busy.map((b) => ({
              start: Date.parse(b.startsAt),
              end: Date.parse(b.endsAt),
            })),
          );
          setCalendar("READ");
        } else setCalendar({ message: result.message });
      })
      .catch(() => {
        if (live)
          setCalendar({ message: "Your calendar couldn't be read just now." });
      });
    return () => {
      live = false;
    };
  }, [relationshipId, from]);

  if (monday === null || now === null) {
    return (
      <div
        className="h-[560px] rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
        aria-busy="true"
      />
    );
  }

  const days = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  const todayKey = new Date(now).toDateString();
  const hourAt = (date: Date, hour: number) => {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    return start.getTime();
  };
  const cell = (date: Date, hour: number) => {
    const start = hourAt(date, hour);
    return { start, ...slotKind(start, start + 3_600_000, meetings, busy, now) };
  };

  const block = (
    date: Date,
    hour: number,
    phone: boolean,
  ): ReactNode => {
    const slot = cell(date, hour);
    const key = `${String(date.getDay())}-${String(hour)}`;
    const base = phone
      ? "flex min-h-[52px] w-full items-center gap-3 rounded-(--cq-radius-lg) border px-3.5 text-start text-sm"
      : "absolute inset-[3px] flex flex-col items-start gap-0.5 rounded-(--cq-radius-md) px-2 py-1.5 text-start text-xs transition-[background-color,border-color,color] duration-(--cq-motion-fast)";
    const time = (
      <b className={phone ? "w-[52px] flex-none font-semibold tabular-nums" : "sr-only"}>
        {hourLabel(hour)}
      </b>
    );
    if (slot.kind === "booked" && slot.meeting !== null) {
      const meeting = slot.meeting;
      // Only its first hour carries the words; the rest is the same block.
      const first =
        Date.parse(meeting.startsAt) >= slot.start ||
        hour === HOURS[0];
      const invited = sent.has(meeting.id) || meeting.status === "SCHEDULING";
      return (
        <button
          type="button"
          onClick={() => setOpen(meeting)}
          className={cx(
            base,
            invited
              ? "cq-arrive border-[1.5px] border-dashed border-(--cq-accent) bg-(--cq-accent-soft) text-(--cq-text-primary)"
              : cx("border-transparent", TILE),
          )}
          data-slot="booked"
        >
          {time}
          {first ? (
            <>
              <b className="font-semibold">
                {invited ? t("Invite sent") : counterpart}
              </b>
              <span className={phone ? "truncate" : "truncate opacity-90"}>
                {invited
                  ? t("Waiting for them")
                  : t(`${meeting.purpose}, ${String(minutes(meeting))} min`)}
              </span>
            </>
          ) : (
            <span className="sr-only">{counterpart}</span>
          )}
        </button>
      );
    }
    if (slot.kind === "busy") {
      return (
        <div
          className={cx(
            base,
            "cq-busy-hatch border-transparent text-(--cq-text-tertiary)",
            phone ? "border-dashed border-(--cq-border)" : undefined,
          )}
          data-slot="busy"
        >
          {time}
          {t("Busy")}
        </div>
      );
    }
    if (slot.kind === "past") {
      return phone ? (
        <div
          className={cx(base, "border-(--cq-border-subtle) text-(--cq-text-tertiary)")}
          data-slot="past"
        >
          {time}
          <span className="cq-caption">
            {busy === null && slot.start > now
              ? t("Calendar not read")
              : t("Past")}
          </span>
        </div>
      ) : null;
    }
    return (
      <button
        type="button"
        onClick={() => setProposing(slot.start)}
        onFocus={() => setHint(key)}
        onBlur={() => setHint(null)}
        className={cx(
          base,
          phone
            ? "border-(--cq-border) bg-(--cq-surface-raised)"
            : "cq-slot-free",
        )}
        {...(hint === key ? { "data-hint": "" } : {})}
        data-slot="free"
        aria-label={t(`Propose ${WHEN.format(date)}, ${hourLabel(hour)}`)}
      >
        {time}
        {phone ? (
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t("Free, tap to propose")}
          </span>
        ) : (
          t(`Propose ${hourLabel(hour)}`)
        )}
      </button>
    );
  };

  const weekWords =
    offset === 0 ? "This week" : offset === 1 ? "Next week" : `Week of ${WHEN.format(monday)}`;

  return (
    <section
      aria-labelledby="calls-week"
      className="flex flex-col gap-3"
      data-calls-week
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          id="calls-week"
          className="text-[20px] font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
        >
          {t(weekWords)}
        </h2>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "Your calendar, busy times hidden in detail. Tap a free hour to propose it.",
          )}
        </span>
        <span className="ms-auto flex gap-1">
          <button
            type="button"
            aria-label={t("Previous week")}
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            className={buttonClassName("quiet", "compact", "size-11 px-0 lg:size-9")}
          >
            <ChevronLeft size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("Next week")}
            disabled={offset >= 3}
            onClick={() => setOffset((o) => Math.min(3, o + 1))}
            className={buttonClassName("quiet", "compact", "size-11 px-0 lg:size-9")}
          >
            <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
        </span>
      </div>

      {calendar === "LOADING" ? (
        <p className="cq-caption text-(--cq-text-tertiary)" role="status">
          {t("Reading your calendar…")}
        </p>
      ) : calendar === "READ" ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(calendar.message)}{" "}
          {t("Booked calls still show; free hours need your calendar.")}
        </p>
      )}
      {notice === null ? null : (
        <p
          className="cq-body-sm cq-swap rounded-(--cq-radius-md) bg-(--cq-positive-soft) px-3 py-2 text-(--cq-positive)"
          role="status"
        >
          {t(notice)}
        </p>
      )}

      {/* Desktop: the week as a grid. */}
      <div
        className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))] overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) max-md:hidden"
        role="grid"
        aria-label={t(weekWords)}
      >
        <div className="border-b border-(--cq-border-subtle) bg-(--cq-surface)" />
        {days.map((date) => {
          const today = date.toDateString() === todayKey;
          const tomorrow = new Date(now + 86_400_000).toDateString() === date.toDateString();
          return (
            <div
              key={date.toISOString()}
              role="columnheader"
              className={cx(
                "border-s border-b border-(--cq-border-subtle) bg-(--cq-surface) p-2.5 text-[13px] font-semibold",
                today ? "text-(--cq-accent)" : "text-(--cq-text-primary)",
              )}
            >
              {t(DAY_HEAD.format(date))} {date.getDate()}
              <span className="block text-xs font-normal text-(--cq-text-tertiary)">
                {today
                  ? t("Today")
                  : tomorrow
                    ? t("Tomorrow")
                    : t(new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date))}
              </span>
            </div>
          );
        })}
        {HOURS.map((hour) => (
          <div key={hour} role="row" className="contents">
            <div className="h-14 border-t border-(--cq-border-subtle) px-2 py-1 text-end text-[11px] text-(--cq-text-tertiary) tabular-nums">
              {hourLabel(hour)}
            </div>
            {days.map((date) => (
              <div
                key={date.toISOString()}
                role="gridcell"
                className="relative h-14 border-s border-t border-(--cq-border-subtle)"
              >
                {block(date, hour, false)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Phone: one day at a time. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
          role="tablist"
          aria-label={t("Day")}
        >
          {days.map((date, index) => (
            <button
              key={date.toISOString()}
              type="button"
              role="tab"
              aria-selected={index === day}
              onClick={() => setDay(index)}
              className={cx(
                "flex min-h-[52px] min-w-16 flex-none flex-col items-center justify-center rounded-(--cq-radius-lg) border text-xs transition-colors duration-(--cq-motion-fast)",
                index === day
                  ? cx("border-transparent", TILE)
                  : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary)",
              )}
            >
              <b className="text-[15px]">{t(DAY_HEAD.format(date))}</b>
              {t(`${String(date.getDate())} ${new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date)}`)}
            </button>
          ))}
        </div>
        <ul key={day} className="cq-swap flex flex-col gap-2">
          {HOURS.map((hour) => {
            const date = days[day] ?? days[0];
            return date === undefined ? null : (
              <li key={hour}>{block(date, hour, true)}</li>
            );
          })}
        </ul>
      </div>

      <ProposeSheet
        at={proposing}
        relationshipId={relationshipId}
        counterpart={counterpart}
        onClose={(meeting) => {
          setProposing(null);
          if (meeting !== null) {
            setMeetings((current) => [
              meeting,
              ...current.filter((m) => m.id !== meeting.id),
            ]);
            setSent((current) => new Set([...current, meeting.id]));
            setNotice(
              `${WHEN.format(new Date(meeting.startsAt))} at ${TIME.format(new Date(meeting.startsAt))}: invite sent to ${counterpart}.`,
            );
          }
        }}
      />
      <MeetingSheet
        meeting={open}
        counterpart={counterpart}
        now={now}
        onClose={() => setOpen(null)}
        onCancelled={(id) => {
          setMeetings((current) =>
            current.map((m) => (m.id === id ? { ...m, status: "CANCELLED" } : m)),
          );
          setOpen(null);
          setNotice("Cancelled. Everyone invited has been told.");
        }}
      />
    </section>
  );
}

/**
 * The invite before it goes: when, how long and what for, exactly as it
 * will be sent. Its key is made from that invite.
 */
function ProposeSheet({
  at,
  relationshipId,
  counterpart,
  onClose,
}: {
  readonly at: number | null;
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly onClose: (meeting: MeetingDto | null) => void;
}) {
  const t = useT();
  const purposeId = useId();
  const [nonce] = useState(() => crypto.randomUUID().slice(0, 12));
  const [length, setLength] = useState(30);
  const [purpose, setPurpose] = useState(`Call with ${counterpart}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const startsAt = at === null ? null : new Date(at).toISOString();
  const invite = {
    relationshipId,
    purpose: purpose.trim(),
    startsAt: startsAt ?? "",
    durationMinutes: length,
    timeZone: localZone(),
  };

  const send = () =>
    start(async () => {
      if (startsAt === null) return;
      setError(null);
      const booked = await bookMeetingAction({
        ...invite,
        idempotencyKey: `web-invite-${nonce}-${payloadFingerprint(invite)}`,
      }).catch(() => ({
        ok: false as const,
        message: "That didn't send. Try again.",
      }));
      if (booked.ok) onClose(booked.value);
      else setError(booked.message);
    });

  return (
    <RecordSheet
      open={at !== null}
      onOpenChange={(next) => {
        if (!next) onClose(null);
      }}
      title={t(`Propose a call to ${counterpart}`)}
      description={
        at === null
          ? undefined
          : t(`${WHEN.format(new Date(at))} at ${TIME.format(new Date(at))}`)
      }
      charcoal
    >
      <div
        role="radiogroup"
        aria-label={t("How long")}
        className="inline-flex gap-0.5 self-start rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) p-[3px]"
      >
        {[30, 45, 60].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={length === value}
            onClick={() => setLength(value)}
            className={cx(
              "cq-body-sm min-h-11 rounded-(--cq-radius-md) px-3 font-medium lg:min-h-[38px]",
              length === value
                ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_0_0_1px_var(--cq-border-subtle)]"
                : "text-(--cq-text-secondary)",
            )}
          >
            {t(`${String(value)} min`)}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5" htmlFor={purposeId}>
        <span className="cq-body-sm font-medium text-(--cq-text-secondary)">
          {t("What the call is for")}
        </span>
        <input
          id={purposeId}
          value={purpose}
          maxLength={500}
          onChange={(event) => setPurpose(event.target.value)}
          className="cq-body min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)"
        />
      </label>
      <span className="cq-caption text-(--cq-text-tertiary)">
        {t(
          `${counterpart} gets a calendar invite with a Google Meet link. Nothing is sent until you press Send invite.`,
        )}
      </span>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {t(error)}
        </p>
      )}
      <Button
        variant="primary"
        disabled={pending || purpose.trim() === ""}
        onClick={send}
      >
        {pending ? t("Sending…") : t("Send invite")}
      </Button>
    </RecordSheet>
  );
}

/** A booked call: when, the brief, the Meet link, Q in the call, cancel. */
function MeetingSheet({
  meeting,
  counterpart,
  now,
  onClose,
  onCancelled,
}: {
  readonly meeting: MeetingDto | null;
  readonly counterpart: string;
  readonly now: number;
  readonly onClose: () => void;
  readonly onCancelled: (id: string) => void;
}) {
  const t = useT();
  const [brief, setBrief] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = meeting?.id ?? null;
  const hasBrief = meeting?.hasBrief === true;

  useEffect(() => {
    setBrief(null);
    if (id === null || !hasBrief) return;
    let live = true;
    void meetingBriefAction(id)
      .then((result) => {
        if (live && result.ok) setBrief(result.value.body);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, hasBrief]);

  const ended = meeting !== null && Date.parse(meeting.endsAt) < now;
  return (
    <RecordSheet
      open={meeting !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={meeting === null ? "" : meeting.purpose}
      description={
        meeting === null
          ? undefined
          : t(
              `${WHEN.format(new Date(meeting.startsAt))}, ${TIME.format(new Date(meeting.startsAt))}, ${String(minutes(meeting))} min, with ${counterpart}`,
            )
      }
      charcoal
    >
      {meeting === null ? null : (
        <>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {meeting.organisedByYou
              ? t(`You invited ${meeting.attendees.join(", ") || counterpart}`)
              : t(`${meeting.organiserName} invited you`)}
          </p>
          {brief === null ? null : (
            <QLine
              note={t(
                "Q's preparation from what both sides shared. Check it before the call.",
              )}
            >
              <p className="whitespace-pre-wrap">{brief}</p>
            </QLine>
          )}
          {meeting.meetLink === null || ended ? null : (
            <a
              href={meeting.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName("primary")}
            >
              {t("Join Google Meet")}
            </a>
          )}
          {meeting.meetLink === null ? null : (
            <MeetingQ meetingId={meeting.id} ended={ended} />
          )}
          {error === null ? null : (
            <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
              {t(error)}
            </p>
          )}
          {meeting.organisedByYou && !ended ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const done = await cancelMeetingAction(meeting.id);
                  if (done.ok) onCancelled(meeting.id);
                  else setError(done.message);
                })
              }
            >
              {t("Cancel call")}
            </Button>
          ) : null}
        </>
      )}
    </RecordSheet>
  );
}
