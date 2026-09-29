import type { Metadata } from "next";

import { QPageSubject } from "@/features/q/q-subject";
import { RelationshipConversation } from "@/features/relationships/relationship-conversation";
import { RelationshipUnavailable } from "@/features/relationships/relationship-detail";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/** An investor organisation's conversation with one company (R34). */
export default async function InvestorConversationPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  const { companyId } = await params;
  const loaded = await loadInvestorSideRelationship(companyId);
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
        side="INVESTOR"
        counterpart={loaded.counterpart}
        relationship={loaded.relationship}
        profile={loaded.profile}
        thread={loaded.thread}
        basePath={`/relationships/company/${loaded.companyId}`}
      />
    </>
  );
}
