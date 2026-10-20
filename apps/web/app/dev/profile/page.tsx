import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { RelationshipStateV2 } from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { PageContainer } from "@/components/app-shell/page-container";
import {
  CompanyProfileView,
  profileTabOf,
} from "@/features/company/company-profile-view";
import { FounderPerson } from "@/features/company/material/team";
import {
  REVIEW_COMPANY_ID,
  reviewBoard,
  reviewDeck,
  reviewFit,
  reviewFounder,
  reviewFounders,
  reviewInvestorRoom,
  reviewLockedRoom,
  reviewMeetings,
  reviewOwnerRoom,
  reviewProfile,
  reviewQView,
} from "@/features/company/material/review-fixtures";

export const metadata: Metadata = {
  title: "Company profile (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const RELATIONSHIPS: Readonly<Record<string, RelationshipStateV2 | null>> = {
  none: null,
  pending: "INTEREST_EXPRESSED",
  connected: "CONNECTED",
  met: "MEETING_HELD",
  diligence: "IN_DILIGENCE",
};

/**
 * The company profile's tabs and a founder's page in the real shell, with
 * fictional data, for design review and screenshots (profile option 1, the
 * decision brief). Nothing here reads; every name and figure is invented,
 * and the fit, Q's view, the questions, the call and the founders are
 * fixtures, so the page never calls the Q API. Development only, or a
 * production build started with CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?tab=overview|diligence|elevator|dataroom|deck|team`, `?side=investor|owner`,
 * `?state=full|empty|downloadable`, `?as=investor`, `?view=person`,
 * `?rel=none|pending|connected|met|diligence` (investor; default diligence).
 */
export default async function ProfileReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_REVIEW_PAGES"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const side = params["side"] === "owner" ? "OWNER" : "INVESTOR";
  const state =
    params["state"] === "empty"
      ? "empty"
      : params["state"] === "downloadable"
        ? "downloadable"
        : "full";
  const tab =
    profileTabOf(
      typeof params["tab"] === "string" ? params["tab"] : undefined,
    ) ?? "overview";
  const empty = state === "empty";
  const relKey = typeof params["rel"] === "string" ? params["rel"] : "diligence";
  const relationshipState =
    side === "INVESTOR" ? (RELATIONSHIPS[relKey] ?? "IN_DILIGENCE") : null;
  const connected =
    relationshipState !== null &&
    relationshipState !== "INTEREST_EXPRESSED" &&
    relationshipState !== "DISCOVERED";
  const relationshipId = "00000000-0000-4000-8000-000000000700";
  return (
    <>
      <PublicBrandStyle />
      <AppShell
        context={{
          scope: side === "OWNER" ? "founder_private" : "investor_private",
          label:
            side === "OWNER"
              ? "Kora Health (fictional)"
              : "Northbound Capital (fictional)",
          admin: false,
        }}
      >
        <PageContainer className="flex flex-col gap-6">
          {params["view"] === "person" ? (
            <FounderPerson person={reviewFounder(!empty)} />
          ) : (
            <CompanyProfileView
              profile={reviewProfile(side, empty)}
              tab={tab}
              interest={
                relationshipState === null
                  ? null
                  : {
                      interestId: "00000000-0000-4000-8000-000000000710",
                      relationshipId,
                      companyId: REVIEW_COMPANY_ID,
                      status: "EXPRESSED",
                      expressedAt: "2026-10-06T09:00:00.000Z",
                      response: connected ? "ACCEPTED" : "PENDING",
                      respondedAt: connected
                        ? "2026-10-06T12:00:00.000Z"
                        : null,
                      connection: null,
                    }
              }
              connected={connected}
              relationshipState={relationshipState}
              sectorLabels={["Health insurance software"]}
              dataRoom={
                side === "OWNER"
                  ? reviewOwnerRoom(empty)
                  : connected
                    ? reviewInvestorRoom(empty)
                    : reviewLockedRoom(relationshipState !== null)
              }
              deck={reviewDeck(side, state)}
              previewAsInvestor={params["as"] === "investor"}
              assumptions={side === "INVESTOR" && !empty ? reviewBoard() : null}
              questionsRoute={
                !connected
                  ? { kind: "NOT_CONNECTED" }
                  : relationshipState === "IN_DILIGENCE"
                    ? { kind: "DILIGENCE", relationshipId }
                    : { kind: "CHAT", relationshipId }
              }
              meetings={connected && !empty ? reviewMeetings() : null}
              met={relationshipState === "IN_DILIGENCE"}
              founders={empty ? [] : reviewFounders()}
              fit={side === "INVESTOR" && !empty ? reviewFit() : null}
              qView={side === "INVESTOR" && !empty ? reviewQView() : null}
            />
          )}
        </PageContainer>
      </AppShell>
    </>
  );
}
