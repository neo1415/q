import type { Metadata } from "next";
import Link from "next/link";

import { getQWork } from "@capital-q/api-client";
import type { QWorkDetailDto } from "@capital-q/contracts";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "What Q did" };

/**
 * One delegation in full (AUTO, ADR 0030): who Q picked and on what words,
 * and every step Q took, newest first -- the person's own audit trail of
 * what was done under their approval.
 */
export default async function WorkDetailPage({
  params,
}: {
  readonly params: Promise<{ delegationId: string }>;
}) {
  const { delegationId } = await params;
  const session = await qApiSession();
  let detail: QWorkDetailDto | null = null;
  if (session !== null) {
    detail = await getQWork(session, delegationId).catch(() => null);
  }
  if (detail === null) {
    return (
      <PageContainer width="reading">
        <PageHeader title="What Q did" />
        <ErrorState
          title="This isn't available"
          description="It may have been removed, or it isn't yours."
          action={
            <Link
              href="/work"
              className="cq-body-sm underline underline-offset-4"
            >
              Open Q&rsquo;s work
            </Link>
          }
        />
      </PageContainer>
    );
  }
  const { work, steps } = detail;
  return (
    <PageContainer width="reading">
      <PageHeader
        title={work.kind === "INVESTOR_OUTREACH" ? "Outreach" : "Stand-in"}
        description={work.summary ?? undefined}
      >
        <Link
          href="/work"
          className="cq-body-sm inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Back to Q&rsquo;s work
        </Link>
      </PageHeader>
      <div className="flex flex-col gap-10">
        {work.lanes.some((lane) => lane.reasons.length > 0) ? (
          <PageSection id="picked" title="Why Q picked them">
            <ul className="flex flex-col gap-4">
              {work.lanes
                .filter((lane) => lane.reasons.length > 0)
                .map((lane) => (
                  <li key={lane.id} className="flex flex-col gap-1">
                    <span className="cq-body font-medium text-(--cq-text-primary)">
                      {lane.counterpartName}
                    </span>
                    {lane.reasons.map((reason) => (
                      <p
                        key={reason.quote}
                        className="cq-body-sm text-(--cq-text-secondary)"
                      >
                        {reason.reason}{" "}
                        <q className="text-(--cq-text-primary)">
                          {reason.quote}
                        </q>
                      </p>
                    ))}
                  </li>
                ))}
            </ul>
          </PageSection>
        ) : null}
        <PageSection id="steps" title="Every step">
          {steps.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Nothing yet. Q&rsquo;s first step shows here within a minute.
            </p>
          ) : (
            <ol className="flex flex-col">
              {steps.map((step) => (
                <li
                  key={`${step.at}-${step.words}`}
                  className="flex flex-col gap-0.5 border-b border-(--cq-border-subtle) py-3 last:border-b-0"
                >
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {step.words}
                  </span>
                  <time
                    dateTime={step.at}
                    className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                  >
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                      timeZoneName: "short",
                    }).format(new Date(step.at))}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
