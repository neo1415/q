import type { Metadata } from "next";
import { Suspense } from "react";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { CapitalSkeleton } from "@/features/capital/capital-book";
import { CapitalScreen } from "@/features/capital/capital-screen";
import { capitalTabFrom } from "@/features/capital/capital-tabs";

export const metadata: Metadata = { title: "Capital" };

// The objective is read under the person's own session on every request.
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Capital workspace: for a founder, in tabs (`?tab=`, design
 * docs/design/2026-10-08/capital-tabs), each reading only its own data;
 * for an investor, their commitments, mandate and relationships. The round
 * card's shape holds the page while it loads.
 */
export default async function CapitalPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const horizon = one(params["horizon"]);
  const requested = one(params["tab"]);
  const tab = capitalTabFrom({
    tab: requested,
    round: one(params["round"]),
    horizon,
  });
  return (
    <PageContainer>
      <PageHeader title="Capital" />
      <Suspense fallback={<CapitalSkeleton />}>
        <CapitalScreen
          tab={tab}
          hadTabParam={requested !== undefined}
          horizon={horizon}
        />
      </Suspense>
    </PageContainer>
  );
}
