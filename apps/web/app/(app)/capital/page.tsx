import type { Metadata } from "next";
import { Suspense } from "react";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { CapitalSkeleton } from "@/features/capital/capital-book";
import { CapitalScreen } from "@/features/capital/capital-screen";

export const metadata: Metadata = { title: "Capital" };

// The objective is read under the person's own session on every request.
export const dynamic = "force-dynamic";

/**
 * Capital workspace: rounds, the money in them and each commitment's next
 * step, then the relationships behind them. The round card's shape holds
 * the page while the book loads.
 */
export default function CapitalPage() {
  return (
    <PageContainer>
      <PageHeader title="Capital" />
      <Suspense fallback={<CapitalSkeleton />}>
        <CapitalScreen />
      </Suspense>
    </PageContainer>
  );
}
