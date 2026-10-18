/**
 * Lane N (owner, 2026-10-15: "even when meeting times have been sent and
 * there's nothing to do anymore, they keep talking to each other").
 *
 * When a standing instruction's goal is a meeting, whether that goal is
 * reached in one conversation is decided HERE, by code, from the messages
 * themselves and the relationship's booked calls -- never by the planner.
 * Live evidence (Tensorgate and Zino, 9-15 Oct): "Wednesday at 2:00 p.m.
 * UTC works well for me" was followed by six more agent messages, each
 * re-confirming the same time, and nothing was ever booked.
 *
 * States, per conversation:
 *   OPEN            no concrete time agreed
 *   PROPOSED_TO_US  the other side named a concrete time; ours hasn't answered
 *   AGREED          one side named a concrete time and the other accepted it
 *   BOOKED          a call is booked on the relationship (the schedule's row)
 *
 * AGREED and BOOKED are terminal for the negotiation: no further agent
 * message goes to that conversation. The booking itself reuses the existing
 * schedule path (and the meeting-time-proposal state machine where a
 * structured proposal exists); nothing here books or sends anything.
 *
 * Reads only words and times. A false "agreed" costs one held message and a
 * confirmation card the person can decline; a false "open" is the old
 * behaviour. Unknown stays OPEN.
 */

export type NegotiationLine = {
  readonly from: "US" | "THEM";
  readonly sentAt: Date;
  readonly text: string;
};

export type Slot = {
  /** The start, as an instant. */
  readonly startsAt: Date;
  /** The zone the time was said in (IANA). */
  readonly timeZone: string;
};

export type Negotiation = {
  /** The latest agreement still standing, when there is one. */
  readonly agreed: {
    readonly slot: Slot;
    readonly agreedAt: Date;
    readonly proposedBy: "US" | "THEM";
  } | null;
  /** Concrete times the other side named last, not yet answered by us. */
  readonly proposedToUs: readonly Slot[];
  /** Minutes said for the call (latest mention), else 30. */
  readonly durationMinutes: number;
  readonly lastFromThemAt: Date | null;
};

export type BookedCall = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly status: "SCHEDULING" | "SCHEDULED" | "CANCELLED" | "FAILED";
  readonly organisedByYou: boolean;
};

export type MeetingGoalState =
  | { readonly state: "OPEN" }
  | { readonly state: "PROPOSED_TO_US"; readonly slots: readonly Slot[] }
  | {
      readonly state: "AGREED";
      readonly slot: Slot;
      readonly agreedAt: Date;
      readonly durationMinutes: number;
    }
  | { readonly state: "BOOKED"; readonly call: BookedCall };

/** AGREED and BOOKED end the negotiation: nothing more is written. */
export function isTerminal(goal: MeetingGoalState | undefined): boolean {
  return goal?.state === "AGREED" || goal?.state === "BOOKED";
}

/**
 * Whether this instruction's goal includes getting a meeting: its grant
 * may book, or its own words ask for a call. Code's read, deterministic.
 */
export function goalIsMeeting(
  goalText: string,
  grantActions: readonly { readonly action: string }[],
): boolean {
  return (
    grantActions.some(
      (entry) =>
        entry.action === "schedule.meeting.book" ||
        entry.action.startsWith("schedule.proposal."),
    ) ||
    /\b(?:meet(?:ing)?s?|calls?|book(?:ing)?|schedul\w*|times?|slots?|intro(?:duction)?s?)\b/iu.test(
      goalText,
    )
  );
}

// ---------------------------------------------------------------------------
// Times in words
// ---------------------------------------------------------------------------

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const ZONE_WORDS: Readonly<Record<string, string>> = {
  utc: "UTC",
  gmt: "UTC",
  wat: "Africa/Lagos",
  cat: "Africa/Maputo",
  eat: "Africa/Nairobi",
  cet: "Europe/Paris",
  cest: "Europe/Paris",
  bst: "Europe/London",
  est: "America/New_York",
  edt: "America/New_York",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  gst: "Asia/Dubai",
};

const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DAY_RE = new RegExp(
  String.raw`\b(?:(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?\b\.?,?(?:\s+(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH})?|(today|tomorrow)|(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}|${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b)`,
  "giu",
);
const TIME_RE =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\b\.?|p\.?\s?m\b\.?)|\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/giu;
const ZONE_RE =
  /^\s*\(?\s*(?:(utc|gmt)\s*([+-]\s*\d{1,2})|(utc|gmt|wat|cat|eat|cet|cest|bst|est|edt|pst|pdt|gst)\b|([A-Z][a-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?))\)?/iu;
const DURATION_RE = /\b(\d{2,3})[- ]?min(?:ute)?s?\b/iu;

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return Math.round((local - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** A wall-clock time in a zone, as an instant. */
export function zonedInstant(
  date: { readonly y: number; readonly m: number; readonly d: number },
  hour: number,
  minute: number,
  zone: string,
): Date {
  const guess = Date.UTC(date.y, date.m - 1, date.d, hour, minute);
  const first = guess - offsetMinutes(guess, zone) * 60_000;
  const second = guess - offsetMinutes(first, zone) * 60_000;
  return new Date(second);
}

function localDate(
  at: Date,
  zone: string,
): { y: number; m: number; d: number; weekday: number } {
  const shifted = new Date(
    at.getTime() + offsetMinutes(at.getTime(), zone) * 60_000,
  );
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function addDays(
  date: { y: number; m: number; d: number },
  days: number,
): { y: number; m: number; d: number } {
  const moved = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return {
    y: moved.getUTCFullYear(),
    m: moved.getUTCMonth() + 1,
    d: moved.getUTCDate(),
  };
}

type DayMention = {
  readonly index: number;
  readonly resolve: (
    sent: Date,
    zone: string,
  ) => { y: number; m: number; d: number };
};

function monthIndex(word: string): number {
  return MONTHS.indexOf(
    word.slice(0, 3).toLowerCase() as (typeof MONTHS)[number],
  );
}

function dayMentions(text: string): DayMention[] {
  const out: DayMention[] = [];
  for (const match of text.matchAll(DAY_RE)) {
    const [, weekday, wDate, wMonth, relative, dDate, dMonth, mMonth, mDate] =
      match;
    const index = match.index;
    const explicit = (dayText?: string, monthText?: string) => {
      if (dayText === undefined || monthText === undefined) return null;
      const month = monthIndex(monthText) + 1;
      const day = Number(dayText);
      if (month < 1 || day < 1 || day > 31) return null;
      return { month, day };
    };
    const fixed =
      explicit(wDate, wMonth) ??
      explicit(dDate, dMonth) ??
      explicit(mDate, mMonth);
    if (fixed !== null) {
      out.push({
        index,
        resolve: (sent, zone) => {
          const today = localDate(sent, zone);
          // A date said without a year is the next such date (within a year).
          const year =
            Date.UTC(today.y, fixed.month - 1, fixed.day) <
            Date.UTC(today.y, today.m - 1, today.d) - 60 * 86_400_000
              ? today.y + 1
              : today.y;
          return { y: year, m: fixed.month, d: fixed.day };
        },
      });
      continue;
    }
    if (relative !== undefined) {
      const ahead = relative.toLowerCase() === "tomorrow" ? 1 : 0;
      out.push({
        index,
        resolve: (sent, zone) => addDays(localDate(sent, zone), ahead),
      });
      continue;
    }
    if (weekday !== undefined) {
      const target = WEEKDAYS.indexOf(
        weekday.slice(0, 3).toLowerCase() as (typeof WEEKDAYS)[number],
      );
      if (target < 0) continue;
      out.push({
        index,
        resolve: (sent, zone) => {
          const today = localDate(sent, zone);
          // The next such day; said on that day itself, the same day.
          return addDays(today, (target - today.weekday + 7) % 7);
        },
      });
    }
  }
  return out;
}

/**
 * The concrete times a message names: a day (weekday, date, today or
 * tomorrow) and a clock time, with the zone said beside it or else
 * `defaultZone`. A time with no day in the same message is not concrete.
 */
export function slotsIn(
  text: string,
  sentAt: Date,
  defaultZone: string,
): Slot[] {
  const days = dayMentions(text);
  if (days.length === 0) return [];
  const out: Slot[] = [];
  for (const match of text.matchAll(TIME_RE)) {
    const [, h12, m12, meridiem, h24, m24] = match;
    let hour: number;
    let minute: number;
    if (h12 !== undefined && meridiem !== undefined) {
      hour = Number(h12);
      minute = m12 === undefined ? 0 : Number(m12);
      if (hour < 1 || hour > 12) continue;
      const pm = meridiem.toLowerCase().startsWith("p");
      hour = (hour % 12) + (pm ? 12 : 0);
    } else if (h24 !== undefined && m24 !== undefined) {
      hour = Number(h24);
      minute = Number(m24);
    } else {
      continue;
    }
    if (minute > 59) continue;
    const after = text.slice(match.index + match[0].length);
    const zoneMatch = ZONE_RE.exec(after);
    let zone = defaultZone;
    if (zoneMatch !== null) {
      const [, offsetBase, offset, word, iana] = zoneMatch;
      if (offsetBase !== undefined && offset !== undefined) {
        const hours = Number(offset.replace(/\s/gu, ""));
        // Etc/GMT signs are inverted by definition.
        zone =
          hours === 0
            ? "UTC"
            : `Etc/GMT${hours > 0 ? "-" : "+"}${String(Math.abs(hours))}`;
      } else if (word !== undefined) {
        zone = ZONE_WORDS[word.toLowerCase()] ?? defaultZone;
      } else if (iana !== undefined && validZone(iana)) {
        zone = iana;
      }
    }
    if (!validZone(zone)) continue;
    // The day said nearest before the time, else the first after it.
    const before = days.filter((day) => day.index < match.index);
    const day = before[before.length - 1] ?? days[0];
    if (day === undefined) continue;
    const date = day.resolve(sentAt, zone);
    const startsAt = zonedInstant(date, hour, minute, zone);
    if (!out.some((slot) => slot.startsAt.getTime() === startsAt.getTime())) {
      out.push({ startsAt, timeZone: zone });
    }
  }
  return out;
}

/** Words that accept a time ("works for me", "see you then"). */
const ACCEPTS =
  /\b(?:works?(?: well| great| perfectly| fine| nicely)? (?:for|with) (?:me|us)|(?:that|this|it|the time) works\b|suits (?:me|us)|(?:is|are) (?:fine|good|great|perfect) (?:for|with) (?:me|us)|(?:i|we) (?:can )?confirm\b|confirmed\b|thank(?:s| you) for confirming|see you (?:then|on|at)|speak (?:to you )?then|talk (?:to you )?then|look(?:ing)? forward to (?:speaking|meeting|talking|our (?:call|conversation|chat)|the (?:call|conversation))|sounds good|let(?:'|’)?s do (?:it|that)|(?:i|we)(?:'|’)?ll take (?:it|that|the)|let(?:'|’)?s go with)/iu;
/** Words that turn a time down or move it. */
const DECLINES =
  /\b(?:doesn(?:'|’)?t work|does not work|won(?:'|’)?t work|can(?:'|’)?t (?:make|do)|cannot (?:make|do)|unable to|not (?:available|free)|unfortunately|reschedul\w*|postpone\w*|cancel\w*|push (?:it|this) back)\b/iu;

export function acceptsATime(text: string): boolean {
  return ACCEPTS.test(text) && !DECLINES.test(text);
}

const same = (a: Slot, b: Slot) =>
  a.startsAt.getTime() === b.startsAt.getTime();

/**
 * The conversation's scheduling state, read from its messages in order
 * (oldest first). An acceptance agrees a time only when the OTHER side
 * named that same time earlier, or when it names no time and the other
 * side's latest message named exactly one. A later different time, or a
 * decline, reopens it.
 */
export function readNegotiation(
  lines: readonly NegotiationLine[],
  defaultZone: string,
): Negotiation {
  let agreed: Negotiation["agreed"] = null;
  let durationMinutes = 30;
  let lastFromThemAt: Date | null = null;
  const named: { from: "US" | "THEM"; slots: Slot[] }[] = [];
  let pending: { from: "US" | "THEM"; slots: Slot[] } | null = null;
  for (const line of lines) {
    if (line.from === "THEM") lastFromThemAt = line.sentAt;
    const duration = DURATION_RE.exec(line.text);
    if (duration?.[1] !== undefined) {
      const minutes = Number(duration[1]);
      if (minutes >= 15 && minutes <= 180) durationMinutes = minutes;
    }
    const slots = slotsIn(line.text, line.sentAt, defaultZone);
    const other = line.from === "US" ? "THEM" : "US";
    if (DECLINES.test(line.text)) {
      // A decline or a move reopens whatever stood, and any time it names
      // is a new proposal.
      agreed = null;
      pending = slots.length > 0 ? { from: line.from, slots } : null;
      if (slots.length > 0) named.push({ from: line.from, slots });
      continue;
    }
    if (ACCEPTS.test(line.text)) {
      const theirs = named
        .filter((entry) => entry.from === other)
        .flatMap((entry) => entry.slots);
      const lastTheirs = [...named]
        .reverse()
        .find((entry) => entry.from === other);
      const match =
        slots.length > 0
          ? slots.find((slot) => theirs.some((one) => same(one, slot)))
          : lastTheirs !== undefined && lastTheirs.slots.length === 1
            ? lastTheirs.slots[0]
            : undefined;
      const stillAgreed =
        agreed !== null &&
        (slots.length === 0 ||
          slots.some((slot) => agreed !== null && same(slot, agreed.slot)));
      if (match !== undefined) {
        agreed = { slot: match, agreedAt: line.sentAt, proposedBy: other };
        pending = null;
        named.push({
          from: line.from,
          slots: slots.length > 0 ? slots : [match],
        });
        continue;
      }
      if (stillAgreed) {
        // "Thank you for confirming Wednesday": the agreement stands.
        pending = null;
        continue;
      }
    }
    if (slots.length > 0) {
      named.push({ from: line.from, slots });
      if (
        agreed !== null &&
        !slots.some((slot) => agreed !== null && same(slot, agreed.slot))
      ) {
        agreed = null;
      }
      pending = agreed === null ? { from: line.from, slots } : null;
    } else if (line.from === "US" && pending?.from === "THEM") {
      // Our side answered without a time: their proposal is no longer ours
      // to answer by code (the person or the planner moved on).
      pending = null;
    }
  }
  return {
    agreed,
    proposedToUs: pending?.from === "THEM" ? pending.slots : [],
    durationMinutes,
    lastFromThemAt,
  };
}

/** How long after a call's end its agreement still holds the thread shut. */
const AFTER_CALL_MS = 12 * 3_600_000;

/**
 * One conversation's meeting goal: a booked call first (the schedule's own
 * row is the truth), then the agreement read from the words.
 */
export function meetingGoalState(input: {
  readonly negotiation: Negotiation | undefined;
  readonly calls: readonly BookedCall[];
  readonly now: Date;
}): MeetingGoalState {
  const now = input.now.getTime();
  const booked = input.calls
    .filter(
      (call) =>
        (call.status === "SCHEDULED" || call.status === "SCHEDULING") &&
        Date.parse(call.endsAt) + AFTER_CALL_MS > now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (booked !== undefined) return { state: "BOOKED", call: booked };
  const negotiation = input.negotiation;
  if (negotiation === undefined) return { state: "OPEN" };
  const agreed = negotiation.agreed;
  if (agreed !== null) {
    const ends =
      agreed.slot.startsAt.getTime() + negotiation.durationMinutes * 60_000;
    // Past the call, a new message from them is a new conversation.
    const wroteSince =
      negotiation.lastFromThemAt !== null &&
      negotiation.lastFromThemAt.getTime() > ends;
    if (!(ends + AFTER_CALL_MS < now && wroteSince)) {
      return {
        state: "AGREED",
        slot: agreed.slot,
        agreedAt: agreed.agreedAt,
        durationMinutes: negotiation.durationMinutes,
      };
    }
  }
  const future = negotiation.proposedToUs.filter(
    (slot) => slot.startsAt.getTime() > now,
  );
  return future.length > 0
    ? { state: "PROPOSED_TO_US", slots: future }
    : { state: "OPEN" };
}

/**
 * The booking's idempotency key: one per relationship and agreed start, so
 * every firing that sees the same agreement prepares the same booking, and
 * an approved booking replayed is the same booking.
 */
export function bookingKey(relationshipId: string, slot: Slot): string {
  return `goal-book:${relationshipId}:${String(Math.floor(slot.startsAt.getTime() / 60_000))}`;
}

/** A time in plain words, in its own zone: "Wed 14 Oct, 14:00 UTC". */
export function slotWords(slot: Slot): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: slot.timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(slot.startsAt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: slot.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(slot.startsAt);
  return `${day.replace(/,/gu, "")}, ${time} ${slot.timeZone}`;
}

/** The planner's line for a conversation whose goal is reached, or null. */
export function goalLine(goal: MeetingGoalState | undefined): string | null {
  if (goal === undefined) return null;
  if (goal.state === "BOOKED") {
    return `GOAL REACHED: the call is booked (${slotWords({ startsAt: new Date(goal.call.startsAt), timeZone: goal.call.timeZone })}): write nothing to them`;
  }
  if (goal.state === "AGREED") {
    return `GOAL REACHED: both sides agreed ${slotWords(goal.slot)}: write nothing to them; code handles the booking`;
  }
  return null;
}
