import type { Metadata } from "next";
import Link from "next/link";

import { getDiscoveredInvestor } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { RehearsalRoom } from "@/features/rehearsal/rehearsal-room";

export const metadata: Metadata = { title: "Rehearse" };
export const dynamic = "force-dynamic";

/**
 * The Investor Twin (founder direction 2026-09-30, C12): a founder's
 * private practice meeting with one investor, played by Q. Whether the
 * founder may rehearse with this investor is decided by the Q API (the
 * investor is visible to them, or they already have a relationship).
 */
export default async function RehearsePage({
  params,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
}) {
  const { investorOrganisationId } = await params;
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <EmptyState
          title="Rehearsals are for founders."
          description="A founder practises a meeting with an investor, played by Q."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }
  const investor = await getDiscoveredInvestor(
    session,
    investorOrganisationId,
  ).catch(() => null);
  const name = investor?.displayName ?? "this investor";
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Link
          href={`/investors/${encodeURIComponent(investorOrganisationId)}`}
          className="cq-body-sm inline-flex min-h-11 items-center gap-1 text-(--cq-text-secondary)"
        >
          <ChevronLeft size={ICON_SIZE.compact} aria-hidden="true" />
          {investor === null ? "Back" : name}
        </Link>
        <RehearsalRoom
          investorOrganisationId={investorOrganisationId}
          investorName={name}
        />
      </div>
    </PageContainer>
  );
}
