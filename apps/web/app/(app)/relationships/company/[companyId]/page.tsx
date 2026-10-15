import type { Metadata } from "next";

import { CompanyPitch } from "@/features/discover/company-pitch";
import { QPageSubject } from "@/features/q/q-subject";
import { InvestorRelationshipActions } from "@/features/relationships/relationship-actions";
import {
  RelationshipDetail,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";

export const metadata: Metadata = { title: "Relationship" };
export const dynamic = "force-dynamic";

/**
 * An investor organisation's relationship with one company (CQ-WEB-030).
 *
 * Every read is the investor's own, under their session: the company's
 * network projection for its name and context, the relationship through
 * the per-party fold (CQ-NET-012), and the organisation's own interest for
 * the one action this side has. The API authorises each; this page only
 * chooses what to say when one of them answers nothing.
 */
export default async function InvestorRelationshipPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  const { companyId } = await params;
  const loaded = await loadInvestorSideRelationship(companyId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  const { relationship, own, counterpart } = loaded;

  // The investor's one action is expressing interest. Once it is
  // expressed, the state line already says where things stand, so the
  // control would only repeat it.
  const mayExpress =
    relationship === null || relationship.nextStep === "EXPRESS_INTEREST";

  return (
    <>
      <QPageSubject
        subject={
          relationship === null
            ? {
                kind: "COMPANY",
                companyId: loaded.companyId,
                label: counterpart,
                scope: "network_visible",
              }
            : {
                kind: "RELATIONSHIP",
                relationshipId: relationship.relationshipId,
                label: counterpart,
                scope: "relationship_shared",
              }
        }
      />
      <RelationshipDetail
        side="INVESTOR"
        counterpart={counterpart}
        relationship={relationship}
        profile={loaded.profile}
        thread={loaded.thread}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
        diligence={loaded.diligence}
        brief={loaded.brief}
        basePath={`/relationships/company/${loaded.companyId}`}
        absentSentence={loaded.absentSentence}
        media={
          loaded.pitch === null ? null : <CompanyPitch company={loaded.pitch} />
        }
        actions={
          own === null || !mayExpress ? null : (
            <InvestorRelationshipActions
              companyId={loaded.companyId}
              companyName={counterpart}
              interest={own.interest}
            />
          )
        }
      />
    </>
  );
}
