import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isMatchedRelationshipState } from "@capital-q/contracts";

import { QPageSubject } from "@/features/q/q-subject";
import {
  RelationshipSection,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { RelationshipTimeline } from "@/features/relationships/relationship-timeline";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";
import { RelationshipSchedule } from "@/features/schedule/relationship-schedule";

export const metadata: Metadata = { title: "Calls" };
export const dynamic = "force-dynamic";

/** A relationship's calls: book one, the ones booked, and what happened. */
export default async function InvestorCallsPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
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
        messageCount={loaded.thread?.messages.length ?? 0}
        diligence={loaded.diligence}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
      >
        <section className="flex max-w-(--cq-layout-reading) flex-col gap-4">
          <RelationshipSchedule
            relationshipId={relationship.relationshipId}
            counterpart={loaded.counterpart}
            connected
            focus="call"
          />
          <RelationshipTimeline
            milestones={relationship.milestones}
            meetings={loaded.meetings}
            now={loaded.readAt}
            side="INVESTOR"
            counterpart={loaded.counterpart}
          />
        </section>
      </RelationshipSection>
    </>
  );
}
