import type { Metadata } from "next";

import { getChatUnread } from "@capital-q/api-client";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";

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
  const side =
    context.kind === "FOUNDER"
      ? "COMPANY"
      : context.kind === "INVESTOR"
        ? "INVESTOR"
        : "NONE";

  return (
    <PageContainer>
      <PageHeader
        title="Relationships"
        description={
          side === "INVESTOR"
            ? "Every company your organisation has discovered or approached, and where each stands."
            : side === "COMPANY"
              ? "Every investor organisation that has approached your company, and where each stands."
              : undefined
        }
      />
      <RelationshipsIndex side={side} items={items} unread={unread} />
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
