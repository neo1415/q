"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { ChevronLeft, ICON_SIZE } from "@capital-q/ui/icons";

import { PitchUpload } from "./pitch-upload";

/**
 * One video's page (ADR 0022): a new one (`mediaAssetId` null) or one the
 * company already has. Once a new video's record exists the address
 * becomes that video's own, with `history.replaceState` so the page does
 * not remount mid-upload and the bytes in flight carry on.
 */
export function PitchVideoPage({
  companyId,
  mediaAssetId,
}: {
  readonly companyId: string;
  readonly mediaAssetId: string | null;
}) {
  const router = useRouter();
  const onDeleted = useCallback(() => {
    router.push("/pitch");
    router.refresh();
  }, [router]);
  const onCreated = useCallback(
    (id: string) => {
      if (mediaAssetId === null) {
        window.history.replaceState(null, "", `/pitch/${id}`);
      }
    },
    [mediaAssetId],
  );
  return (
    <div className="flex flex-col gap-6">
      <Link href="/pitch" className={buttonClassName("quiet", "compact")}>
        <ChevronLeft size={ICON_SIZE.regular} aria-hidden="true" />
        All videos
      </Link>
      <PitchUpload
        companyId={companyId}
        mediaAssetId={mediaAssetId}
        onCreated={onCreated}
        onDeleted={onDeleted}
      />
    </div>
  );
}
