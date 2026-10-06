import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import {
  CompanyProfileView,
  profileTabOf,
} from "@/features/company/company-profile-view";
import { FounderPerson } from "@/features/company/material/team";
import {
  reviewDeck,
  reviewFounder,
  reviewInvestorRoom,
  reviewOwnerRoom,
  reviewProfile,
} from "@/features/company/material/review-fixtures";

export const metadata: Metadata = {
  title: "Company profile (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * The company profile's five tabs and a founder's page in the real shell,
 * with fictional data, for design review and screenshots (overnight A1-A7).
 * Nothing here reads or writes; every name and figure is invented.
 * Development only, or a production build started with CQ_REVIEW_PAGES=1
 * for the screenshot run.
 *
 * `?tab=overview|elevator|dataroom|deck|team`, `?side=investor|owner`,
 * `?state=full|empty|downloadable`, `?as=investor`, `?view=person`.
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
  return (
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
            interest={null}
            connected={false}
            sectorLabels={["Health insurance software"]}
            dataRoom={
              side === "OWNER"
                ? reviewOwnerRoom(empty)
                : reviewInvestorRoom(empty)
            }
            deck={reviewDeck(side, state)}
            previewAsInvestor={params["as"] === "investor"}
          />
        )}
      </PageContainer>
    </AppShell>
  );
}
