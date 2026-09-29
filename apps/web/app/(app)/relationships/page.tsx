import type { Metadata } from "next";
import Link from "next/link";

import { getChatUnread } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Plus } from "@capital-q/ui/icons";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import {
  ownRelationships,
  relationshipDigests,
} from "@/features/relationships/relationship-data";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";
import { NoticesPanel } from "@/features/schedule/notices-panel";

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
  const [items, unread] = await Promise.all([
    ownRelationships(context),
    unreadByRelationship(),
  ]);
  const digests =
    items === undefined ? {} : await relationshipDigests(context, items);
  const side =
    context.kind === "FOUNDER"
      ? "COMPANY"
      : context.kind === "INVESTOR"
        ? "INVESTOR"
        : "NONE";

  return (
    <PageContainer className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <PageHeader
            title="Relationships"
            description={
              side === "INVESTOR"
                ? "Every company your organisation has discovered or approached, and where each stands."
                : side === "COMPANY"
                  ? "Every investor organisation your company is connected with or has approached, and where each stands."
                  : undefined
            }
          />
        </div>
        {side === "NONE" ? null : (
          <div className="flex shrink-0 flex-wrap gap-2">
            {side === "INVESTOR" ? (
              // ADR 0023: founders' Connection Requests wait on the investor here.
              <Link
                href="/investors"
                className={buttonClassName("secondary")}
                data-founder-requests-link
              >
                Founder requests
              </Link>
            ) : null}
            {/* A relationship starts where its first step is taken:
                interest from Discover, or a request from Investors. */}
            <Link
              href={side === "INVESTOR" ? "/discover" : "/investors"}
              className={buttonClassName("primary")}
              data-add-relationship
            >
              <Plus size={ICON_SIZE.regular} aria-hidden="true" />
              Add relationship
            </Link>
          </div>
        )}
      </div>
      {/* BIZ-008: due reminders and notices, before the list. */}
      <NoticesPanel />
      <RelationshipsIndex
        side={side}
        items={items}
        unread={unread}
        digests={digests}
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
