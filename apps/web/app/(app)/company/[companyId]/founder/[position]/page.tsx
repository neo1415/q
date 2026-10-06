import type { Metadata } from "next";
import Link from "next/link";

import { getCompanyFounder } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { FounderPerson } from "@/features/company/material/team";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Founder" };
export const dynamic = "force-dynamic";

/**
 * A founder as a person (overnight plan A7), opened from a company's Team
 * tab. The API decides the reader (the owner, or an investor the pitch rule
 * admits) and the projection: age only where shared, each background line
 * labelled with what it rests on. Anyone else gets one plain not-found.
 */
export default async function FounderPage({
  params,
}: {
  readonly params: Promise<{ readonly companyId: string; readonly position: string }>;
}) {
  const { companyId, position } = await params;
  const session = await apiSession();
  const n = Number(position);
  const person =
    session === null || !Number.isInteger(n)
      ? null
      : await getCompanyFounder(session, companyId, n).catch(() => null);
  return (
    <PageContainer className="flex flex-col gap-6">
      <Link
        href={`/company/${encodeURIComponent(companyId)}?tab=team`}
        className={buttonClassName("quiet", "compact", "self-start")}
      >
        <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
        Back to the team
      </Link>
      {person === null ? (
        <EmptyState
          title="This person isn't available to you."
          description="They may not be shown to you, or the link is out of date. Nothing is wrong with your account."
        />
      ) : (
        <FounderPerson person={person} />
      )}
    </PageContainer>
  );
}
