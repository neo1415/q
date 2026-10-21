import type { Metadata } from "next";
import Link from "next/link";

import { getQWork } from "@capital-q/api-client";
import type { QWorkDetailDto } from "@capital-q/contracts";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";
import { resolveOwnContext } from "@/features/q/context";
import { DelegationAudit } from "@/features/work/delegation-audit";
import { WorkHeader, workSideOf } from "@/features/work/work-header";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("What Q did") };
}

/**
 * One delegation in full (AUTO, ADR 0030; owner 2026-10-21, option 1, the
 * audit trail): the person's instruction, who Q picked and on what words,
 * and every step, newest first, with on whose authority it was taken --
 * the person's own record of what was done under their approval.
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
  const context = await resolveOwnContext().catch(() => null);
  const side = workSideOf(context);
  return (
    <PageContainer width="wide">
      <QSection
        id="work"
        kind="WORK_LIST"
        refs={[{ kind: "Q_WORK", id: delegationId }]}
        total={1}
        label={t("Q's work")}
      >
        <WorkHeader view="tasks" side={side} />
        <DelegationAudit detail={detail} side={side} />
      </QSection>
    </PageContainer>
  );
}
