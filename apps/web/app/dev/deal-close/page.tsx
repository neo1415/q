import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/app-shell/page-container";
import { RelationshipDeal } from "@/features/relationships/relationship-deal";

import { dealFixture, type DealStageFixture } from "./fixtures";

// Per request: the preview flag is read at runtime.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deal close (design review)",
  robots: { index: false },
};

const STAGES: readonly DealStageFixture[] = [
  "soft",
  "terms",
  "ready",
  "closed",
  "passed",
];

/**
 * The deal card on a relationship (2026-10-08) with fictional data, for
 * design review and the stage-strip harness. Development only: nothing
 * here reads anything; a press reaches the real server actions, which
 * refuse without a session.
 *
 * `?stage=soft|terms|ready|closed|passed`, `?side=investor|founder`.
 */
export default async function DealCloseReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const stage = STAGES.find((value) => value === params["stage"]) ?? "terms";
  const side = params["side"] === "founder" ? "COMPANY" : "INVESTOR";
  const counterpart = side === "INVESTOR" ? "Tensorgate" : "Northwind Ventures";
  return (
    <PageContainer className="flex flex-col gap-6">
      <h1 className="cq-title-lg text-(--cq-text-primary)">{counterpart}</h1>
      <section
        aria-labelledby="relationship-deal"
        className="flex flex-col gap-3"
      >
        <h2
          id="relationship-deal"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          Deal
        </h2>
        <RelationshipDeal
          relationshipId="a0000000-0000-4000-8000-000000000001"
          counterpart={counterpart}
          side={side}
          initial={dealFixture(stage, side)}
        />
      </section>
    </PageContainer>
  );
}
