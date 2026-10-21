import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { directoryEntries } from "@/features/discover/discover-screen";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import {
  InvestorProfile,
  type InvestorProfileReads,
} from "@/features/investors/investor-profile";
import { QSection } from "@/features/q/q-section";

import {
  BRIGHTFOLD,
  CARDS,
  GATES,
  HARBOURLINE_GATE_CLOSED,
  INVESTORS,
  harbourlineFull,
  harbourlineInTouch,
  tidewaterUnpublished,
} from "./fixtures";
import {
  ReviewDirectory,
  ReviewInterest,
  ReviewSearch,
  ReviewShortlist,
  ReviewVisibility,
  type DirectoryState,
  type InterestState,
  type ShortlistState,
} from "./review-harness";

export const metadata: Metadata = {
  title: "Discovery (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * The discovery designs (app prototypes 2026-10-21) in the real shell,
 * with fictional data, for design review and screenshots: Search and its
 * palette, the investors directory and its sheet, an investor's page,
 * Saved / Passed / Compare, investor interest and Visibility. Each state
 * renders the component tree its real route renders, with every read
 * handed in from ./fixtures and every port answered by them
 * (./review-harness). Nothing here reads or writes a service. Development
 * only, or a production build started with CQ_REVIEW_PAGES=1 for the
 * screenshot run.
 *
 * `?page=<page>&state=<state>`; no `page` lists every link.
 */

const PAGES = {
  search: {
    title: "Search and the search palette",
    side: "founder",
    states: [
      "home",
      "home-recent",
      "palette-empty",
      "palette-names",
      "palette-videos",
      "palette-no-match",
      "palette-card",
      "palette-no-card",
      "palette-error",
    ],
  },
  investors: {
    title: "Investors directory",
    side: "founder",
    states: [
      "list",
      "filtered",
      "filtered-empty",
      "empty",
      "sheet-request",
      "sheet-sent",
      "sheet-requested",
      "sheet-connected",
      "sheet-declined",
      "sheet-gate",
      "sheet-closed",
      "sheet-not-qualified",
      "sheet-not-stated",
      "sheet-loading",
      "sheet-failed",
    ],
  },
  investor: {
    title: "Investor profile",
    side: "founder",
    states: [
      "overview",
      "looks-for",
      "gate",
      "gate-closed",
      "in-touch",
      "overview-unpublished",
      "looks-for-unpublished",
      "gate-unpublished",
    ],
  },
  shortlist: {
    title: "Saved, Passed, Compare and Top three",
    side: "investor",
    states: [
      "saved",
      "pick-1",
      "pick-2",
      "pick-3",
      "saved-empty",
      "saved-error",
      "passed",
      "passed-empty",
      "compare-picked",
      "compare-top",
      "top-no-mandate",
      "top-error",
    ],
  },
  interest: {
    title: "Investor interest",
    side: "founder",
    states: [
      "waiting",
      "accept-pending",
      "connected",
      "declined",
      "answered",
      "empty",
    ],
  },
  visibility: {
    title: "Visibility",
    side: "founder",
    states: [
      "private",
      "discoverable",
      "recommended",
      "going-private",
      "readiness-unread",
    ],
  },
} as const;
type PageId = keyof typeof PAGES;
const PAGE_IDS = Object.keys(PAGES) as readonly PageId[];

export default async function DiscoveryReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_REVIEW_PAGES"] !== "1"
  ) {
    notFound();
  }
  // The language for the server components below (serverTNow).
  await serverUiLanguage();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const page = PAGE_IDS.find((entry) => entry === one("page"));
  if (page === undefined) return <Index />;
  const states: readonly string[] = PAGES[page].states;
  const state = states.find((entry) => entry === one("state")) ?? states[0];
  if (state === undefined) notFound();
  const founder = PAGES[page].side === "founder";

  return (
    <>
      <PublicBrandStyle />
      <AppShell
        context={{
          scope: founder ? "founder_private" : "investor_private",
          label: founder ? BRIGHTFOLD.name : "Harbourline Ventures (fictional)",
          admin: false,
        }}
      >
        <ReviewView page={page} state={state} now={reviewClock()} />
      </AppShell>
    </>
  );
}

/** When the page was read: cards say "Today" from here, as real routes do. */
function reviewClock(): number {
  return Date.now();
}

function Index() {
  return (
    <PageContainer>
      <PageHeader
        title="Discovery design review"
        description="Fictional data. Every link renders the real component in one state."
      />
      <div className="flex flex-col gap-6">
        {PAGE_IDS.map((page) => (
          <section key={page} className="flex flex-col gap-2">
            <h2 className="cq-title-sm text-(--cq-text-primary)">
              {PAGES[page].title}
            </h2>
            <ul className="flex flex-col gap-1">
              {PAGES[page].states.map((state) => {
                const href = `/dev/discovery-review?page=${page}&state=${state}`;
                return (
                  <li key={state}>
                    <Link
                      href={href}
                      className="cq-body-sm text-(--cq-text-primary) underline underline-offset-4"
                    >
                      {href}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageContainer>
  );
}

async function ReviewView({
  page,
  state,
  now,
}: {
  readonly page: PageId;
  readonly state: string;
  readonly now: number;
}) {
  const t = await serverT();
  switch (page) {
    case "search":
      // As app/(app)/search/page.tsx lays it out.
      return (
        <PageContainer className="cq-charcoal">
          <QSection
            id="search"
            kind="SEARCH_RESULTS"
            label={t("search results")}
          >
            <PageHeader
              title={t("Search")}
              description={t(
                "One place to look someone up. Press / from anywhere.",
              )}
            />
            <ReviewSearch
              state={state as Parameters<typeof ReviewSearch>[0]["state"]}
            />
          </QSection>
        </PageContainer>
      );
    case "investors":
      // As app/(app)/discover/page.tsx builds the founder's directory.
      return (
        <PageContainer className="flex flex-col gap-6">
          <PageHeader title={t("Discover")} />
          <ReviewDirectory
            state={state as DirectoryState}
            entries={directoryEntries(INVESTORS, GATES, CARDS)}
          />
        </PageContainer>
      );
    case "investor":
      return <Investor state={state} />;
    case "shortlist":
      // As features/discover/shortlist-page.tsx lays it out.
      return (
        <PageContainer>
          <h1 className="cq-title-xl mb-2.5 text-(--cq-text-primary)">
            {t("Saved")}
          </h1>
          <ReviewShortlist state={state as ShortlistState} />
        </PageContainer>
      );
    case "interest":
      // As app/(app)/company/interest/page.tsx lays it out.
      return (
        <PageContainer>
          <div className="max-w-[820px]">
            <h1 className="cq-title-xl mb-2.5 text-(--cq-text-primary)">
              {t("Investor interest")}
            </h1>
            <ReviewInterest state={state as InterestState} now={now} />
          </div>
        </PageContainer>
      );
    case "visibility":
      // As app/(app)/company/visibility/page.tsx lays it out for a founder.
      return (
        <PageContainer>
          <PageHeader
            title={t("Visibility")}
            description={t(
              "Being visible and being recommended are separate: both are needed for investors to be shown your company.",
            )}
          />
          <ReviewVisibility
            state={state as Parameters<typeof ReviewVisibility>[0]["state"]}
          />
        </PageContainer>
      );
  }
}

/** One investor's page, as app/(app)/investors/[id]/page.tsx renders it. */
function Investor({ state }: { readonly state: string }) {
  const unpublished = state.endsWith("-unpublished");
  const tab = state.startsWith("looks-for")
    ? "looks-for"
    : state.startsWith("gate")
      ? "gate"
      : "overview";
  const reads: InvestorProfileReads = unpublished
    ? tidewaterUnpublished()
    : state === "in-touch"
      ? harbourlineInTouch()
      : state === "gate-closed"
        ? { ...harbourlineFull(), gate: HARBOURLINE_GATE_CLOSED }
        : harbourlineFull();
  return section(
    reads.investor.investorOrganisationId,
    <InvestorProfile reads={reads} tab={tab} />,
  );
}

function section(id: string, children: ReactNode) {
  return (
    <PageContainer className="cq-charcoal">
      <QSection
        id="investor"
        kind="INVESTOR_PROFILE"
        refs={[{ kind: "INVESTOR_ORGANISATION", id }]}
        total={1}
        label="an investor profile"
      >
        {children}
      </QSection>
    </PageContainer>
  );
}
