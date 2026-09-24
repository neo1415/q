import type { Metadata } from "next";
import Link from "next/link";

import { discoverInvestors } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { DiscoverInvestors } from "@/features/discover/discover-screen";
import { InvestorFeedScreen } from "@/features/discover/investor-feed-screen";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/**
 * Discover (doc 19). An investor sees companies that made themselves
 * discoverable, ordered against their own declared mandate. A founder sees
 * investors who made themselves discoverable, ordered on what those
 * investors declared publicly — never on a mandate, which is theirs.
 *
 * The slate is built server-side by the discovery context under the
 * person's own session. Nothing on this page ranks anything.
 */
export default async function DiscoverPage() {
  const context = await resolveOwnContext();
  const session = await apiSession();

  if (context.kind === "NONE" && context.unavailable === true) {
    /*
      Capital Q could not be asked who this person is. That is not "no
      context": telling a signed-in investor to set up first because the
      API was restarting is the P1 this branch closes (CQ-VERIFY-001).
    */
    return (
      <PageContainer>
        <PageHeader
          title="Discover"
          description="Opportunities ranked by fit and evidence, with the reasons alongside."
        />
        <EmptyState
          title="Discover couldn't load."
          description="Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link href="/discover" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (context.kind === "NONE" || session === null) {
    return (
      <PageContainer>
        <PageHeader
          title="Discover"
          description="Opportunities ranked by fit and evidence, with the reasons alongside."
        />
        <EmptyState
          title="Tell Q what you're here to do first."
          description="Discover shows companies to investors and investors to founders. Which one you see follows from your setup."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Get set up
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (context.kind === "INVESTOR") {
    /*
      An investor gets the feed: one card at a time, one player, position
      kept across a visit to a company. The slate is not fetched here --
      the controller owns loading so that paging, position and the preload
      budget have a single owner (CQ-WEB-020/021).
    */
    return (
      <PageContainer>
        <PageHeader
          title="Discover"
          description="Companies that chose to be discoverable, ordered against the mandate you declared."
        />
        <InvestorFeedScreen />
      </PageContainer>
    );
  }

  const slate = await discoverInvestors(session).catch(() => null);
  return (
    <PageContainer>
      <PageHeader
        title="Discover"
        description="Investors who chose to be discoverable, and what each one has said publicly."
      />
      {slate === null ? (
        <EmptyState
          title="Discover couldn't load."
          description="Nothing is wrong with your profile. Try again in a moment."
        />
      ) : (
        <DiscoverInvestors items={slate.items} notes={slate.notes} />
      )}
    </PageContainer>
  );
}
