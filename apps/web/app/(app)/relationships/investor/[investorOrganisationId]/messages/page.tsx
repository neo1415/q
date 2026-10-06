import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isMatchedRelationshipState } from "@capital-q/contracts";

import { QSection } from "@/features/q/q-section";
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
  // Messages open only once both sides have agreed to connect. Before
  // that the thread cannot load, so the relationship page is the answer,
  // not "Messages couldn't load" over a live composer (demo-44 phone pass).
  if (!isMatchedRelationshipState(loaded.relationship.state)) {
    redirect(`/relationships/investor/${investorOrganisationId}`);
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
      {/* Q room R1: the chat on screen, by its counterpart. */}
      <QSection
        id="chat"
        kind="CHAT"
        refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
        total={loaded.thread?.messages.length ?? 0}
        label={`chat with ${loaded.counterpart} open`}
      >
        <RelationshipConversation
          side="COMPANY"
          counterpart={loaded.counterpart}
          relationship={loaded.relationship}
          profile={loaded.profile}
          thread={loaded.thread}
          basePath={`/relationships/investor/${investorOrganisationId}`}
        />
      </QSection>
    </>
  );
}
