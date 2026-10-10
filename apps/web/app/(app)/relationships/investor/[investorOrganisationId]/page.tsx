import type { Metadata } from "next";

import { QPageSubject } from "@/features/q/q-subject";
import { CompanyRelationshipActions } from "@/features/relationships/relationship-actions";
import {
  RelationshipDetail,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { loadCompanySideRelationship } from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Relationship" };
export const dynamic = "force-dynamic";

/**
 * A company's relationship with one investor organisation (CQ-WEB-030).
 *
 * The company is the person's own, resolved on the server. The investor
 * is known to the company only through the relationship itself (their
 * interest, or a request the founder sent) and as Discover shows them, so
 * a relationship this side cannot see (a private discovery) has no name
 * here and the page says nothing is on record. The fold is the company's
 * (CQ-NET-012); the one action is answering a pending interest, through
 * the same server-confirmed control the inbox uses.
 */
export default async function CompanyRelationshipPage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const loaded = await loadCompanySideRelationship(investorOrganisationId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  const { relationship, pending, counterpart } = loaded;

  // The relationship itself is Q's subject here, not the investor
  // organisation: the Q API resolves it for its two parties only and
  // answers from the company's own fold, so nothing about the investor
  // that is not shared with the company reaches Q through this page.
  return (
    <>
      {relationship === null ? null : (
        <QPageSubject
          subject={{
            kind: "RELATIONSHIP",
            relationshipId: relationship.relationshipId,
            label: counterpart,
            scope: "relationship_shared",
          }}
        />
      )}
      <RelationshipDetail
        side="COMPANY"
        askQ={relationship !== null}
        counterpart={counterpart}
        relationship={relationship}
        profile={loaded.profile}
        thread={loaded.thread}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
        diligence={loaded.diligence}
        brief={loaded.brief}
        basePath={`/relationships/investor/${investorOrganisationId}`}
        absentSentence={loaded.absentSentence}
        actions={
          pending !== null && relationship?.nextStep === "ANSWER_INTEREST" ? (
            <CompanyRelationshipActions interest={pending} />
          ) : null
        }
      />
    </>
  );
}
