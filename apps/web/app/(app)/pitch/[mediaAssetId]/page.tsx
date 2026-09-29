import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { PitchVideoPage } from "@/features/pitch/pitch-video-page";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Video" };

export const dynamic = "force-dynamic";

/**
 * One of the company's videos (ADR 0022). The id is input: the API decides
 * whether this person may see or change it, and a video that is not theirs
 * or no longer live reads as not found there.
 */
export default async function PitchVideoRoute({
  params,
}: {
  readonly params: Promise<{ readonly mediaAssetId: string }>;
}) {
  const { mediaAssetId } = await params;
  if (!z.string().uuid().safeParse(mediaAssetId).success) notFound();
  const context = await resolveOwnContext();
  if (context.kind !== "FOUNDER") redirect("/pitch");
  return (
    <PageContainer>
      <PageHeader title="Video" />
      <PitchVideoPage
        companyId={context.companyId}
        mediaAssetId={mediaAssetId}
      />
    </PageContainer>
  );
}
