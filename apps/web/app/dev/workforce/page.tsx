import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { WorkPage } from "@/features/work/work-page";
import { WorkforcePanel } from "@/features/work/workforce-panel";

import { FIXTURE_IDS, workforceAllStates, workforceFixtures } from "./fixtures";

// Per request: the preview flag and the fixtures' clock are read at runtime.
export const dynamic = "force-dynamic";

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
  // Production serves it only to a local preview that asks (screenshots).
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  // P7: the whole Work page with every agent state, on the chosen tab.
  const view = params["view"];
  if (
    view === "team" ||
    view === "cost" ||
    view === "progress" ||
    view === "needs" ||
    view === "done"
  ) {
    const all = workforceAllStates(reviewClock(), {
      budgetPaused: params["pause"] === "budget",
      hours: params["pause"] === "hours",
    });
    return (
      <AppShell
        context={{
          scope: "investor_private",
          label: "Harbour Lane Capital (fictional)",
          admin: false,
        }}
      >
        <PageContainer>
          <PageHeader title="Work" />
          <WorkPage
            suggestions={[]}
            approvals={[]}
            work={[...all.work]}
            done={null}
            workforce={{ overview: all.overview, jobs: all.jobs }}
            // Work around decisions (2026-10-08): one page; team and cost
            // are its secondary views.
            initialView={view === "team" || view === "cost" ? view : "work"}
            liveReads={false}
          />
        </PageContainer>
      </AppShell>
    );
  }
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
