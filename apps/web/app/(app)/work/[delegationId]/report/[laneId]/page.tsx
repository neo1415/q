import type { Metadata } from "next";
import Link from "next/link";

import { getQWorkReport } from "@capital-q/api-client";
import type { QWorkReportDto } from "@capital-q/contracts";
import { ErrorState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { qApiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { FirstStageReport } from "@/features/work/first-stage-report";
import { WorkHeader, workSideOf } from "@/features/work/work-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("First-stage report") };
}

/**
 * The first-stage interview report (AUTO, ADR 0030; spec auto.md §3.1;
 * chosen design 2026-10-21, "Prepared next steps"): under Work's Tasks
 * tab, the verdict first, three prepared ways forward that wait for the
 * person's yes, every finding labelled as the founder's claim or Q's
 * inference with where it was said, and what to ask next. Downloadable
 * as a PDF. Read under the person's own session: anyone else's report is
 * the same "not available".
 */
export default async function WorkReportPage({
  params,
}: {
  readonly params: Promise<{ delegationId: string; laneId: string }>;
}) {
  const t = await serverT();

  const { delegationId, laneId } = await params;
  const [session, context] = await Promise.all([
    qApiSession(),
    resolveOwnContext().catch(() => null),
  ]);
  let report: QWorkReportDto | null = null;
  if (session !== null) {
    report = await getQWorkReport(session, delegationId, laneId).catch(
      () => null,
    );
  }
  return (
    <PageContainer>
      <WorkHeader view="tasks" side={workSideOf(context)} />
      <QSection
        id="work"
        kind="WORK_LIST"
        refs={[{ kind: "Q_WORK", id: delegationId }]}
        total={1}
        label={t("a report on Q's work")}
      >
        {report === null ? (
          <ErrorState
            title={t("This report isn't available")}
            description={t("It may not be written yet, or it isn't yours.")}
            action={
              <Link
                href="/work"
                className="cq-body-sm underline underline-offset-4"
              >
                {t("Open Q’s work")}
              </Link>
            }
          />
        ) : (
          <FirstStageReport
            report={report}
            delegationId={delegationId}
            laneId={laneId}
          />
        )}
      </QSection>
    </PageContainer>
  );
}
