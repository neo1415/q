import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Discover" };

/**
 * Discover shell. The mobile vertical feed arrives with its own packet; this
 * surface is deliberately a first-class empty state, and the shell adds no
 * chrome that would stop the future feed from taking the full viewport.
 */
export default function DiscoverPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Discover"
        description="Opportunities ranked by fit and evidence, with the reasons alongside."
      />
      <EmptyState
        title="Relevant opportunities will appear here once your investment mandate is ready."
        description="Q matches on declared mandate and observed evidence, and explains every recommendation. Nothing is ranked by popularity."
        action={
          <Link
            href="/onboarding/investor"
            className={buttonClassName("secondary")}
          >
            Set up your mandate
          </Link>
        }
      />
    </PageContainer>
  );
}
