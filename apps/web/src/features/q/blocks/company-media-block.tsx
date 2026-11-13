"use client";

import { useState } from "react";

import type { QResultBlock } from "@capital-q/contracts";

import { CompanyPitch } from "@/features/discover/company-pitch";
import { companyPhotoPath, isNoPicture } from "@/features/entity/entity-avatar";
import { useT } from "@/features/i18n/language";

type CompanyMediaBlock = Extract<QResultBlock, { kind: "COMPANY_MEDIA" }>;

function minutesAndSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A8 (owner directive 13 Nov 2026): the company Q is talking about, with
 * its own Capital Q media. Nothing here decides access, and nothing in the
 * block grants it:
 *
 * - The picture is the company's photo route, asked by company id under
 *   this reader's session; the API answers only where its Q Card shows the
 *   photo to them, and a "no" (the 1x1 placeholder) or a failure leaves
 *   the picture out rather than drawing a broken frame.
 * - The pitch is the same player as a company page (poster first, nothing
 *   streamed until Play, muted and captioned per the player, reduced
 *   motion respected). Pressing Play asks the server for a signed,
 *   per-reader playback authorization; the asset id alone plays nothing.
 */
export function CompanyMediaBody({
  block,
}: {
  readonly block: CompanyMediaBlock;
}) {
  const t = useT();
  const [pictureGone, setPictureGone] = useState(false);
  const showPicture = block.image && !pictureGone;
  const pitch = block.pitch;
  if (!showPicture && pitch === null) return null;
  return (
    <div className="flex flex-col gap-3" data-q-company-media={block.companyId}>
      {showPicture ? (
        <figure className="m-0 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a redirect to a short-lived signed URL; an optimiser would proxy it through this app */}
          <img
            src={companyPhotoPath(block.companyId)}
            alt={block.name}
            width={72}
            height={72}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            data-q-company-picture
            onLoad={(event) => {
              const image = event.currentTarget;
              if (isNoPicture(image.naturalWidth, image.naturalHeight)) {
                setPictureGone(true);
              }
            }}
            onError={() => setPictureGone(true)}
            className="size-18 shrink-0 rounded-(--cq-radius-md) bg-(--cq-surface-sunken) object-cover"
          />
          <figcaption className="cq-caption text-(--cq-text-secondary)">
            {t("From their Capital Q profile")}
          </figcaption>
        </figure>
      ) : null}
      {pitch === null ? null : (
        <section
          aria-label={`${block.name}: ${t("pitch")}`}
          className="flex flex-col gap-2"
          data-q-company-pitch-block={pitch.mediaAssetId}
        >
          <CompanyPitch
            company={{
              companyId: block.companyId,
              canonicalName: block.name,
              pitch,
            }}
            startOnRequest
          />
          <p className="cq-caption text-(--cq-text-secondary)">
            {pitch.title !== null && pitch.title !== undefined
              ? pitch.title
              : `${block.name} · ${t("pitch")}`}
            {pitch.durationSeconds === null
              ? null
              : ` · ${minutesAndSeconds(pitch.durationSeconds)}`}
            {pitch.captionState === "AVAILABLE" ||
            pitch.captionsInPicture === true
              ? ` · ${t("Captions available")}`
              : null}
          </p>
        </section>
      )}
    </div>
  );
}
