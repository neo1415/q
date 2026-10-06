import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { searchTabOf } from "@/features/explore/explore-search-view";
import { ExploreReview } from "@/features/explore/explore-review";

export const metadata: Metadata = {
  title: "Explore (design review)",
  robots: { index: false },
};

const VIEWS = ["grid", "feed", "related", "search"] as const;
const STATES = ["full", "loading", "empty", "error", "limited"] as const;

/**
 * Explore in the real shell with fictional fixtures, for design review and
 * the screenshot checks (E1-E5). Development only (or CQ_DEV_PREVIEW=1 on
 * a local production build); nothing here reads or writes anything.
 *
 * `?view=grid|feed|related|search`, `&state=full|loading|empty|error|limited`,
 * `&tab=top|companies|investors|people|pitches`.
 */
export default async function ExploreReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const view = VIEWS.find((v) => v === one("view")) ?? "grid";
  const state = STATES.find((s) => s === one("state")) ?? "full";
  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Northbound Capital (fictional)",
      }}
    >
      <PageContainer className="flex flex-col gap-4">
        <h1 className="cq-title-md lg:sr-only">Explore</h1>
        <ExploreReview
          view={view}
          state={state}
          tab={searchTabOf(one("tab"))}
        />
      </PageContainer>
    </AppShell>
  );
}
