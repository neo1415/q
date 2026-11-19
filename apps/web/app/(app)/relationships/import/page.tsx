import type { Metadata } from "next";

import { listPipelineProspects } from "@capital-q/api-client";
import type { PipelineProspect } from "@capital-q/contracts";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { BackLink } from "@/features/company/back-link";
import { serverT } from "@/features/i18n/server";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { PipelineImportScreen } from "@/features/relationships/pipeline-import-screen";
import { PipelineProspects } from "@/features/relationships/pipeline-prospects";
import { hubTitle } from "@/features/relationships/hub-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Import your pipeline") };
}

// Read under the person's own session on every request.
export const dynamic = "force-dynamic";

/**
 * Bring your pipeline (decision 106): the CRM or spreadsheet export an
 * investor or a founder already keeps, read by Q and arranged as Capital
 * Q's own pipeline, after the person approves exactly what it would do.
 * Below it, the organisation's private prospects (rows kept because the
 * counterpart is not on Capital Q). The side is the person's own active
 * context; the API authorises every read and write again.
 */
export default async function PipelineImportPage() {
  const t = await serverT();
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR") {
    return (
      <PageContainer width="content">
        <EmptyState
          title={t("Your pipeline belongs to your company or firm")}
          description={t(
            "Finish your setup, then import the pipeline you already keep.",
          )}
        />
      </PageContainer>
    );
  }
  const side = context.kind === "INVESTOR" ? "INVESTOR" : "COMPANY";
  const companyId = context.kind === "FOUNDER" ? context.companyId : undefined;
  let prospects: readonly PipelineProspect[] | null = null;
  if (session !== null) {
    prospects = await listPipelineProspects(session, companyId)
      .then((list) => list.items)
      .catch(() => null);
  }
  return (
    <PageContainer width="content" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* D8: back to the place by the name its page carries. */}
        <BackLink fallbackHref="/relationships" label={t(hubTitle(side))} />
        <PageHeader
          title={t("Import your pipeline")}
          description={
            side === "INVESTOR"
              ? t(
                  "Bring the deal pipeline you already keep. Q reads your file, matches each company on Capital Q, and shows you everything before it changes.",
                )
              : t(
                  "Bring the investor tracker you already keep. Q reads your file, matches each investor on Capital Q, and shows you everything before it changes.",
                )
          }
        />
      </div>
      <QSection id="import" kind="UPLOAD_LIST" label={t("Import a file")}>
        <PipelineImportScreen side={side} companyId={companyId} />
      </QSection>
      <PageSection
        id="prospects"
        title={t("Private prospects")}
        description={
          side === "INVESTOR"
            ? t("Companies from your imports that aren't on Capital Q yet.")
            : t("Investors from your imports that aren't on Capital Q yet.")
        }
      >
        <PipelineProspects side={side} prospects={prospects} />
      </PageSection>
    </PageContainer>
  );
}
