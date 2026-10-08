import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { pendingQApprovalsAction } from "@/features/q/actions";
import { listWorkAction } from "@/features/work/work-actions";
import {
  listDoneAction,
  listSuggestionsAction,
} from "@/features/work/work-page-actions";
import { QSection } from "@/features/q/q-section";
import { WorkPage } from "@/features/work/work-page";
import { loadWorkforceAction } from "@/features/work/workforce-actions";

export const metadata: Metadata = { title: "Work" };

/**
 * Work, Q's work page (WORK-58): give Q a task, what Q suggests from the
 * person's own account, what needs their yes, what runs, what is done.
 *
 * Every list is read on the server, in parallel, and streamed in; the
 * header never waits on them (design-48: a client action queued behind
 * the shell's own left the page on its skeleton).
 */
/** voice-cards: `/work?view=team` opens that tab (Q's "open the Team tab"). */
const WORK_VIEWS = ["needs", "progress", "done", "team", "cost"] as const;
type WorkViewParam = (typeof WORK_VIEWS)[number];

function workViewOf(
  raw: string | string[] | undefined,
): WorkViewParam | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return WORK_VIEWS.find((view) => view === value);
}

async function WorkLists({
  view,
}: {
  readonly view?: WorkViewParam | undefined;
}) {
  const [suggestions, approvals, work, done, workforce] = await Promise.all([
    listSuggestionsAction().catch(() => null),
    pendingQApprovalsAction().catch(() => null),
    listWorkAction().catch(() => null),
    listDoneAction().catch(() => null),
    loadWorkforceAction().catch(() => null),
  ]);
  const items = work?.ok === true ? work.value : [];
  const waiting = approvals?.ok === true ? approvals.value : null;
  return (
    <>
      {/* Q room R1: Q's work and what waits for them, by id, for Q. */}
      <QSection
        id="work"
        kind="WORK_LIST"
        refs={items.slice(0, 12).map((item) => ({
          kind: "Q_WORK" as const,
          id: item.id,
        }))}
        total={items.length}
        label={`${String(items.length)} work items`}
      />
      {waiting === null ? null : (
        <QSection
          id="approvals"
          kind="APPROVAL_LIST"
          refs={waiting.slice(0, 12).map((approval) => ({
            kind: "APPROVAL" as const,
            id: approval.approvalId,
          }))}
          total={waiting.length}
          label="what needs you"
        />
      )}
      <WorkPage
        key={view ?? "default"}
        initialView={view}
        suggestions={suggestions?.ok === true ? suggestions.value : null}
        approvals={approvals?.ok === true ? approvals.value : null}
        work={work?.ok === true ? work.value : null}
        done={done?.ok === true ? done.value : null}
        workforce={workforce}
      />
    </>
  );
}

export default async function WorkRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly view?: string | string[] }>;
}) {
  const view = workViewOf((await searchParams).view);
  return (
    <PageContainer>
      <PageHeader title="Work" />
      <Suspense fallback={<Skeleton lines={6} />}>
        <WorkLists view={view} />
      </Suspense>
    </PageContainer>
  );
}
