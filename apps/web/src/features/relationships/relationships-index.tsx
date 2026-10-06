import Link from "next/link";

import type {
  FitProfileDto,
  NotificationDto,
  RelationshipSummaryDto,
  ReminderDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import type { RelationshipDigest } from "./relationship-data";
import { RelationshipsBoard } from "./relationships-board";
import {
  cursorOf,
  listOrder,
  needsYouCards,
  pageAfter,
} from "./relationships-view";

/**
 * The Relationships page body (R27; founder critique 2026-10-04). One row
 * per canonical relationship with its one next step (see
 * RelationshipsBoard), "Needs you" folded to one card per relationship and
 * action, or one sentence and one way forward when there is nothing to list.
 */
export function RelationshipsIndex({
  side,
  items,
  unread,
  digests = {},
  notices = [],
  reminders = [],
  now = readClock(),
  fits,
}: {
  /** Fit with the investor's own mandate by company id (ADR 0052; B3). */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly digests?: Readonly<Record<string, RelationshipDigest>> | undefined;
  readonly items: readonly RelationshipSummaryDto[] | undefined;
  /** R34: unread chat messages per relationship id. */
  readonly unread?: ReadonlyMap<string, number> | undefined;
  /** BIZ-008: the person's own notices and reminders, for Needs you. */
  readonly notices?: readonly NotificationDto[] | undefined;
  readonly reminders?: readonly ReminderDto[] | undefined;
  readonly now?: number | undefined;
}) {
  if (side === "NONE") {
    return (
      <Empty
        sentence="Relationships belong to a company or an investor organisation. Set yours up, and every relationship it has gathers here."
        href="/welcome"
        action="Set up"
      />
    );
  }
  if (items === undefined) {
    return (
      <p
        className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)"
        data-state="unavailable"
      >
        Your relationships couldn&apos;t be read just now. Reload in a moment.
      </p>
    );
  }
  if (items.length === 0) {
    return side === "INVESTOR" ? (
      <Empty
        sentence="No relationships yet. Expressing interest in a company from Discover starts one."
        href="/discover"
        action="Open Discover"
      />
    ) : (
      <Empty
        sentence="No investor relationships yet. When an investor organisation expresses interest in your company, it appears here. Investors can only find you once your company is visible."
        href="/company/visibility"
        action="Check visibility"
      />
    );
  }
  const first = pageAfter(items.toSorted(listOrder), null);
  const last = first.items.at(-1);
  return (
    <RelationshipsBoard
      side={side}
      items={items}
      digests={digests}
      unread={Object.fromEntries(unread ?? new Map<string, number>())}
      needsYou={needsYouCards({ notices, reminders, items, side, now })}
      firstCursor={
        first.next === null || last === undefined ? null : cursorOf(last)
      }
      now={now}
      fits={fits}
    />
  );
}

function readClock(): number {
  return Date.now();
}

function Empty({
  sentence,
  href,
  action,
}: {
  readonly sentence: string;
  readonly href: string;
  readonly action: string;
}) {
  return (
    <div className="flex flex-col items-start gap-4" data-state="empty">
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {sentence}
      </p>
      <Link href={href} className={buttonClassName("secondary")}>
        {action}
      </Link>
    </div>
  );
}
