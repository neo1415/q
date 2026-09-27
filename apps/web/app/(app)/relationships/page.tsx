import type { Metadata } from "next";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
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
  const items = await ownRelationships(context);
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
      <RelationshipsIndex side={side} items={items} />
    </PageContainer>
  );
}
