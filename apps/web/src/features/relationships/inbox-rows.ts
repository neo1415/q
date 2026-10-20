import {
  isMatchedRelationshipState,
  type RelationshipBrief,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";

import { formatStamp } from "@/components/date-format";

import { relationshipHref, STATE_WORDS } from "./relationship-words";

/** One inbox row (inbox split, 2026-10-20): pure, so its order is tested. */
export type InboxRow = {
  readonly relationshipId: string;
  readonly name: string;
  readonly href: string;
  readonly photoUrl: string | null;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly matched: boolean;
  /** "Dev Patel: Ahead of the call…", "You: …", or why it is locked. */
  readonly preview: string;
  /** When the row last moved: its latest message, else its state. */
  readonly at: string;
  readonly unread: number;
};

/** Newest first: by the latest message, else by when the state changed. */
export function inboxRows(
  items: readonly RelationshipSummaryDto[],
  briefs: ReadonlyMap<string, RelationshipBrief>,
  unread: ReadonlyMap<string, number>,
): readonly InboxRow[] {
  return items
    .filter((item) => item.state !== "DISCOVERED" && item.state !== "DECLINED")
    .map((item): InboxRow => {
      const matched = isMatchedRelationshipState(item.state);
      const latest = briefs.get(item.relationshipId)?.messages.latest;
      const message = latest?.status === "OK" ? latest.message : null;
      const preview = !matched
        ? item.state === "INTEREST_EXPRESSED"
          ? `Interest sent ${formatStamp(item.stateSince)}`
          : STATE_WORDS[item.state]
        : message === null
          ? "No messages yet"
          : `${message.from === "YOU" ? "You" : message.senderName}: ${message.preview ?? ""}`;
      return {
        relationshipId: item.relationshipId,
        name: item.counterpart.name,
        href: `${relationshipHref(item)}/messages`,
        photoUrl: item.counterpart.photoUrl ?? null,
        ...(item.counterpart.kind === "COMPANY"
          ? { companyId: item.counterpart.id }
          : { investorOrganisationId: item.counterpart.id }),
        matched,
        preview,
        at: message?.sentAt ?? item.stateSince,
        unread: unread.get(item.relationshipId) ?? 0,
      };
    })
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
