import type { Metadata } from "next";
import Link from "next/link";

import { finishRehearsal, getRehearsal } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";
import { RehearsalReview } from "@/features/rehearsal/rehearsal-review";

export const metadata: Metadata = { title: "Rehearsal review" };
export const dynamic = "force-dynamic";

/**
 * One rehearsal's review (REHEARSE). Leaving the room lands here; a
 * rehearsal still open is finished first (idempotent: a finished one is
 * returned as it is), so the review is written once.
 */
export default async function RehearsalReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly rehearsalId: string }>;
}) {
  const { rehearsalId } = await params;
  const session = await qApiSession();
  let rehearsal =
    session === null
      ? null
      : await getRehearsal(session, rehearsalId).catch(() => null);
  if (session !== null && rehearsal?.status === "ACTIVE") {
    rehearsal =
      (await finishRehearsal(session, rehearsalId).catch(() => null)) ??
      rehearsal;
  }
  if (rehearsal === null) {
    return (
      <PageContainer>
        <EmptyState
          title="This rehearsal isn't available."
          description="Your rehearsals are listed on the Rehearsals page."
          action={
            <Link href="/rehearsals" className={buttonClassName("secondary")}>
              Rehearsals
            </Link>
          }
        />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-3xl">
        <RehearsalReview rehearsal={rehearsal} />
      </div>
    </PageContainer>
  );
}
