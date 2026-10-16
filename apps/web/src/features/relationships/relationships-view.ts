import type {
  CommitmentNextStep,
  NotificationDto,
  RelationshipStateV2,
  RelationshipSummaryDto,
  ReminderDto,
} from "@capital-q/contracts";

import { money } from "@/features/capital/money";

/**
 * The Relationships list's view model (founder critique 2026-10-04: "next
 * steps are not obvious, what is important is ambiguous"). Pure, so the
 * words and the order are tested as words and order:
 *   - one next step per relationship, as a button, with a short why;
 *   - "Needs you" deduped to one card per relationship and kind;
 *   - keyset cursors over the list's own order.
 * Nothing is scored or ranked: the order is the projection's own time.
 */

export type ListSide = "INVESTOR" | "COMPANY";

/** What a card knows beyond the summary row, when it was read. */
export type RowFacts = {
  readonly unread: number;
  readonly followUpDue: boolean;
  readonly nextCallAt: string | null;
  /** False: the calls could not be read, so nextCallAt is unknown (R1). */
  readonly callsRead?: boolean | undefined;
  readonly lastMessageAt: string | null;
  /** Founder: requests still open. Investor: shares not yet opened. */
  readonly diligence: {
    readonly openRequests: number;
    readonly firstOpenTitle: string | null;
    readonly unopenedShares: number;
  } | null;
  /**
   * A commitment on it waiting on this side (Capital's "Needs you"): the
   * server's own next step for the viewing side, never inferred here.
   */
  readonly commitment?: CommitmentFact | null | undefined;
};

/** The money step a commitment waits on this side for. */
export type CommitmentFact = {
  readonly next: CommitmentNextStep;
  readonly amount: string;
  readonly currencyCode: string;
};

/**
 * The commitment waiting on this side for each relationship, from the
 * Capital read (LedgerCommitmentDto.next). One per relationship: the
 * newest, since only one button fits a row.
 */
export function commitmentFacts(
  commitments: readonly {
    readonly relationshipId: string;
    readonly next: CommitmentNextStep | null;
    readonly amount: string;
    readonly currencyCode: string;
    readonly at: string;
  }[],
): Readonly<Record<string, CommitmentFact>> {
  const out: Record<string, CommitmentFact & { at: string }> = {};
  for (const one of commitments) {
    if (one.next === null) continue;
    const held = out[one.relationshipId];
    if (held !== undefined && Date.parse(held.at) >= Date.parse(one.at)) {
      continue;
    }
    out[one.relationshipId] = {
      next: one.next,
      amount: one.amount,
      currencyCode: one.currencyCode,
      at: one.at,
    };
  }
  return Object.fromEntries(
    Object.entries(out).map(([id, { next, amount, currencyCode }]) => [
      id,
      { next, amount, currencyCode },
    ]),
  );
}

/**
 * A row's facts from what was read about it: the card digest (when this
 * relationship was among those read in full), its unread chat count and
 * the commitment waiting on this side. Undefined: nothing is known beyond
 * the summary row.
 */
export function rowFacts(
  digest:
    | {
        readonly followUpDue: boolean;
        readonly nextCall: { readonly startsAt: string } | null;
        readonly callsRead?: boolean | undefined;
        readonly messages: {
          readonly last: { readonly sentAt: string } | null;
        } | null;
        readonly diligence?: RowFacts["diligence"] | undefined;
      }
    | undefined,
  unread: number,
  commitment: CommitmentFact | undefined = undefined,
): RowFacts | undefined {
  if (digest === undefined) {
    return unread > 0 || commitment !== undefined
      ? {
          unread,
          followUpDue: false,
          nextCallAt: null,
          // Unknown, so no "Book a call" over a call we could not see.
          callsRead: false,
          lastMessageAt: null,
          diligence: null,
          commitment: commitment ?? null,
        }
      : undefined;
  }
  return {
    unread,
    followUpDue: digest.followUpDue,
    nextCallAt: digest.nextCall?.startsAt ?? null,
    callsRead: digest.callsRead,
    lastMessageAt: digest.messages?.last?.sentAt ?? null,
    diligence: digest.diligence ?? null,
    commitment: commitment ?? null,
  };
}

const COMMITMENT_STEP: Readonly<Record<CommitmentNextStep, string>> = {
  CONFIRM_AMOUNT: "Confirm amount",
  MARK_SENT: "Mark as sent",
  CONFIRM_RECEIVED: "Confirm received",
};

export type NextStep = {
  /** The button's words; null when nothing is theirs to do. */
  readonly label: string | null;
  readonly href: string | null;
  readonly icon:
    "upload" | "file" | "reply" | "calendar" | "answer" | "money" | null;
  /** One short line under the name on a phone. */
  readonly why: string;
  /** Theirs to do now: sorts first under Needs you and gets the strong button. */
  readonly urgent: boolean;
};

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const callTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "now", "5m", "3h", "2d", else "27 Sep": the time since, at a glance. */
export function since(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return shortDate.format(new Date(iso));
}

/** The latest thing that happened: a state change or a message. */
export function lastActivityAt(
  item: RelationshipSummaryDto,
  facts: RowFacts | undefined,
): string {
  const said = facts?.lastMessageAt ?? null;
  return said !== null && Date.parse(said) > Date.parse(item.stateSince)
    ? said
    : item.stateSince;
}

const STAGE_TONES: Readonly<
  Record<RelationshipStateV2, "positive" | "waiting" | "accent" | "neutral">
> = {
  DISCOVERED: "neutral",
  INTEREST_EXPRESSED: "waiting",
  CONNECTED: "positive",
  MEETING_HELD: "positive",
  IN_DILIGENCE: "accent",
  INVESTED: "positive",
  // A pause or a pass is neutral, never an alarm (Pass is neutral, not red).
  PAUSED: "neutral",
  PASSED: "neutral",
  DECLINED: "neutral",
};

export function stageTone(state: RelationshipStateV2) {
  return STAGE_TONES[state];
}

/**
 * The ONE next step for a relationship, from the side reading it. The list
 * row and the relationship page's hero both say this, so they never differ.
 */
export function nextStepFor(
  item: Pick<RelationshipSummaryDto, "stateSince" | "nextStep">,
  facts: RowFacts | undefined,
  side: ListSide,
  now: number,
  base: string,
): NextStep {
  const step = (
    label: string | null,
    href: string | null,
    icon: NextStep["icon"],
    why: string,
    urgent: boolean,
  ): NextStep => ({ label, href, icon, why, urgent });
  const diligence = facts?.diligence ?? null;

  if (side === "COMPANY" && diligence !== null && diligence.openRequests > 0) {
    return step(
      "Upload & share",
      `${base}/diligence`,
      "upload",
      diligence.openRequests === 1 && diligence.firstOpenTitle !== null
        ? `Asked for ${diligence.firstOpenTitle}`
        : `${String(diligence.openRequests)} documents requested`,
      true,
    );
  }
  if (
    side === "INVESTOR" &&
    diligence !== null &&
    diligence.unopenedShares > 0
  ) {
    return step(
      "Review files",
      `${base}/diligence`,
      "file",
      diligence.unopenedShares === 1
        ? "1 new document shared"
        : `${String(diligence.unopenedShares)} new documents shared`,
      true,
    );
  }
  const commitment = facts?.commitment ?? null;
  if (commitment !== null) {
    // Money waits on this side: done on Capital, where the card asks once
    // more before anything is recorded.
    return step(
      COMMITMENT_STEP[commitment.next],
      capitalHref(side),
      "money",
      `Commitment ${money(commitment.amount, commitment.currencyCode)}`,
      true,
    );
  }
  if (item.nextStep === "ANSWER_INTEREST") {
    return step(
      "Answer",
      base,
      "answer",
      side === "COMPANY" ? "Interested in your company" : "Wants to connect",
      true,
    );
  }
  const unread = facts?.unread ?? 0;
  if (unread > 0) {
    return step(
      "Reply",
      `${base}/messages`,
      "reply",
      unread === 1 ? "1 new message" : `${String(unread)} new messages`,
      true,
    );
  }
  if (facts?.followUpDue === true || item.nextStep === "FOLLOW_UP") {
    return step(
      "Follow up",
      `${base}/messages`,
      "reply",
      facts?.followUpDue === true ? "Reminder due" : "After your call",
      true,
    );
  }
  if (item.nextStep === "DECIDE_NEXT_STEP") {
    return step("Decide next step", base, null, "After your call", true);
  }
  if (item.nextStep === "RESUME") {
    return step("Resume", base, null, "Paused", false);
  }
  const nextCall = facts?.nextCallAt ?? null;
  if (nextCall !== null && Date.parse(nextCall) > now) {
    return step(
      null,
      null,
      null,
      `Call ${callTime.format(new Date(nextCall))}`,
      false,
    );
  }
  if (item.nextStep === "SCHEDULE_MEETING" && facts?.callsRead === false) {
    // Unknown is not "none booked": no Book a call over a call we can't see.
    return step(null, null, null, "Calls couldn't be read just now", false);
  }
  if (item.nextStep === "SCHEDULE_MEETING") {
    return step(
      "Book a call",
      `${base}#calls`,
      "calendar",
      `Connected ${since(item.stateSince, now)}`,
      false,
    );
  }
  if (item.nextStep === "AWAIT_ANSWER") {
    return step(null, null, null, "Waiting on them", false);
  }
  if (item.nextStep === "EXPRESS_INTEREST") {
    return step("Express interest", base, null, "Not yet in touch", false);
  }
  return step(null, null, null, "", false);
}

/** Where a commitment's step is done: the side's commitments on Capital. */
function capitalHref(side: ListSide): string {
  return side === "COMPANY"
    ? "/relationships?view=capital&tab=raise#commitments"
    : "/relationships?view=capital#commitments";
}

// ---------------------------------------------------------------------------
// Cursors: keyset over (stateSince desc, relationshipId desc). The
// projection's own time, so a page never reorders under someone paging.
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 20;

export function listOrder(
  a: RelationshipSummaryDto,
  b: RelationshipSummaryDto,
): number {
  const byTime = Date.parse(b.stateSince) - Date.parse(a.stateSince);
  return byTime !== 0
    ? byTime
    : b.relationshipId.localeCompare(a.relationshipId);
}

export function cursorOf(item: RelationshipSummaryDto): string {
  return `${item.stateSince}~${item.relationshipId}`;
}

/** The page after `cursor` (null: the first), and the cursor for the next. */
export function pageAfter<T extends RelationshipSummaryDto>(
  ordered: readonly T[],
  cursor: string | null,
  size: number = PAGE_SIZE,
): { readonly items: readonly T[]; readonly next: string | null } {
  let start = 0;
  if (cursor !== null) {
    const [at, id] = cursor.split("~");
    const time = Date.parse(at ?? "");
    start = ordered.findIndex((item) => {
      const t = Date.parse(item.stateSince);
      return t < time || (t === time && item.relationshipId < (id ?? ""));
    });
    if (start === -1) return { items: [], next: null };
  }
  const items = ordered.slice(start, start + size);
  const last = items.at(-1);
  return {
    items,
    next:
      last === undefined || start + size >= ordered.length
        ? null
        : cursorOf(last),
  };
}

// ---------------------------------------------------------------------------
// Needs you: one card per relationship and kind (founder screenshot: ten
// raw notices, "New call: check something" twice, "Rehearse your call"
// twice, "Q is waiting to be let in" twice).
// ---------------------------------------------------------------------------

export type NeedsYouCard = {
  readonly key: string;
  readonly title: string;
  /** The relationship it is about, when its link names one. */
  readonly relationship: RelationshipSummaryDto | null;
  readonly latestAt: string;
  /** How many notices this card stands for. */
  readonly count: number;
  readonly noticeIds: readonly string[];
  readonly reminderId: string | null;
  readonly action: { readonly label: string; readonly href: string | null };
  /**
   * A relationship's own next step (not a notice): it leaves when the step
   * is done, so it has no dismiss.
   */
  readonly step?: boolean;
};

type Family = "reply" | "answer" | "files" | "money" | "other";

/** What a notice is about, so a step and its notice make one card. */
const NOTICE_FAMILY: Partial<Record<NotificationDto["kind"], Family>> = {
  CHAT_MESSAGE: "reply",
  Q_MESSAGE: "reply",
  EMAIL_RECEIVED: "reply",
  INTEREST_RECEIVED: "answer",
  CONNECTION_REQUESTED: "answer",
  DILIGENCE: "files",
  COMMITMENT: "money",
  COMMITMENT_DETECTED: "money",
};

const STEP_FAMILY: Partial<Record<NonNullable<NextStep["icon"]>, Family>> = {
  reply: "reply",
  answer: "answer",
  upload: "files",
  file: "files",
  money: "money",
};

function noticeFamily(kind: NotificationDto["kind"]): Family {
  return NOTICE_FAMILY[kind] ?? "other";
}

function stepFamily(step: NextStep): Family {
  return step.icon === null ? "other" : (STEP_FAMILY[step.icon] ?? "other");
}

/**
 * The one definition of "Needs you" for a relationship (live check
 * 2026-10-16: the Overview said nothing while Pipeline and Capital each
 * listed steps): its next step is the person's own to do now. Pipeline's
 * filter counts these; the Overview lists every one of them beside the
 * notices; Capital's commitments reach it through `RowFacts.commitment`.
 */
export function isOwnStep(step: NextStep): boolean {
  return step.urgent && step.label !== null;
}

const LINK =
  /^\/relationships\/(company|investor)\/([0-9a-f-]{36})(?:\/(messages|diligence))?/i;

function actionFor(
  kind: NotificationDto["kind"],
  side: ListSide,
  href: string | null,
): { readonly label: string; readonly href: string | null } {
  switch (kind) {
    case "DILIGENCE":
      return {
        label:
          side === "COMPANY" && href?.endsWith("/diligence") === true
            ? "Upload & share"
            : side === "INVESTOR"
              ? "Review files"
              : "Open",
        href,
      };
    case "INTEREST_RECEIVED":
    case "CONNECTION_REQUESTED":
      return { label: "Answer", href };
    case "CHAT_MESSAGE":
    case "Q_MESSAGE":
    case "EMAIL_RECEIVED":
      return { label: "Reply", href };
    case "MEETING_PREP_READY":
      return { label: "Rehearse", href };
    case "MEETING_NOTES_READY":
      return { label: "Read notes", href };
    case "Q_WORK":
    case "Q_ERRAND":
    case "Q_STAND_IN":
    case "COMMITMENT_DETECTED":
    case "COMMITMENT":
    case "STARTUP_ALERT":
      return { label: "Review", href };
    case "REMINDER":
    case "MEETING_SCHEDULED":
    case "MEETING_CANCELLED":
    case "Q_SCOUT":
    case "MEETING_RECORDING_DECLINED":
    case "ACCOUNT_PAUSED":
    case "TIME_PROPOSED":
    case "HUMAN_REVIEW":
    case "VERIFICATION_DECIDED":
    case "VERIFICATION_REQUESTED":
    case "RELATIONSHIP_OUTCOME":
      return href === null
        ? { label: "Got it", href: null }
        : { label: "Open", href };
  }
}

/**
 * The card already names who: "Savanna Seed Partners asked for Pitch deck"
 * reads "Asked for Pitch deck" under their name.
 */
export function withoutName(title: string, name: string): string {
  if (!title.toLowerCase().startsWith(`${name.toLowerCase()} `)) return title;
  const rest = title.slice(name.length + 1).trim();
  return rest.length === 0
    ? title
    : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/**
 * Unread notices and due reminders, folded to one card per relationship
 * and kind (or per kind and title when the notice names no relationship),
 * newest first. The relationship is matched from the notice's own link
 * against the person's own list, never from the notice's words.
 */
export function needsYouCards(input: {
  readonly notices: readonly NotificationDto[];
  readonly reminders: readonly ReminderDto[];
  readonly items: readonly RelationshipSummaryDto[];
  readonly side: ListSide;
  readonly now: number;
  /** Each relationship's own next step, from nextStepFor. */
  readonly steps?: readonly {
    readonly item: RelationshipSummaryDto;
    readonly step: NextStep;
    /** When it last moved: a message, else the state change. */
    readonly at: string;
  }[];
}): readonly NeedsYouCard[] {
  const byCounterpart = new Map(
    input.items.map((item) => [item.counterpart.id.toLowerCase(), item]),
  );
  const byRelationship = new Map(
    input.items.map((item) => [item.relationshipId, item]),
  );
  const cards = new Map<
    string,
    NeedsYouCard & { noticeIds: string[]; count: number }
  >();
  /** relationship|family pairs a card already stands for. */
  const families = new Set<string>();
  const ordered = input.notices
    .filter((notice) => !notice.read)
    .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const notice of ordered) {
    const match = notice.linkPath === null ? null : LINK.exec(notice.linkPath);
    const relationship =
      match?.[2] === undefined
        ? null
        : (byCounterpart.get(match[2].toLowerCase()) ?? null);
    const key =
      relationship === null
        ? `${notice.kind}|${notice.title.trim().toLowerCase()}`
        : `${relationship.relationshipId}|${notice.kind}`;
    const existing = cards.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.noticeIds.push(notice.id);
      continue;
    }
    cards.set(key, {
      key,
      title:
        relationship === null
          ? notice.title
          : withoutName(notice.title, relationship.counterpart.name),
      relationship,
      latestAt: notice.createdAt,
      count: 1,
      noticeIds: [notice.id],
      reminderId: null,
      action: actionFor(notice.kind, input.side, notice.linkPath),
    });
    if (relationship !== null) {
      families.add(
        `${relationship.relationshipId}|${noticeFamily(notice.kind)}`,
      );
    }
  }
  for (const reminder of input.reminders) {
    const due =
      reminder.status === "DELIVERED" ||
      (reminder.status === "PENDING" &&
        Date.parse(reminder.dueAt) <= input.now);
    if (!due || reminder.meetingId !== null) continue;
    const relationship =
      reminder.relationshipId === null
        ? null
        : (byRelationship.get(reminder.relationshipId) ?? null);
    cards.set(`reminder|${reminder.id}`, {
      key: `reminder|${reminder.id}`,
      title: reminder.title,
      relationship,
      latestAt: reminder.dueAt,
      count: 1,
      noticeIds: [],
      reminderId: reminder.id,
      action: { label: "Done", href: null },
    });
    if (relationship !== null) {
      // A due reminder is the relationship's follow-up.
      families.add(`${relationship.relationshipId}|follow-up`);
    }
  }
  for (const { item, step, at } of input.steps ?? []) {
    if (!isOwnStep(step)) continue;
    const family = stepFamily(step);
    const followUp = step.label === "Follow up";
    if (
      (family !== "other" &&
        families.has(`${item.relationshipId}|${family}`)) ||
      (followUp && families.has(`${item.relationshipId}|follow-up`))
    ) {
      continue;
    }
    const key = `${item.relationshipId}|step`;
    cards.set(key, {
      key,
      title: step.why,
      relationship: item,
      latestAt: at,
      count: 1,
      noticeIds: [],
      reminderId: null,
      action: { label: step.label ?? "Open", href: step.href },
      step: true,
    });
  }
  return [...cards.values()].toSorted(
    (a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt),
  );
}
