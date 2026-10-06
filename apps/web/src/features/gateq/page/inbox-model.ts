import type {
  GateqFitBand,
  GateqInboxDto,
  GateqInboxItemDto,
  GateqInboxView,
  GateqPassReason,
} from "@capital-q/contracts";

/**
 * The GateQ inbox's words and keys (F4), pure so they are tested without a
 * browser. Fit is the engine's band at submission; the reply clock is the
 * firm's own published promise. Nothing here ranks by activity.
 */

export const VIEW_CHIPS: readonly (readonly [GateqInboxView, string])[] = [
  ["INBOX", "Inbox"],
  ["STARRED", "Starred"],
  ["ASSIGNED_TO_ME", "Assigned to me"],
  ["FITS", "Fits"],
  ["PARTIAL", "Partial"],
  ["NOT_A_FIT", "Not a fit"],
  ["PASSED", "Passed"],
  ["ARCHIVED", "Archived"],
];

/** Assigned-to-me only means something in a firm of more than one. */
export function chipsFor(solo: boolean) {
  return VIEW_CHIPS.filter(([view]) => !(solo && view === "ASSIGNED_TO_ME"));
}

export const FIT_WORDS: Readonly<Record<GateqFitBand, string>> = {
  FITS: "Fits your rules",
  PARTIAL: "Partial",
  NOT_A_FIT: "Not a fit",
};

export const FIT_GLYPH: Readonly<Record<GateqFitBand, "fit" | "part" | "no">> =
  {
    FITS: "fit",
    PARTIAL: "part",
    NOT_A_FIT: "no",
  };

export function rulesWords(rules: GateqInboxItemDto["rules"]): string {
  if (rules.total === 0) return "No rules";
  const base = `${rules.met} of ${rules.total} rules`;
  return rules.unknown === 0 ? base : `${base}, ${rules.unknown} unanswered`;
}

export function replyWords(
  item: Pick<GateqInboxItemDto, "replyState" | "daysLeft" | "folder">,
): {
  readonly text: string;
  readonly warn: boolean;
} | null {
  switch (item.replyState) {
    case "NONE":
      return null;
    case "ANSWERED":
      return {
        text: item.folder === "PASSED" ? "Passed" : "Replied",
        warn: false,
      };
    case "OVERDUE":
      return { text: "Reply overdue", warn: true };
    case "DUE_SOON":
    case "ON_TRACK": {
      const days = item.daysLeft ?? 0;
      return {
        text:
          days === 0
            ? "Reply today"
            : `${days} day${days === 1 ? "" : "s"} left`,
        warn: item.replyState === "DUE_SOON",
      };
    }
  }
}

/** "Today 09:40", "Yesterday", "2 Oct": a mail client's received column. */
export function receivedWords(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) {
    return at.toISOString().slice(11, 16);
  }
  if (diff === 1) return "Yesterday";
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Q's view of an application, from the engine's band and the reply promise
 * alone: a short, labelled opinion, never presented as a verified fact.
 */
export function qView(item: GateqInboxItemDto): {
  readonly lead: string;
  readonly why: string;
} {
  if (item.fit === "NOT_A_FIT") {
    return {
      lead: "Outside your rules",
      why: "A required rule of your gate isn't met. If you pass, they get a reason.",
    };
  }
  if (item.fit === "PARTIAL" || item.rules.unknown > 0) {
    return {
      lead: "Too early to say",
      why: `${item.rules.unknown} of your rules ${item.rules.unknown === 1 ? "is" : "are"} unanswered. Unanswered isn't a no; ask them.`,
    };
  }
  return {
    lead: "Worth a look",
    why:
      item.replyState === "DUE_SOON" || item.replyState === "OVERDUE"
        ? "Meets every rule of your gate, and your reply promise is close."
        : "Meets every rule of your gate.",
  };
}

export const PASS_REASONS: readonly (readonly [GateqPassReason, string])[] = [
  ["OUTSIDE_STAGE", "Outside our stage"],
  ["OUTSIDE_SECTOR", "Outside our sector"],
  ["CHEQUE_DOES_NOT_FIT", "Cheque doesn't fit"],
  ["TIMING", "Timing"],
  ["OTHER", "Other"],
];

/** A first draft, in the house's warm, specific style; theirs to change. */
export function draftPass(input: {
  readonly founderName: string | null;
  readonly companyName: string;
  readonly fund: string;
  readonly reason: GateqPassReason;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  const why: Readonly<Record<GateqPassReason, string>> = {
    OUTSIDE_STAGE: `${input.companyName} is at a different stage from where we invest, so we can't take this round.`,
    OUTSIDE_SECTOR: `${input.companyName} sits outside the sectors we back, so we can't take this round.`,
    CHEQUE_DOES_NOT_FIT:
      "the size of this round doesn't fit the cheques we write, so we can't take it.",
    TIMING:
      "the timing doesn't work for us right now, so we can't take this round.",
    OTHER: "we've decided not to take this round.",
  };
  return `${hello} thank you for applying to ${input.fund}. After looking at it carefully, ${why[input.reason]} We'd be glad to hear from you when you raise next.`;
}

export function draftReply(input: {
  readonly founderName: string | null;
  readonly fund: string;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  return `${hello} thank you for applying to ${input.fund}. We've read what you sent and would like to learn more. Could you share a time for a 30-minute call next week?`;
}

export type ShortcutCommand =
  | "NEXT"
  | "PREVIOUS"
  | "ARCHIVE"
  | "STAR"
  | "PASS"
  | "SEARCH"
  | "SELECT"
  | "OPEN"
  | "BACK"
  | "REPLY"
  | "DOWNLOAD"
  | "HELP";

/**
 * Gmail's keys, so investors already know them (j/k, e, s, #, /, x, o, u,
 * r, d, ?). Off while typing, off with a modifier, and off entirely when
 * the person turns single-key shortcuts off (WCAG 2.1.4).
 */
export function shortcutFor(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: {
    readonly tagName?: string;
    readonly isContentEditable?: boolean;
  } | null;
}): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = event.target?.tagName?.toUpperCase() ?? "";
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    event.target?.isContentEditable === true
  ) {
    return null;
  }
  const map: Readonly<Record<string, ShortcutCommand>> = {
    j: "NEXT",
    k: "PREVIOUS",
    e: "ARCHIVE",
    s: "STAR",
    "#": "PASS",
    "/": "SEARCH",
    x: "SELECT",
    o: "OPEN",
    Enter: "OPEN",
    u: "BACK",
    r: "REPLY",
    d: "DOWNLOAD",
    "?": "HELP",
  };
  return map[event.key] ?? null;
}

/** The list a search narrows: company, one-liner, sector, labels. */
export function matchesSearch(item: GateqInboxItemDto, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return true;
  return [
    item.companyName,
    item.oneLiner ?? "",
    item.sector ?? "",
    item.country ?? "",
    ...item.labels,
  ]
    .join(" ")
    .toLowerCase()
    .includes(wanted);
}

export function unreadCount(inbox: Pick<GateqInboxDto, "counts">): number {
  return inbox.counts.INBOX;
}
