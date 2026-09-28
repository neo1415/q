import type { ReactNode } from "react";

import type { ProfileImageSubjectType } from "@capital-q/contracts";
import { MapPin, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { ProfileImageEditor } from "./profile-image-editor";

/**
 * The profile's header block, LinkedIn-shaped: a 4:1 cover, the round
 * photo overlapping its lower edge, then name, headline, location, a line
 * of key facts and the actions. Both images carry a camera control when
 * the viewer may change them. No image is not a placeholder picture: the
 * cover falls back to a quiet surface and the photo to initials.
 */

export type HeaderImages = {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly avatarUrl: string | null;
  readonly coverUrl: string | null;
  /** False: show the images without camera controls. */
  readonly editable: boolean;
  /** "profile photo" or "logo". */
  readonly avatarLabel: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function ProfileHero({
  name,
  headline,
  location,
  facts,
  images,
  actions,
  square = false,
}: {
  readonly name: string;
  readonly headline: string | null;
  readonly location: string | null;
  /** Short key facts, e.g. company · stage · website. */
  readonly facts: readonly ReactNode[];
  readonly images: HeaderImages;
  readonly actions?: ReactNode | undefined;
  /** Organisations get a rounded-square logo, people a circle. */
  readonly square?: boolean | undefined;
}) {
  const shape = square ? "rounded-2xl" : "rounded-full";
  return (
    <div
      className="overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface)"
      data-profile-hero
    >
      <div className="relative aspect-[4/1] min-h-24 w-full bg-(--cq-surface-strong)">
        {images.coverUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL: fetched by the browser from storage directly, never proxied through Next.js
          <img
            src={images.coverUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            data-profile-cover
          />
        )}
        {images.editable ? (
          <div className="absolute top-3 right-3">
            <ProfileImageEditor
              subjectType={images.subjectType}
              subjectId={images.subjectId}
              kind="COVER"
              label="cover photo"
              hasImage={images.coverUrl !== null}
            />
          </div>
        ) : null}
      </div>
      <div className="relative px-4 pb-5 sm:px-6">
        <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-16">
          <div className="relative">
            <div
              className={`size-24 overflow-hidden border-4 border-(--cq-surface) bg-(--cq-surface-subtle) sm:size-32 ${shape}`}
            >
              {images.avatarUrl === null ? (
                <span
                  role="img"
                  aria-label={name}
                  className="cq-title-lg flex size-full items-center justify-center text-(--cq-text-secondary)"
                >
                  {initials(name)}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
                <img
                  src={images.avatarUrl}
                  alt={name}
                  className="size-full object-cover"
                  data-profile-avatar
                />
              )}
            </div>
            {images.editable ? (
              <div className="absolute right-0 bottom-0">
                <ProfileImageEditor
                  subjectType={images.subjectType}
                  subjectId={images.subjectId}
                  kind="AVATAR"
                  label={images.avatarLabel}
                  hasImage={images.avatarUrl !== null}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1 pt-3">
          <h1 className="cq-title-xl break-words text-(--cq-text-primary)">
            {name}
          </h1>
          {headline === null ? null : (
            <p className="cq-body-lg text-(--cq-text-primary)">{headline}</p>
          )}
          {location === null ? null : (
            <p className="cq-body-sm flex items-center gap-1.5 text-(--cq-text-secondary)">
              <MapPin
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              {location}
            </p>
          )}
          {facts.length === 0 ? null : (
            <p className="cq-body-sm flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-(--cq-text-secondary)">
              {facts.map((fact, index) => (
                <span key={index} className="inline-flex items-center gap-2">
                  {index === 0 ? null : <span aria-hidden>·</span>}
                  {fact}
                </span>
              ))}
            </p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-wrap gap-2 pt-4">{actions}</div>
        )}
      </div>
    </div>
  );
}
