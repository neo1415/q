import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { QPageSubject } from "@/features/q/q-subject";
import {
  RelationshipSection,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { RelationshipDiligence } from "@/features/relationships/relationship-diligence";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Diligence" };
export const dynamic = "force-dynamic";

/**
 * An investor's diligence with one company (founder critique 2026-10-04):
 * what they asked for as cards, what was shared to view or save, with Q's one line on it. The API decides the
 * party and the side; before diligence starts the overview is the answer.
 */
export default async function InvestorDiligencePage({
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
  if (loaded.relationship === null || loaded.diligence === null) {
    redirect(basePath);
  }
  const { relationship, diligence } = loaded;
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
        current="DILIGENCE"
        messageCount={loaded.thread?.messages.length ?? 0}
        diligence={diligence}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
      >
        <RelationshipDiligence
          relationshipId={relationship.relationshipId}
          companyId={relationship.companyId}
          counterpart={loaded.counterpart}
          initial={diligence}
          now={loaded.readAt}
        />
      </RelationshipSection>
    </>
  );
}
