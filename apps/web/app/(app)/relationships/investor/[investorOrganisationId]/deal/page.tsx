import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isMatchedRelationshipState } from "@capital-q/contracts";

import { QPageSubject } from "@/features/q/q-subject";
import { messageCountOf } from "@/features/relationships/brief-lines";
import { RelationshipDeal } from "@/features/relationships/relationship-deal";
import {
  RelationshipSection,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";
import { loadCompanySideRelationship } from "@/features/relationships/relationship-page-data";
import { serverT, serverUiLanguage } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Deal and close") };
}
export const dynamic = "force-dynamic";

/**
 * A company's deal and close with one investor organisation (record
 * prototype, deal option 2): the same terms, signing and close as the
 * investor's, from the company's side. The API decides the party.
 */
export default async function CompanyDealPage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  // The language for the server components below (serverTNow).
  await serverUiLanguage();

  const { investorOrganisationId } = await params;
  const basePath = `/relationships/investor/${investorOrganisationId}`;
  const loaded = await loadCompanySideRelationship(investorOrganisationId);
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
        side="COMPANY"
        counterpart={loaded.counterpart}
        relationship={relationship}
        profile={loaded.profile}
        basePath={basePath}
        current="DEAL"
        messageCount={messageCountOf(loaded)}
        diligence={loaded.diligence}
        meetings={loaded.meetings}
        readAt={loaded.readAt}
        charcoal
      >
        <RelationshipDeal
          relationshipId={relationship.relationshipId}
          counterpart={loaded.counterpart}
          side="COMPANY"
        />
      </RelationshipSection>
    </>
  );
}
