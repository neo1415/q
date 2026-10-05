import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { WorkforcePanel } from "@/features/work/workforce-panel";

import { FIXTURE_IDS, workforceFixtures } from "./fixtures";

export const metadata: Metadata = {
  title: "Q’s team (design review)",
  robots: { index: false },
};

/**
 * Q's team, the Work page's workforce section (founder brief J5), in the
 * real shell with fictional data, for design review and the screenshot
 * checks. Development only: nothing here reads or writes anything.
 *
 * `?tab=team` or `?tab=cost` opens that tab on a phone; `?state=draft`
 * opens the draft review sheet; `?state=empty` is a person with no jobs.
 */
function reviewClock(): number {
  return Date.now();
}

export default async function WorkforceReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const params = await searchParams;
  const tab =
    params["tab"] === "team" || params["tab"] === "cost"
      ? params["tab"]
      : "now";
  const state = params["state"];
  const fixtures = workforceFixtures(reviewClock());
  const overview =
    state === "empty"
      ? {
          ...fixtures.overview,
          spentUsd: "0",
          byRole: [],
          team: [],
          jobs: { open: 0, needsYou: 0 },
        }
      : fixtures.overview;
  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Harbour Lane Capital (fictional)",
        admin: false,
      }}
    >
      <PageContainer>
        <WorkforcePanel
          overview={overview}
          jobs={state === "empty" ? [] : fixtures.jobs}
          initialTab={tab}
          openDraftId={state === "draft" ? FIXTURE_IDS.draft2 : undefined}
        />
      </PageContainer>
    </AppShell>
  );
}
