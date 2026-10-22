import type { ReactNode } from "react";

import type { ProfileImageSubjectType } from "@capital-q/contracts";
import {
  Check,
  CircleHelp,
  ICON_SIZE,
  ICON_STROKE,
  MapPin,
} from "@capital-q/ui/icons";

import { CoverBand } from "@/features/entity/cover-band";
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
  // Words that start with a letter or digit: "(fictional)" or "&" is not
  // part of anyone's initials.
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
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
  /** Organisations get a square logo, people a circle. */
  readonly square?: boolean | undefined;
}) {
  const shape = square ? "" : "rounded-full";
  return (
    <div
      className="overflow-hidden border border-(--cq-border-subtle) bg-(--cq-surface)"
      data-profile-hero
    >
      <div className="relative aspect-[4/1] min-h-24 w-full bg-(--cq-surface-strong)">
        {images.coverUrl === null ? (
          // Someone else's profile without a cover: a quiet horizon rather
          // than an empty band (owner 2026-10-16). Their own stays plain,
          // with the button to add one.
          images.editable ? null : (
            <CoverBand seed={images.subjectId} className="absolute inset-0" />
          )
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage URL: fetched by the browser from storage directly, never proxied through Next.js
          <img
            src={images.coverUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            data-profile-cover
          />
        )}
        {images.editable ? (
          <div className="absolute top-3 end-3">
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
              <div className="absolute end-0 bottom-0">
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

/**
 * The person's own profile header (chosen design "One page, edit in
 * place", 2026-10-21): the round photo with a small pencil on its corner
 * (a sheet to upload, replace or remove it), the name, their headline,
 * and a line of plain facts with where their identity verification
 * stands, in words.
 */
export function OwnProfileHero({
  name,
  headline,
  facts,
  identity,
  photo,
}: {
  readonly name: string;
  readonly headline: string | null;
  readonly facts: readonly ReactNode[];
  /** "Investor identity: not verified"; verified reads with a tick. */
  readonly identity: {
    readonly words: string;
    readonly verified: boolean;
  } | null;
  readonly photo: {
    readonly subjectId: string;
    readonly url: string | null;
    readonly editable: boolean;
    /** Design review only (/dev/account-review): the photo sheet, open. */
    readonly sheetOpen?: boolean | undefined;
  };
}) {
  return (
    <div
      className="flex items-center gap-3.5 pt-1.5 pb-[22px] sm:gap-5"
      data-profile-hero
    >
      <div className="relative shrink-0">
        <div className="size-20 overflow-hidden rounded-full border border-(--cq-border) bg-(--cq-surface-subtle) sm:size-24">
          {photo.url === null ? (
            <span
              role="img"
              aria-label={name}
              className="grid size-full place-items-center text-2xl font-semibold text-(--cq-text-secondary) sm:text-[28px]"
            >
              {initials(name)}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
            <img
              src={photo.url}
              alt={name}
              className="size-full object-cover"
              data-profile-avatar
            />
          )}
        </div>
        {photo.editable ? (
          <div className="absolute -end-1 -bottom-1">
            <ProfileImageEditor
              subjectType="PERSON"
              subjectId={photo.subjectId}
              kind="AVATAR"
              label="profile photo"
              hasImage={photo.url !== null}
              previewUrl={photo.url}
              previewName={name}
              compact
              initiallyOpen={photo.sheetOpen}
            />
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.02em] break-words text-(--cq-text-primary) sm:text-[28px]">
          {name}
        </h1>
        {headline === null ? null : (
          <p className="m-0 mt-[3px] text-[15px] text-(--cq-text-secondary)">
            {headline}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-(--cq-text-tertiary)">
          {facts.map((fact, index) => (
            <span key={index}>{fact}</span>
          ))}
          {identity === null ? null : (
            <span
              className={
                identity.verified
                  ? "inline-flex items-center gap-[5px] rounded-full bg-(--cq-positive-soft) px-2 py-0.5 text-xs font-medium whitespace-nowrap text-(--cq-positive)"
                  : "inline-flex items-center gap-[5px] rounded-full bg-(--cq-surface-strong) px-2 py-0.5 text-xs font-medium whitespace-nowrap text-(--cq-text-secondary)"
              }
              data-identity={identity.verified ? "verified" : "not-verified"}
            >
              {identity.verified ? (
                <Check size={12} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <CircleHelp size={12} strokeWidth={1.75} aria-hidden="true" />
              )}
              {identity.words}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
