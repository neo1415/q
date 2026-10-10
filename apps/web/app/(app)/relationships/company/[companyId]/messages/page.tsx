import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isMatchedRelationshipState } from "@capital-q/contracts";

import { QSection } from "@/features/q/q-section";
import { QPageSubject } from "@/features/q/q-subject";
import { RelationshipConversation } from "@/features/relationships/relationship-conversation";
import { RelationshipUnavailable } from "@/features/relationships/relationship-detail";
import {
  loadInvestorSideRelationship,
  messageCountOf,
} from "@/features/relationships/relationship-page-data";

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
  // Messages open only once both sides have agreed to connect. Before
  // that the thread cannot load, so the relationship page is the answer,
  // not "Messages couldn't load" over a live composer (demo-44 phone pass).
  if (!isMatchedRelationshipState(loaded.relationship.state)) {
    redirect(`/relationships/company/${loaded.companyId}`);
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
        refs={[{ kind: "COMPANY", id: loaded.companyId }]}
        total={messageCountOf(loaded)}
        label={`chat with ${loaded.counterpart} open`}
      >
        <RelationshipConversation
          side="INVESTOR"
          counterpart={loaded.counterpart}
          relationship={loaded.relationship}
          profile={loaded.profile}
          thread={loaded.thread}
          basePath={`/relationships/company/${loaded.companyId}`}
        />
      </QSection>
    </>
  );
}
