import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isMatchedRelationshipState } from "@capital-q/contracts";

import { QPageSubject } from "@/features/q/q-subject";
import {
  RelationshipSection,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { ScheduleDialog } from "@/features/relationships/schedule-dialog";
import { CallsEarlier } from "@/features/schedule/calls-earlier";
import { CallsWeek } from "@/features/schedule/calls-week";
import { JoinCallForm } from "@/features/schedule/join-call-form";
import { messageCountOf } from "@/features/relationships/brief-lines";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Calls") };
}
export const dynamic = "force-dynamic";

/** A relationship's calls: book one, the ones booked, and what happened. */
export default async function InvestorCallsPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  const t = await serverT();

  const { companyId } = await params;
  const basePath = `/relationships/company/${companyId}`;
  const loaded = await loadInvestorSideRelationship(companyId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  const { relationship } = loaded;
  if (
    relationship === null ||
    !isMatchedRelationshipState(relationship.state)
  ) {
    redirect(basePath);
  }
  return (
    <>
      <QPageSubject
        subject={{
          kind: "RELATIONSHIP",
          relationshipId: relationship.relationshipId,
          label: loaded.counterpart,
          scope: "relationship_shared",
        }}
      />
      <RelationshipSection
        side="INVESTOR"
        counterpart={loaded.counterpart}
        relationship={relationship}
        profile={loaded.profile}
        basePath={basePath}
        current="CALLS"
        messageCount={messageCountOf(loaded)}
        diligence={loaded.diligence}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
        charcoal
      >
        <div className="flex flex-col gap-6">
          {loaded.meetingsRead ? null : (
            // R1: an unread schedule is unknown, never "no calls".
            <p
              className="cq-body-sm text-(--cq-text-secondary)"
              data-calls-unavailable
            >
              {t(
                "Calls couldn't be read just now. Nothing has changed; try again in a moment.",
              )}
            </p>
          )}
          <CallsWeek
            relationshipId={relationship.relationshipId}
            counterpart={loaded.counterpart}
            initialMeetings={loaded.meetings}
          />
          <CallsEarlier meetings={loaded.meetings} now={loaded.readAt} />
          <div className="flex flex-wrap gap-2">
            <ScheduleDialog kind="join">
              <JoinCallForm
                relationshipId={relationship.relationshipId}
                counterpart={loaded.counterpart}
              />
            </ScheduleDialog>
            <ScheduleDialog kind="reminder">
              <RelationshipSchedule
                relationshipId={relationship.relationshipId}
                counterpart={loaded.counterpart}
                connected
                focus="reminder"
              />
            </ScheduleDialog>
          </div>
        </div>
      </RelationshipSection>
    </>
  );
}
