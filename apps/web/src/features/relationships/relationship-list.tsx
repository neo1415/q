import Link from "next/link";

import type { RelationshipSummaryDto } from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import {
  formatRelationshipDate,
  NEXT_STEP_WORDS,
  relationshipHref,
  relationshipsNeedingYou,
  STATE_WORDS,
} from "./relationship-words";

/**
 * A side's relationships, as hairline rows (CQ-WEB-030; doc 17 §83;
 * spec §13 "/capital: objective + relationship timeline list").
 *
 * One row per counterpart: who, where it stands in words, since when,
 * and what is next. No card around each row, no badge, no colour carrying
 * meaning, no count. The row opens the relationship's own page.
 */
export function RelationshipList({
  items,
  emptySentence,
  unread,
}: {
  readonly items: readonly RelationshipSummaryDto[];
  readonly emptySentence: string;
  /** R34: unread chat messages per relationship id. */
  readonly unread?: ReadonlyMap<string, number> | undefined;
}) {
  if (items.length === 0) {
    return (
      <p
        className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)"
        data-state="empty"
      >
        {emptySentence}
      </p>
    );
  }
  return (
    <ul
      aria-label="Relationships"
      className="cq-panel-rows flex max-w-(--cq-layout-reading) flex-col"
    >
      {items.map((item) => (
        <li
          key={item.relationshipId}
          data-relationship-id={item.relationshipId}
        >
          <RelationshipRow
            item={item}
            unread={unread?.get(item.relationshipId) ?? 0}
          />
        </li>
      ))}
    </ul>
  );
}

function RelationshipRow({
  item,
  unread,
}: {
  readonly item: RelationshipSummaryDto;
  readonly unread: number;
}) {
  return (
    <Link
      href={relationshipHref(item)}
      className="flex min-h-11 items-center gap-3 py-3 outline-offset-2 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="cq-body text-(--cq-text-primary)">
          {item.counterpart.name}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">
          {STATE_WORDS[item.state]}
          <span className="cq-numeric">
            {" "}
            since {formatRelationshipDate(item.stateSince)}
          </span>
        </span>
        <span className="cq-caption text-(--cq-text-tertiary)">
          Next: {NEXT_STEP_WORDS[item.nextStep]}
        </span>
      </span>
      {unread > 0 ? (
        // Said in words, not by colour alone.
        <span
          className="cq-caption cq-numeric shrink-0 rounded-full bg-(--cq-accent-soft) px-2 py-0.5 text-(--cq-text-primary)"
          data-unread={unread}
        >
          {unread === 1
            ? "1 new message"
            : `${unread > 99 ? "99+" : unread} new messages`}
        </span>
      ) : null}
      <ChevronRight
        size={ICON_SIZE.compact}
        aria-hidden="true"
        className="shrink-0 text-(--cq-text-tertiary)"
      />
    </Link>
  );
}

/**
 * The relationships waiting on the person, ready to drop into the Q
 * page's "Now / Needs you" column (spec §7.1; UXA's Board). Renders
 * nothing when nothing needs them -- an empty "Needs you" is not an item.
 * Pass the items from `listInvestorRelationships` or
 * `listCompanyRelationships`; this component filters them.
 */
export function RelationshipNeedsYou({
  items,
}: {
  readonly items: readonly RelationshipSummaryDto[];
}) {
  const needing = relationshipsNeedingYou(items);
  if (needing.length === 0) return null;
  return (
    <ul aria-label="Relationships needing you" className="flex flex-col gap-1">
      {needing.map((item) => (
        <li key={item.relationshipId} data-needs-you={item.nextStep}>
          <Link
            href={relationshipHref(item)}
            className="flex min-h-11 flex-col justify-center gap-0.5 rounded-(--cq-radius-sm) px-2 py-2 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          >
            <span className="cq-body-sm text-(--cq-text-primary)">
              {item.nextStep === "ANSWER_INTEREST"
                ? `Answer ${item.counterpart.name}'s interest`
                : `Arrange a first meeting with ${item.counterpart.name}`}
            </span>
            <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {STATE_WORDS[item.state]} since{" "}
              {formatRelationshipDate(item.stateSince)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
