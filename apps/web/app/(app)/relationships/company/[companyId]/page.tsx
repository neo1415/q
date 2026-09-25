import type { Metadata } from "next";

import {
  getCompanyNetworkPreview,
  getOwnInterest,
  getRelationshipWithCompany,
} from "@capital-q/api-client";

import { QPageSubject } from "@/features/q/q-subject";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { InvestorRelationshipActions } from "@/features/relationships/relationship-actions";
import {
  RelationshipDetail,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";

export const metadata: Metadata = { title: "Relationship" };
export const dynamic = "force-dynamic";

/**
 * An investor organisation's relationship with one company (CQ-WEB-030).
 *
 * Every read is the investor's own, under their session: the company's
 * network projection for its name, the relationship through the per-party
 * fold (CQ-NET-012), and the organisation's own interest for the one
 * action this side has. The API authorises each; this page only chooses
 * what to say when one of them answers nothing.
 */
export default async function InvestorRelationshipPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
}) {
  const { companyId } = await params;
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);

  if (context.kind !== "INVESTOR" || session === null) {
    return (
      <RelationshipUnavailable sentence="Relationships with companies belong to an investor organisation. This one is not yours to see." />
    );
  }

  const company = await getCompanyNetworkPreview(session, companyId).catch(
    () => null,
  );
  if (company === null) {
    return (
      <RelationshipUnavailable sentence="This company isn't available to you. It may not be discoverable, or it may no longer exist." />
    );
  }

  const [status, own] = await Promise.all([
    getRelationshipWithCompany(session, company.companyId).catch(() => null),
    getOwnInterest(session, company.companyId).catch(() => null),
  ]);

  // The investor's one action is expressing interest. Once it is
  // expressed, the state line already says where things stand, so the
  // control would only repeat it.
  const relationship = status?.relationship ?? null;
  const mayExpress =
    relationship === null || relationship.nextStep === "EXPRESS_INTEREST";

  return (
    <>
      <QPageSubject
        subject={
          relationship === null
            ? {
                kind: "COMPANY",
                companyId: company.companyId,
                label: company.canonicalName,
                scope: "network_visible",
              }
            : {
                kind: "RELATIONSHIP",
                relationshipId: relationship.relationshipId,
                label: company.canonicalName,
                scope: "relationship_shared",
              }
        }
      />
      <RelationshipDetail
        side="INVESTOR"
        counterpart={company.canonicalName}
        relationship={relationship}
        absentSentence={
          status === null
            ? "Where you stand couldn't load just now. Nothing has changed; try again in a moment."
            : `Nothing is on record yet between your organisation and ${company.canonicalName}.`
        }
        actions={
          own === null || !mayExpress ? null : (
            <InvestorRelationshipActions
              companyId={company.companyId}
              companyName={company.canonicalName}
              interest={own.interest}
            />
          )
        }
      />
    </>
  );
}
