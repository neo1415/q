import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PitchVideoPage } from "@/features/pitch/pitch-video-page";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "New video" };

export const dynamic = "force-dynamic";

/** A new video beside the company's others (ADR 0022). */
export default async function NewPitchVideoPage() {
  const context = await resolveOwnContext();
  if (context.kind !== "FOUNDER") redirect("/pitch");
  return (
    <PageContainer>
      <PageHeader title="New video" />
      <PitchVideoPage companyId={context.companyId} mediaAssetId={null} />
    </PageContainer>
  );
}
