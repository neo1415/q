import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminBreakGlass, getAdminSafety } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { BreakGlassList, SafetyReports } from "@/features/admin/safety-queue";

export const metadata: Metadata = { title: "Safety · Admin" };

export default async function AdminSafetyPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly all?: string | undefined }>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("safety.read")) notFound();
  const all = (await searchParams).all === "1";
  const [safety, glass] = await Promise.all([
    getAdminSafety(context.session, all).catch(() => null),
    getAdminBreakGlass(context.session)
      .then((result) => result.rows)
      .catch(() => null),
  ]);
  return (
    <div className="flex flex-col gap-10">
      <PageSection
        id="reports"
        title="Reports from chat"
        description="What people reported, and why. Conversations stay private unless a second admin approves a request to read one."
      >
        <div className="flex flex-col gap-3">
          <Link
            href={all ? "/admin/safety" : "/admin/safety?all=1"}
            className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
          >
            {all ? "Show only reports to review" : "Show reviewed reports too"}
          </Link>
          {safety === null ? (
            <ErrorState
              title="Reports couldn't load"
              description="Try again in a moment."
            />
          ) : safety.reports.length === 0 ? (
            <EmptyState
              compact
              title="Nothing to review"
              description="New reports from chat appear here."
            />
          ) : (
            <SafetyReports
              reports={safety.reports}
              canDecide={context.can("safety.decide")}
              canBreakGlass={context.can("breakglass.request")}
            />
          )}
        </div>
      </PageSection>

      <PageSection id="break-glass" title="Requests to read private content">
        {glass === null ? (
          <ErrorState
            title="Requests couldn't load"
            description="Try again in a moment."
          />
        ) : glass.length === 0 ? (
          <EmptyState
            compact
            title="No requests"
            description="Requests to read a chat or a Q run's words appear here for a second admin to decide."
          />
        ) : (
          <BreakGlassList rows={glass} viewerId={context.me.userId} />
        )}
      </PageSection>

      <PageSection id="blocks" title="Active blocks">
        {safety === null ? null : safety.blocks.length === 0 ? (
          <EmptyState compact title="No active blocks" />
        ) : (
          <ul className="flex flex-col gap-2">
            {safety.blocks.map((block) => (
              <li
                key={block.blockId}
                className="cq-body-sm text-(--cq-text-primary)"
              >
                {block.blockerSide === "COMPANY"
                  ? block.companyName
                  : block.investorName}{" "}
                blocked{" "}
                {block.blockerSide === "COMPANY"
                  ? block.investorName
                  : block.companyName}{" "}
                · {new Date(block.createdAt).toLocaleDateString("en-GB")}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
