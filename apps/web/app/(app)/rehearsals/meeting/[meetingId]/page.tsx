import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRehearsalMeeting } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Rehearse" };
export const dynamic = "force-dynamic";

/**
 * The rehearsal suggested when a call was booked (REHEARSE): the meeting
 * is resolved for this person only, then they are taken to its lobby.
 */
export default async function MeetingRehearsalPage({
  params,
}: {
  readonly params: Promise<{ readonly meetingId: string }>;
}) {
  const { meetingId } = await params;
  const session = await qApiSession();
  const found =
    session === null
      ? null
      : await getRehearsalMeeting(session, meetingId).catch(() => null);
  if (found !== null) {
    const id = encodeURIComponent(found.counterpart.id);
    const meeting = encodeURIComponent(meetingId);
    redirect(
      found.counterpart.kind === "COMPANY"
        ? `/rehearsals/company/${id}?meeting=${meeting}`
        : `/rehearsals/investor/${id}?meeting=${meeting}`,
    );
  }
  return (
    <PageContainer>
      <EmptyState
        title="That call has passed or isn't yours."
        description="You can still rehearse with anyone you're connected to."
        action={
          <Link href="/rehearsals" className={buttonClassName("secondary")}>
            Rehearsals
          </Link>
        }
      />
    </PageContainer>
  );
}
