import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { pendingQApprovalsAction } from "@/features/q/actions";
import { ApprovalsPanel } from "@/features/work/approvals-panel";
import { WorkPanel } from "@/features/work/work-panel";
import { listWorkAction } from "@/features/work/work-actions";

export const metadata: Metadata = { title: "Q's work" };

/**
 * Q's work (AUTO, ADR 0030; design-48): what waits on the person first,
 * then every outreach, stand-in and standing instruction they approved.
 *
 * Both lists are read on the server and streamed in. In production the
 * panel used to fetch them with a client server action queued behind the
 * shell's own actions (notifications, presence), which run one at a time;
 * the list arrived seconds late or, when its request was dropped, never,
 * and the skeleton stayed. The page header never waits on these reads.
 */
async function WorkLists() {
  const [work, approvals] = await Promise.all([
    listWorkAction().catch(() => null),
    pendingQApprovalsAction().catch(() => null),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <ApprovalsPanel
        initial={approvals?.ok === true ? approvals.value : null}
      />
      <WorkPanel
        variant="page"
        initial={work?.ok === true ? work.value : null}
        initialFailed={work?.ok !== true}
      />
    </div>
  );
}

export default function WorkPage() {
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Q's work"
        description="What Q is doing under the instructions you approved. Stop any of it at any time."
      />
      <Suspense fallback={<Skeleton lines={4} />}>
        <WorkLists />
      </Suspense>
    </PageContainer>
  );
}
