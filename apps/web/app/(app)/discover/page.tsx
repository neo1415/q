import type { Metadata } from "next";
import Link from "next/link";

import { preload } from "react-dom";

import {
  authorisePitchPlayback,
  discoverCompanies,
  discoverInvestors,
  listTaxonomyNodes,
  listYourCompanies,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { DiscoverInvestors } from "@/features/discover/discover-screen";
import { tabFromQuery } from "@/features/discover/discover-tab-query";
import { DiscoverTabs } from "@/features/discover/discover-tabs";
import { InvestorFeedScreen } from "@/features/discover/investor-feed-screen";
import { NetworkVideos } from "@/features/discover/network/network-videos";
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
export default async function DiscoverPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly tab?: string | string[];
    readonly company?: string | string[];
  }>;
} = {}) {
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
        <PageHeader title="Discover" />
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
        <PageHeader title="Discover" />
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
    // Discover's two tabs (follow-55): For you, and Your companies.
    const params = await searchParams;
    const initialTab = tabFromQuery(
      typeof params?.tab === "string" ? params.tab : undefined,
    );
    const focus =
      typeof params?.company === "string" &&
      /^[0-9a-f-]{36}$/iu.test(params.company)
        ? params.company.toLowerCase()
        : null;
    /*
      An investor gets the feed: one card at a time, one player, position
      kept across a visit to a company. The first page is read here, under
      the person's own session, only so the first poster can be in the
      HTML and be the page's LCP (spec §9.5). The controller is seeded with
      it and owns every page after, the position and the preload budget
      (CQ-WEB-020/021). Either read failing just means the client loads as
      before; neither is fatal to the page.
    */
    const [slate, sectors, yours] = await Promise.all([
      discoverCompanies(session, {}).catch(() => null),
      // The sector filter's options: the industry vocabulary, reference
      // data. Failing leaves the filter without sectors, nothing more.
      listTaxonomyNodes(session, "industry", { status: "ACTIVE", limit: 100 })
        .then((page) =>
          page.items.map((node) => ({
            nodeId: node.id,
            code: node.canonicalCode,
            label: node.displayName,
            depth: node.depth,
          })),
        )
        .catch(() => []),
      // Your companies' first page, only when that tab is the one linked
      // (follow-55); otherwise it is read when the tab is first opened.
      initialTab === "YOURS"
        ? listYourCompanies(session, { limit: 10 }).catch(() => null)
        : Promise.resolve(null),
    ]);
    /*
     * The cards the preload window can reach first (spec §9.5: active, the
     * next one buffering, the one after a poster) are authorised here, in
     * parallel, under the same session. On the client each of those asks
     * is a server action, and Next.js runs a page's actions one at a time:
     * measured on the local stack, the next card's startup buffer began
     * about four seconds after hydration, queued behind the others. An
     * authorization is a short metadata call, never media; nothing here is
     * fetched from the CDN except the first poster, below.
     */
    const reach = (slate?.items ?? []).slice(0, 3);
    const grants = await Promise.all(
      reach.map((item) =>
        item.pitch === null
          ? Promise.resolve(null)
          : authorisePitchPlayback(
              session,
              item.companyId,
              item.pitch.mediaAssetId,
            )
              .then((authorization) => ({
                companyId: item.companyId,
                authorization,
              }))
              .catch(() => null),
      ),
    );
    const warm = grants.filter((grant) => grant !== null);
    const first = slate?.items[0];
    const authorization =
      first === undefined
        ? null
        : (warm.find((grant) => grant.companyId === first.companyId)
            ?.authorization ?? null);
    if (authorization?.posterUrl != null && initialTab === "FOR_YOU") {
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
        <DiscoverTabs
          initialTab={initialTab}
          yoursInitial={yours}
          focusCompanyId={focus}
          forYou={
            <InvestorFeedScreen
              initial={slate === null ? null : { slate, authorization, warm }}
              sectors={sectors}
            />
          }
        />
      </>
    );
  }

  // Founders' videos (ADR 0021) sit beside the investors, one tab each.
  // (A founder has no "Your companies": the investors they talk to are on
  // Relationships; no equivalent tab is invented here.)
  const tab = (await searchParams)?.tab;
  const founders = tab === "founders";
  const tabClass = (active: boolean) =>
    `cq-body-sm inline-flex min-h-11 items-center border-b-2 px-1 ${
      active
        ? "border-(--cq-text-primary) text-(--cq-text-primary)"
        : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
    }`;
  const tabs = (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-(--cq-border-subtle)">
      <nav aria-label="What to discover" className="flex gap-6">
        <Link
          href="/discover"
          aria-current={founders ? undefined : "page"}
          className={tabClass(!founders)}
        >
          Investors
        </Link>
        <Link
          href="/discover?tab=founders"
          aria-current={founders ? "page" : undefined}
          className={tabClass(founders)}
          data-discover-founders-tab
        >
          Founders&apos; videos
        </Link>
      </nav>
      {/* Interest already addressed to the company (CQ-NET-011). */}
      <Link
        href="/company/interest"
        className="cq-body-sm mb-2 text-(--cq-text-secondary) underline-offset-4 hover:text-(--cq-text-primary) hover:underline"
      >
        Investor interest in your company
      </Link>
    </div>
  );
  if (founders) {
    return (
      <PageContainer className="flex flex-col gap-6">
        <PageHeader title="Discover" />
        {tabs}
        <NetworkVideos />
      </PageContainer>
    );
  }

  const slate = await discoverInvestors(session).catch(() => null);
  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader title="Discover" />
      {tabs}
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
