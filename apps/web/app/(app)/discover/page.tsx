import type { Metadata } from "next";
import Link from "next/link";

import { preload } from "react-dom";

import {
  authorisePitchPlayback,
  discoverCompanies,
  discoverInvestors,
} from "@capital-q/api-client";
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
      kept across a visit to a company. The first page is read here, under
      the person's own session, only so the first poster can be in the
      HTML and be the page's LCP (spec §9.5). The controller is seeded with
      it and owns every page after, the position and the preload budget
      (CQ-WEB-020/021). Either read failing just means the client loads as
      before; neither is fatal to the page.
    */
    const slate = await discoverCompanies(session, {}).catch(() => null);
    const first = slate?.items[0];
    const authorization =
      first?.pitch == null
        ? null
        : await authorisePitchPlayback(
            session,
            first.companyId,
            first.pitch.mediaAssetId,
          ).catch(() => null);
    if (authorization?.posterUrl != null) {
      // The poster is on the CDN; the browser should ask for it before it
      // has parsed the rest of the page.
      preload(authorization.posterUrl, { as: "image", fetchPriority: "high" });
    }
    // The feed is immersive (spec §9; ADR 0017 C4/C5): the stage is the
    // page, so it takes the whole workspace rather than a reading column.
    // The heading is kept for assistive technology and the tab title.
    return (
      <>
        <h1 className="sr-only">Discover</h1>
        <InvestorFeedScreen
          initial={slate === null ? null : { slate, authorization }}
        />
      </>
    );
  }

  const slate = await discoverInvestors(session).catch(() => null);
  return (
    <PageContainer>
      <PageHeader
        title="Discover"
        description="Investors who chose to be discoverable, and what each one has said publicly."
      />
      {/* Interest already addressed to the company (CQ-NET-011). */}
      <Link
        href="/company/interest"
        className={buttonClassName("secondary", "compact")}
      >
        Investor interest in your company
      </Link>
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
