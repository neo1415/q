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
import { WorkPage } from "@/features/work/work-page";

export const metadata: Metadata = { title: "Work" };

/**
 * Work, Q's work page (WORK-58): give Q a task, what Q suggests from the
 * person's own account, what needs their yes, what runs, what is done.
 *
 * Every list is read on the server, in parallel, and streamed in; the
 * header never waits on them (design-48: a client action queued behind
 * the shell's own left the page on its skeleton).
 */
async function WorkLists() {
  const [suggestions, approvals, work, done] = await Promise.all([
    listSuggestionsAction().catch(() => null),
    pendingQApprovalsAction().catch(() => null),
    listWorkAction().catch(() => null),
    listDoneAction().catch(() => null),
  ]);
  return (
    <WorkPage
      suggestions={suggestions?.ok === true ? suggestions.value : null}
      approvals={approvals?.ok === true ? approvals.value : null}
      work={work?.ok === true ? work.value : null}
      done={done?.ok === true ? done.value : null}
    />
  );
}

export default function WorkRoute() {
  return (
    <PageContainer>
      <PageHeader title="Work" />
      <Suspense fallback={<Skeleton lines={6} />}>
        <WorkLists />
      </Suspense>
    </PageContainer>
  );
}
