import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";

import { MatchReview, type MatchReviewProps } from "./match-review";

export const metadata: Metadata = {
  title: "Match (design review)",
  robots: { index: false },
};

/**
 * Fit with your mandate, Company requests, top three and the profile's fit
 * panel in the real shell, with fictional data, for design review and
 * screenshots (brief B1-B4; ADR 0052). Nothing here reads or writes.
 *
 * `?view=requests|top3|relationships|profile`,
 * `?state=full|loading|empty|error|limited`, `?sheet=fit|why`.
 *
 * Development only. A production build answers 404 unless the server was
 * started with CQ_DESIGN_REVIEW=1, which only a local screenshot run sets.
 */
function reviewClock(): number {
  return Date.parse("2026-10-05T21:40:00.000Z");
}

export default async function MatchReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DESIGN_REVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const pick = <T extends string>(
    key: string,
    values: readonly T[],
    fallback: T,
  ): T => {
    const value = params[key];
    return typeof value === "string" &&
      (values as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  };
  const props: MatchReviewProps = {
    view: pick(
      "view",
      ["requests", "top3", "relationships", "profile"] as const,
      "requests",
    ),
    state: pick(
      "state",
      ["full", "loading", "empty", "error", "limited"] as const,
      "full",
    ),
    sheet: pick("sheet", ["none", "fit", "why"] as const, "none"),
    now: reviewClock(),
  };
  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Northbound Capital (fictional)",
        admin: false,
      }}
    >
      <PageContainer>
        <MatchReview {...props} />
      </PageContainer>
    </AppShell>
  );
}
