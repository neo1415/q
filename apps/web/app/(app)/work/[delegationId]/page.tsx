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
import { DoneForYouUndo } from "@/features/work/done-for-you-undo";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("What Q did") };
}

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
  const t = await serverT();

  const { delegationId } = await params;
  const session = await qApiSession();
  let detail: QWorkDetailDto | null = null;
  if (session !== null) {
    detail = await getQWork(session, delegationId).catch(() => null);
  }
  if (detail === null) {
    return (
      <PageContainer width="reading">
        <QSection
          id="work"
          kind="WORK_LIST"
          refs={[{ kind: "Q_WORK", id: delegationId }]}
          total={1}
          label={t("Q's work")}
        >
          <PageHeader title={t("What Q did")} />
          <ErrorState
            title={t("This isn't available")}
            description={t("It may have been removed, or it isn't yours.")}
            action={
              <Link
                href="/work"
                className="cq-body-sm underline underline-offset-4"
              >
                {t("Open Q’s work")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }
  const { work, steps } = detail;
  return (
    <PageContainer width="reading">
      <QSection
        id="work"
        kind="WORK_LIST"
        refs={[{ kind: "Q_WORK", id: delegationId }]}
        total={1}
        label={t("Q's work")}
      >
        <PageHeader
          title={
            work.kind === "INVESTOR_OUTREACH" ? t("Outreach") : t("Stand-in")
          }
          description={work.summary ?? undefined}
        >
          <Link
            href="/work"
            className="cq-body-sm inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {t("Back to Q’s work")}
          </Link>
        </PageHeader>
        <div className="flex flex-col gap-10">
          {work.lanes.some((lane) => lane.reasons.length > 0) ? (
            <PageSection id="picked" title={t("Why Q picked them")}>
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
                          {t(reason.reason)}{" "}
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
          <PageSection id="steps" title={t("Every step")}>
            {steps.length === 0 ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {t("Nothing yet. Q’s first step shows here within a minute.")}
              </p>
            ) : (
              <ol className="flex flex-col">
                {steps.map((step) => (
                  <li
                    key={`${step.at}-${step.words}`}
                    className="flex flex-col gap-0.5 border-b border-(--cq-border-subtle) py-3 last:border-b-0"
                  >
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      {t(step.words)}
                    </span>
                    <time
                      dateTime={step.at}
                      className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                    >
                      {t(
                        new Intl.DateTimeFormat("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                          timeZoneName: "short",
                        }).format(new Date(step.at)),
                      )}
                    </time>
                    {step.undo === null ? null : (
                      <DoneForYouUndo
                        relationshipId={step.undo.relationshipId}
                        messageId={step.undo.messageId}
                        until={step.undo.until}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
          </PageSection>
        </div>
      </QSection>
    </PageContainer>
  );
}
