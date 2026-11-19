import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { PipelineProspects } from "@/features/relationships/pipeline-prospects";
import { RecCard } from "@/features/relationships/record-parts";

import { FIXTURE_PROSPECTS } from "./fixtures";
import {
  PipelineImportHarness,
  SideDetailsHarness,
} from "./pipeline-import-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pipeline import (design review)",
  robots: { index: false },
};

/**
 * The CRM import screen (decision 106), the private prospects list and a
 * record's "Your pipeline" card, in the real shell over fictional data,
 * for design review, screenshots and the browser checks
 * (apps/web/e2e/pipeline-import.spec.ts). Development only; a production
 * build serves it only when CQ_DEV_PREVIEW=1 is set on that server.
 */
export default function PipelineImportReviewPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Harbour Ventures (fictional)",
      }}
    >
      <PageContainer width="content" className="flex flex-col gap-8">
        <PageHeader
          title="Import your pipeline"
          description="Bring the deal pipeline you already keep. Q reads your file, matches each company on Capital Q, and shows you everything before it changes."
        />
        <PipelineImportHarness />
        <PageSection
          id="prospects"
          title="Private prospects"
          description="Companies from your imports that aren't on Capital Q yet."
        >
          <PipelineProspects side="INVESTOR" prospects={FIXTURE_PROSPECTS} />
        </PageSection>
        <PageSection
          id="your-pipeline"
          title="On a relationship"
          description="The record's own fields, set by the import and editable."
        >
          <div className="max-w-sm">
            <RecCard title="Your pipeline" id="side-details">
              <SideDetailsHarness />
            </RecCard>
          </div>
        </PageSection>
      </PageContainer>
    </AppShell>
  );
}
