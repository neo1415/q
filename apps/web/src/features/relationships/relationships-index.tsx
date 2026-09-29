import Link from "next/link";

import type { RelationshipSummaryDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import type { RelationshipDigest } from "./relationship-data";
import { RelationshipsBoard } from "./relationships-board";

/**
 * The Relationships page body (R27). One card per canonical relationship
 * (founder design 2026-09-28; see RelationshipsBoard), or one sentence and
 * one way forward when there is nothing to list.
 * "Since" is the time of the relationship's latest event: in V1 every
 * relationship event moves its state, so it is also the last activity.
 */
export function RelationshipsIndex({
  side,
  items,
  unread,
  digests = {},
}: {
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly digests?: Readonly<Record<string, RelationshipDigest>> | undefined;
  readonly items: readonly RelationshipSummaryDto[] | undefined;
  /** R34: unread chat messages per relationship id. */
  readonly unread?: ReadonlyMap<string, number> | undefined;
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
  return (
    <RelationshipsBoard
      items={items}
      digests={digests}
      unread={Object.fromEntries(unread ?? new Map<string, number>())}
    />
  );
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
