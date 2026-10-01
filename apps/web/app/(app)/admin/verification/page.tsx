import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminVerificationQueue } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { VerificationQueue } from "@/features/admin/verification-queue";

export const metadata: Metadata = { title: "Verification · Admin" };

export default async function AdminVerificationPage() {
  const context = await adminContext();
  if (context === null || !context.can("verification.read")) notFound();
  const rows = await getAdminVerificationQueue(context.session)
    .then((result) => result.rows)
    .catch(() => null);
  return (
    <PageSection
      id="verification"
      title="Verification requests"
      description="Oldest first. Each decision is recorded with its basis and who made it."
    >
      {rows === null ? (
        <ErrorState
          title="The queue couldn't load"
          description="Try again in a moment."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          title="No requests waiting"
          description="New requests appear here when a founder asks Capital Q to verify them."
        />
      ) : (
        <VerificationQueue
          rows={rows}
          canDecide={context.can("verification.decide")}
        />
      )}
    </PageSection>
  );
}
