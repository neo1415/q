import type { Metadata } from "next";

import { QPageSubject } from "@/features/q/q-subject";
import { RelationshipConversation } from "@/features/relationships/relationship-conversation";
import { RelationshipUnavailable } from "@/features/relationships/relationship-detail";
import { loadCompanySideRelationship } from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/** A company's conversation with one investor organisation (R34). */
export default async function CompanyConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const loaded = await loadCompanySideRelationship(investorOrganisationId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  if (loaded.relationship === null) {
    return <RelationshipUnavailable sentence={loaded.absentSentence} />;
  }
  return (
    <>
      <QPageSubject
        subject={{
          kind: "RELATIONSHIP",
          relationshipId: loaded.relationship.relationshipId,
          label: loaded.counterpart,
          scope: "relationship_shared",
        }}
      />
      <RelationshipConversation
        side="COMPANY"
        counterpart={loaded.counterpart}
        relationship={loaded.relationship}
        profile={loaded.profile}
        thread={loaded.thread}
        basePath={`/relationships/investor/${investorOrganisationId}`}
      />
    </>
  );
}
