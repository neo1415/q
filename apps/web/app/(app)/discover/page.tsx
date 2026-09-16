import type { Metadata } from "next";
import Link from "next/link";

import { listInvestorMandates } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/**
 * Discover shell. The mobile vertical feed arrives with its own packet; this
 * surface is deliberately a first-class empty state, and the shell adds no
 * chrome that would stop the future feed from taking the full viewport.
 * It does know whether the mandate is already set, so a person who has
 * finished is not told to start.
 */
export default async function DiscoverPage() {
  const context = await resolveOwnContext();
  let mandateReady = false;
  if (context.kind === "INVESTOR") {
    const session = await apiSession();
    if (session !== null) {
      try {
        const page = await listInvestorMandates(
          session,
          context.investorOrganisationId,
          { status: "ACTIVE", limit: 1 },
        );
        mandateReady = page.items.length > 0;
      } catch {
        // Unknown is shown as not ready; nothing is invented.
      }
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Discover"
        description="Opportunities ranked by fit and evidence, with the reasons alongside."
      />
      {mandateReady ? (
        <EmptyState
          title="Your mandate is set. Opportunities appear here as companies become discoverable."
          description="Q matches on your declared mandate and observed evidence, and explains every recommendation. Ask Q about your mandate any time."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Ask Q
            </Link>
          }
        />
      ) : (
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
      )}
    </PageContainer>
  );
}
