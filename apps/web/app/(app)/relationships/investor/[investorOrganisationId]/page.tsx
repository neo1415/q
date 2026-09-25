import type { Metadata } from "next";

import {
  getRelationshipWithInvestor,
  listIncomingInterest,
} from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";
import { CompanyRelationshipActions } from "@/features/relationships/relationship-actions";
import {
  RelationshipDetail,
  RelationshipUnavailable,
} from "@/features/relationships/relationship-detail";

export const metadata: Metadata = { title: "Relationship" };
export const dynamic = "force-dynamic";

/**
 * A company's relationship with one investor organisation (CQ-WEB-030).
 *
 * The company is the person's own, resolved on the server. The investor's
 * name comes from the company's own inbox — an investor organisation is
 * known to a company only through an interest it sent, so a relationship
 * this side cannot see (a private discovery) has no name here either and
 * the page says nothing is on record. The fold is the company's (CQ-NET-
 * 012); the one action is answering a pending interest, through the same
 * server-confirmed control the inbox uses.
 */
export default async function CompanyRelationshipPage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <RelationshipUnavailable sentence="Relationships with investors belong to a company. This one is not yours to see." />
    );
  }

  const [incoming, status] = await Promise.all([
    listIncomingInterest(session, context.companyId).catch(() => null),
    getRelationshipWithInvestor(session, investorOrganisationId).catch(
      () => null,
    ),
  ]);

  // Newest first: after a decline an organisation may express interest
  // again, and the pending one is the one to answer.
  const fromThisInvestor = (incoming?.items ?? [])
    .filter((item) => item.investorOrganisationId === investorOrganisationId)
    .sort((a, b) => b.expressedAt.localeCompare(a.expressedAt));
  const latest = fromThisInvestor[0];
  if (latest === undefined) {
    return (
      <RelationshipUnavailable
        sentence={
          incoming === null || status === null
            ? "This relationship couldn't load just now. Nothing has changed; try again in a moment."
            : "Nothing is on record between your company and this investor organisation."
        }
      />
    );
  }

  const pending = fromThisInvestor.find((item) => item.response === "PENDING");
  const relationship = status?.relationship ?? null;

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
            label: latest.investorName,
            scope: "relationship_shared",
          }}
        />
      )}
      <RelationshipDetail
        side="COMPANY"
        askQ={relationship !== null}
        counterpart={latest.investorName}
        relationship={relationship}
        absentSentence="Where you stand couldn't load just now. Nothing has changed; try again in a moment."
        actions={
          pending !== undefined &&
          relationship?.nextStep === "ANSWER_INTEREST" ? (
            <CompanyRelationshipActions interest={pending} />
          ) : null
        }
      />
    </>
  );
}
