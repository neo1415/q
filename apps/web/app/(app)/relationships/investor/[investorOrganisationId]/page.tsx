import type { Metadata } from "next";

import {
  getRelationshipWithInvestor,
  listIncomingInterest,
} from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";
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

  // No Q subject and no Ask Q here yet. The Q API resolves an investor
  // organisation outside the company's tenant only when disclosure lets the
  // company view it, and no disclosure rule does so for a counterparty, so
  // declaring it would fail every question asked on this page ("couldn't
  // find one of the subjects"). Q keeps the person's own company as its
  // subject until that gap is closed (reported with CQ-WEB-030).
  return (
    <>
      <RelationshipDetail
        side="COMPANY"
        askQ={false}
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
