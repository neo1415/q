import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { QPageSubject } from "@/features/q/q-subject";
import {
  RelationshipSection,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import {
  DiligenceUnavailable,
  RelationshipDiligence,
} from "@/features/relationships/relationship-diligence";
import {
  loadCompanySideRelationship,
  messageCountOf,
} from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Diligence" };
export const dynamic = "force-dynamic";

/**
 * A company's diligence with one investor (founder critique 2026-10-04):
 * their requests as cards, each answered on the card. The API decides the
 * party and the side; before diligence starts the overview is the answer.
 */
export default async function CompanyDiligencePage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const basePath = `/relationships/investor/${investorOrganisationId}`;
  const loaded = await loadCompanySideRelationship(investorOrganisationId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  const { relationship, diligence } = loaded;
  if (
    relationship === null ||
    !relationship.milestones.some((m) => m.state === "IN_DILIGENCE")
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
        side="COMPANY"
        counterpart={loaded.counterpart}
        relationship={relationship}
        profile={loaded.profile}
        basePath={basePath}
        current="DILIGENCE"
        messageCount={messageCountOf(loaded)}
        diligence={diligence}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
      >
        {diligence === null ? (
          <DiligenceUnavailable href={`${basePath}/diligence`} />
        ) : (
          <RelationshipDiligence
            relationshipId={relationship.relationshipId}
            companyId={relationship.companyId}
            counterpart={loaded.counterpart}
            initial={diligence}
            now={loaded.readAt}
          />
        )}
      </RelationshipSection>
    </>
  );
}
