import type {
  NotificationDto,
  QAttentionItem,
  QAttentionReport,
  QAttentionSource,
  WorkforceJobDetailDto,
} from "@capital-q/contracts";

import type { ArrivalCard } from "./arrival";

/**
 * "Everything that needs you", as one report (RECOVERY-2026-10 lead
 * contract `QAttentionReport`; workstream B owns the server read).
 *
 * Until B's endpoint is composed, the arrival builds the same report from
 * the reads it already makes under the person's session: the decision
 * cards (approvals and held drafts), their NEEDS_YOU notices, and their
 * agents' jobs. A source whose read failed -- or that this bridge cannot
 * read at all -- is listed in `unread`, and is said as "I couldn't check
 * …", never as "nothing needs you" (live 2026-10-08: "nothing is waiting"
 * while an investor's message had waited 21 hours).
 *
 * Swap point: `AttentionReader`. When B's reader lands, the arrival's
 * read uses it and this adapter becomes its fallback.
 */

export type AttentionReader = (
  since: string,
) => Promise<QAttentionReport | null>;

/** Which attention source a NEEDS_YOU notice is, by its kind. */
const NOTICE_SOURCE: Partial<
  Readonly<Record<NotificationDto["kind"], QAttentionSource>>
> = {
  CHAT_MESSAGE: "UNANSWERED_MESSAGE",
  Q_MESSAGE: "UNANSWERED_MESSAGE",
  EMAIL_RECEIVED: "UNANSWERED_MESSAGE",
  DILIGENCE: "DOCUMENT_REQUEST",
  INTEREST_RECEIVED: "INTEREST_REQUEST",
  CONNECTION_REQUESTED: "INTEREST_REQUEST",
  TIME_PROPOSED: "MEETING",
  MEETING_SCHEDULED: "MEETING",
  REMINDER: "REMINDER",
};

export function sourceOfNotice(
  kind: NotificationDto["kind"],
): QAttentionSource {
  return NOTICE_SOURCE[kind] ?? "NOTICE";
}

/** The sources this bridge reads through notices. */
const NOTICE_SOURCES: readonly QAttentionSource[] = [
  "UNANSWERED_MESSAGE",
  "DOCUMENT_REQUEST",
  "INTEREST_REQUEST",
  "MEETING",
  "REMINDER",
  "NOTICE",
];

export type AttentionReads = {
  /** The decision cards; null when the approvals read failed. */
  readonly cards: readonly ArrivalCard[] | null;
  /** Unread NEEDS_YOU notices; null when the notices read failed. */
  readonly notices: readonly NotificationDto[] | null;
  /** Their agents' recent jobs; null when the read failed. */
  readonly jobs: readonly WorkforceJobDetailDto[] | null;
  /**
   * Investors only: how many new matching companies; null when the slate
   * read failed; undefined when the person is not an investor.
   */
  readonly newMatches?: number | null | undefined;
  readonly since: string;
  readonly now: Date;
};

const key = (source: QAttentionSource, id: string) =>
  `${source}:${id}`.slice(0, 160);

/** Within the contract's bounds, whatever a read returned. */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function attentionFromReads(reads: AttentionReads): QAttentionReport {
  const items: QAttentionItem[] = [];
  const unread = new Set<QAttentionSource>();

  if (reads.cards === null) {
    unread.add("APPROVAL");
    unread.add("HELD_DRAFT");
  } else {
    for (const card of reads.cards) {
      items.push({
        key: key(card.kind === "HELD" ? "HELD_DRAFT" : "APPROVAL", card.key),
        source: card.kind === "HELD" ? "HELD_DRAFT" : "APPROVAL",
        title: clip(card.title, 200),
        detail: clip(card.summary, 600),
        ...(card.approvalId === null
          ? {}
          : { entity: { kind: "APPROVAL" as const, id: card.approvalId } }),
        ...(card.counterpart === null
          ? {}
          : { counterpart: clip(card.counterpart, 120) }),
        since: card.at,
        decidable: card.canDecide,
      });
    }
  }

  if (reads.notices === null) {
    for (const source of NOTICE_SOURCES) unread.add(source);
  } else {
    for (const notice of reads.notices) {
      if (notice.priority !== "NEEDS_YOU" || notice.read) continue;
      const source = sourceOfNotice(notice.kind);
      items.push({
        key: key(source, notice.id),
        source,
        title: clip(notice.title, 200),
        ...(notice.body === null ? {} : { detail: clip(notice.body, 600) }),
        since: notice.createdAt,
        decidable: false,
      });
    }
  }

  if (reads.jobs === null) {
    unread.add("AGENT_BLOCKED");
  } else {
    const from = Date.parse(reads.since);
    for (const { job } of reads.jobs) {
      if (job.status !== "FAILED" || Date.parse(job.updatedAt) < from) continue;
      items.push({
        key: key("AGENT_BLOCKED", job.id),
        source: "AGENT_BLOCKED",
        title: clip(`An agent stopped: ${job.goal}`, 200),
        entity: { kind: "JOB", id: job.id },
        since: job.updatedAt,
        decidable: false,
      });
    }
  }

  if (reads.newMatches === null) unread.add("NEW_MATCHES");
  else if (reads.newMatches !== undefined && reads.newMatches > 0) {
    items.push({
      key: key("NEW_MATCHES", reads.since),
      source: "NEW_MATCHES",
      title:
        reads.newMatches === 1
          ? "A new company fits your mandate"
          : `${String(reads.newMatches)} new companies fit your mandate`,
      since: reads.since,
      decidable: false,
    });
  }

  return {
    items: items.slice(0, 50),
    // What Q did comes from the work-since read, beside this report.
    activity: null,
    unread: [...unread],
    readAt: reads.now.toISOString(),
  };
}

const UNREAD_WORDS: Readonly<Record<QAttentionSource, string>> = {
  UNANSWERED_MESSAGE: "your messages",
  APPROVAL: "approvals",
  HELD_DRAFT: "held drafts",
  AGENT_BLOCKED: "your agents",
  DOCUMENT_REQUEST: "document requests",
  INTEREST_REQUEST: "interest requests",
  MEETING: "meetings",
  REMINDER: "reminders",
  NEW_MATCHES: "your feed",
  NOTICE: "notifications",
};

/** The unread sources, said once each, in contract order. */
export function unreadWords(
  unread: readonly QAttentionSource[],
): string | null {
  // Notices fail as one read: say it once, as the person thinks of it.
  const said = new Set<string>();
  for (const source of unread) said.add(UNREAD_WORDS[source]);
  const named = [...said];
  if (named.length === 0) return null;
  if (named.includes("notifications")) {
    const rest = named.filter(
      (word) =>
        word === "approvals" ||
        word === "held drafts" ||
        word === "your agents" ||
        word === "your feed",
    );
    return `I couldn't check ${listOf(["your messages and requests", ...rest])} just now, so I can't say nothing's waiting there.`;
  }
  return `I couldn't check ${listOf(named)} just now.`;
}

function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/**
 * The attention lines not already a decision card: what waits on them
 * that is acted on elsewhere (a message to answer, a document request).
 */
export function attentionLines(
  report: QAttentionReport,
): readonly QAttentionItem[] {
  return report.items.filter(
    (item) =>
      item.source !== "APPROVAL" &&
      item.source !== "HELD_DRAFT" &&
      item.source !== "NEW_MATCHES",
  );
}

/** Where an attention line is acted on, from its own notice link or kind. */
export function attentionHref(
  item: QAttentionItem,
  links: ReadonlyMap<string, string>,
): string {
  const link = links.get(item.key);
  if (link !== undefined && link.startsWith("/") && !link.startsWith("//")) {
    return link;
  }
  return ATTENTION_HOME[item.source];
}

/** Where each source is acted on when its notice carries no link. */
const ATTENTION_HOME: Readonly<Record<QAttentionSource, string>> = {
  UNANSWERED_MESSAGE: "/relationships",
  APPROVAL: "/work",
  HELD_DRAFT: "/work",
  AGENT_BLOCKED: "/work",
  DOCUMENT_REQUEST: "/documents",
  INTEREST_REQUEST: "/relationships",
  MEETING: "/relationships",
  REMINDER: "/work",
  NEW_MATCHES: "/discover",
  NOTICE: "/work",
};
