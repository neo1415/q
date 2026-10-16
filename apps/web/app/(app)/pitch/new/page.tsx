import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PitchVideoPage } from "@/features/pitch/pitch-video-page";
import { resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "New video" };

export const dynamic = "force-dynamic";

/** A new video beside the company's others (ADR 0022). */
export default async function NewPitchVideoPage() {
  const t = await serverT();
  const context = await resolveOwnContext();
  if (context.kind !== "FOUNDER") redirect("/pitch");
  return (
    <PageContainer>
      <QSection
        id="pitch"
        kind="PITCH"
        refs={[{ kind: "COMPANY", id: context.companyId }]}
        total={0}
        label={t("a new pitch video")}
      >
        <PageHeader title={t("New video")} />
        <PitchVideoPage companyId={context.companyId} mediaAssetId={null} />
      </QSection>
    </PageContainer>
  );
}
