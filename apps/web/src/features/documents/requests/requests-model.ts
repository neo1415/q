import {
  DOCUMENTS_TABS,
  inboxItemOpen,
  type DocumentsTab,
  type RequestInboxItem,
} from "@capital-q/contracts";

/**
 * Founder documents (2026-10-08): the Documents page's tabs and the
 * Requested tab's pure parts, tested without a browser.
 */

export function documentsTabOf(raw: unknown): DocumentsTab {
  return typeof raw === "string" &&
    (DOCUMENTS_TABS as readonly string[]).includes(raw)
    ? (raw as DocumentsTab)
    : "mine";
}

export type InboxFilter = "OPEN" | "ANSWERED" | "DECLINED";

export function inboxFilterOf(item: RequestInboxItem): InboxFilter {
  if (inboxItemOpen(item)) return "OPEN";
  return item.kind === "DOCUMENT_REQUEST" && item.status === "DECLINED"
    ? "DECLINED"
    : "ANSWERED";
}

/** "waiting 3 days", "asked today": no invented deadline, only the facts. */
export function waitingWords(requestedAt: string, now: Date): string {
  const days = Math.floor(
    (now.getTime() - Date.parse(requestedAt)) / 86_400_000,
  );
  if (days <= 0) return "asked today";
  return days === 1 ? "waiting 1 day" : `waiting ${String(days)} days`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return letters.length === 0 ? "?" : letters;
}

/**
 * The intersection, for the Data room tab: each data-room document an
 * investor asked for (or that answered a request), with who and where it
 * stands. One mark per investor per document.
 */
export function requestedMarks(items: readonly RequestInboxItem[]): ReadonlyMap<
  string,
  readonly {
    readonly who: string;
    readonly status: "OPEN" | "SHARED" | "DECLINED";
  }[]
> {
  const marks = new Map<
    string,
    { who: string; status: "OPEN" | "SHARED" | "DECLINED" }[]
  >();
  for (const item of items) {
    if (item.kind !== "DOCUMENT_REQUEST" || item.dataRoom === null) continue;
    const who = item.investorOrganisationName ?? "an investor";
    const list = marks.get(item.dataRoom.documentId) ?? [];
    if (!list.some((mark) => mark.who === who)) {
      list.push({ who, status: item.status });
      marks.set(item.dataRoom.documentId, list);
    }
  }
  return marks;
}
