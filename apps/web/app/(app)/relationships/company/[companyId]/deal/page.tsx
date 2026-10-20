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
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";
import { recordFitRead } from "@/features/relationships/record-workspace-data";
import { pitchTermsOf } from "@/features/relationships/record-workspace";
import { serverT, serverUiLanguage } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Deal and close") };
}
export const dynamic = "force-dynamic";

/**
 * An investor's deal and close with one company (record prototype, deal
 * option 2): the terms beside exactly what gets recorded, then signing,
 * close and the reports. Under the Overview tab, warm charcoal. Every
 * step is the API's to authorise; before the two sides connect there is
 * no deal, and the overview is the answer.
 */
export default async function InvestorDealPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  // The language for the server components below (serverTNow).
  await serverUiLanguage();

  const { companyId } = await params;
  const basePath = `/relationships/company/${companyId}`;
  const [loaded, fit] = await Promise.all([
    loadInvestorSideRelationship(companyId),
    recordFitRead(companyId),
  ]);
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
          side="INVESTOR"
          pitchTerms={pitchTermsOf(fit)}
        />
      </RelationshipSection>
    </>
  );
}
