import type { Metadata } from "next";
import Link from "next/link";

import {
  getChatUnread,
  getFitProfiles,
  listNotifications,
  listReminders,
} from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  type FitProfileDto,
  type NotificationDto,
  type RelationshipSummaryDto,
  type ReminderDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Plus } from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import {
  ownRelationships,
  relationshipDigests,
} from "@/features/relationships/relationship-data";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";
import {
  listOrder,
  pageAfter,
} from "@/features/relationships/relationships-view";

export const metadata: Metadata = { title: "Relationships" };

// Read under the person's own session on every request.
export const dynamic = "force-dynamic";

/**
 * Relationships (R27): every canonical relationship of the person's
 * company or investor organisation, one row each, opening the existing
 * relationship page. State and dates come from the API's projection over
 * relationship events; nothing here recomputes them.
 */
export default async function RelationshipsPage() {
  const context = await resolveOwnContext();
  const [items, unread, needs] = await Promise.all([
    ownRelationships(context),
    unreadByRelationship(),
    noticesAndReminders(),
  ]);
  const side =
    context.kind === "FOUNDER"
      ? "COMPANY"
      : context.kind === "INVESTOR"
        ? "INVESTOR"
        : "NONE";
  // The first page's cards are read in full (later pages by cursor), beside
  // the investor's fit read: both need only the list (L1 latency sweep).
  const [digests, fits] = await Promise.all([
    items === undefined
      ? {}
      : relationshipDigests(
          context,
          pageAfter(items.toSorted(listOrder), null).items,
        ),
    side === "INVESTOR" ? relationshipFits(items) : undefined,
  ]);
  const now = readClock();

  return (
    <PageContainer className="flex flex-col gap-4">
      {/* Search comes straight after the name (founder critique
          2026-10-04); adding one is a small control beside the title. */}
      <div className="flex items-center gap-2">
        <h1 className="cq-title-lg min-w-0 flex-1 text-(--cq-text-primary)">
          Relationships
        </h1>
        {side === "INVESTOR" ? (
          // ADR 0023: founders' Connection Requests wait on the investor here.
          <Link
            href="/investors"
            className={buttonClassName("quiet", "compact")}
            data-company-requests-link
          >
            Company requests
          </Link>
        ) : null}
        {side === "NONE" ? null : (
          // A relationship starts where its first step is taken: interest
          // from Discover, or a request from Investors.
          <Link
            href={side === "INVESTOR" ? "/discover" : "/investors"}
            className={buttonClassName("secondary", "compact")}
            data-add-relationship
          >
            <Plus size={ICON_SIZE.compact} aria-hidden="true" />
            Add
          </Link>
        )}
      </div>
      <RelationshipsIndex
        side={side}
        items={items}
        unread={unread}
        digests={digests}
        notices={needs.notices}
        reminders={needs.reminders}
        now={now}
        fits={fits}
      />
    </PageContainer>
  );
}

/** R34: unread chat per relationship; an unreadable count is simply none. */
async function unreadByRelationship(): Promise<ReadonlyMap<string, number>> {
  const session = await apiSession();
  if (session === null) return new Map();
  try {
    const { items } = await getChatUnread(session);
    return new Map(items.map((item) => [item.relationshipId, item.unread]));
  } catch {
    return new Map();
  }
}

/** When the page was read: rows say "2h" from here, on server and browser alike. */
function readClock(): number {
  return Date.now();
}

/** BIZ-008: the person's own notices and reminders; unreadable is none. */
async function noticesAndReminders(): Promise<{
  readonly notices: readonly NotificationDto[];
  readonly reminders: readonly ReminderDto[];
}> {
  const session = await apiSession();
  if (session === null) return { notices: [], reminders: [] };
  const [notices, reminders] = await Promise.all([
    listNotifications(session)
      .then((list) => list.items)
      .catch(() => [] as const),
    listReminders(session)
      .then((list) => list.items)
      .catch(() => [] as const),
  ]);
  return { notices, reminders };
}

/**
 * Fit with the investor's own mandate for the companies they are in touch
 * with (ADR 0052; B3). A company without a fit simply shows none.
 */
async function relationshipFits(
  items: readonly RelationshipSummaryDto[] | undefined,
): Promise<Readonly<Record<string, FitProfileDto>>> {
  const ids = [
    ...new Set(
      (items ?? [])
        .filter((item) => item.counterpart.kind === "COMPANY")
        .map((item) => item.counterpart.id),
    ),
  ].slice(0, FIT_IDS_MAX);
  const session = await qApiSession();
  if (session === null || ids.length === 0) return {};
  try {
    const { items: fits } = await getFitProfiles(session, ids);
    return Object.fromEntries(fits.map((f) => [f.companyId, f.profile]));
  } catch {
    return {};
  }
}
